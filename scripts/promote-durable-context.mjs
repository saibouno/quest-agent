import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  HarnessError,
  actionPayload,
  decisionArtifactPathForSlug,
  durableDeltaTouchedArtifacts,
  ensureDurableDeltaShape,
  getRepoRootFromImport,
  hashContent,
  loadState,
  nowIso,
  parseMarkdownSections,
  printJson,
  readJson,
  readText,
  saveState,
} from "./theme-harness-lib.mjs";

const REPO_ROOT = getRepoRootFromImport(import.meta.url);
const ADAPTER_OWNER = "docs/context/adapter.json";
const MISSING_FILE_HASH = "__missing__";
const DECISION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ENTRY_STATUS = new Set(["open", "resolved", "superseded"]);

const ROLE_PATHS = {
  state_summary: "docs/context/current-state.md",
  active_plan_pointer: "docs/context/current-state.meta.json",
  decision_store: "docs/context/decisions/*.md",
  open_questions: "docs/context/open-questions.md",
  metric_source: "docs/context/metrics-source.md",
};

function repoPath(repoRoot, relativePath) {
  return path.join(repoRoot, ...String(relativePath || "").split("/"));
}

function localIsoString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

function reviewAtFrom(updatedAt) {
  const parsed = new Date(updatedAt);
  parsed.setDate(parsed.getDate() + 7);
  return localIsoString(parsed);
}

function promotionResult(state, {
  promotionState,
  reason,
  nextAction,
  changedArtifacts = [],
  message,
  status = promotionState,
} = {}) {
  state.context_promotion.required = state.harness_policy === "default";
  state.context_promotion.state = promotionState;
  state.context_promotion.reason = reason;
  state.context_promotion.next_action = nextAction;
  state.context_promotion.updated_at = nowIso();
  state.context_promotion.changed_artifacts = [...new Set(changedArtifacts)].sort();
  saveState(state.repo_root, state);

  return actionPayload({
    status,
    message,
    details: {
      slug: state.slug,
      context_promotion_required: state.context_promotion.required,
      context_promotion_state: state.context_promotion.state,
      context_promotion_reason: state.context_promotion.reason,
      context_promotion_next_action: state.context_promotion.next_action,
      context_promotion_changed_artifacts: state.context_promotion.changed_artifacts,
    },
  });
}

function blockedPromotion(state, reason, nextAction, message, changedArtifacts = []) {
  return promotionResult(state, {
    promotionState: "blocked",
    reason,
    nextAction,
    changedArtifacts,
    message,
    status: "blocked",
  });
}

function normalizeRequiredString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new HarnessError(`${label} must be a non-empty string.`, {
      status: "action_required",
    });
  }
  return normalized;
}

function normalizeOptionalString(value) {
  return String(value || "").trim();
}

function normalizeIsoTimestamp(value, label, { allowEmpty = true } = {}) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    if (allowEmpty) {
      return "";
    }
    throw new HarnessError(`${label} must be an ISO-8601 timestamp.`, {
      status: "action_required",
    });
  }

  if (Number.isNaN(Date.parse(normalized))) {
    throw new HarnessError(`${label} must be an ISO-8601 timestamp.`, {
      status: "action_required",
    });
  }

  return normalized;
}

function normalizeSourceRef(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be an object.`, {
      status: "action_required",
    });
  }

  return {
    kind: normalizeRequiredString(value.kind, `${label}.kind`),
    path_or_uri: normalizeRequiredString(value.path_or_uri, `${label}.path_or_uri`),
    locator: normalizeRequiredString(value.locator, `${label}.locator`),
    captured_at: normalizeIsoTimestamp(value.captured_at, `${label}.captured_at`, { allowEmpty: false }),
  };
}

function normalizeSourceRefs(values, label, { required = false } = {}) {
  const list = Array.isArray(values) ? values : [];
  if (required && !list.length) {
    throw new HarnessError(`${label} must include at least one source ref.`, {
      status: "action_required",
    });
  }

  return list.map((value, index) => normalizeSourceRef(value, `${label}[${index}]`));
}

function normalizeDecisionEntry(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be an object.`, {
      status: "action_required",
    });
  }

  const slug = normalizeRequiredString(value.slug, `${label}.slug`);
  if (!DECISION_SLUG_PATTERN.test(slug)) {
    throw new HarnessError(`${label}.slug must use lowercase letters, numbers, and hyphens only.`, {
      status: "action_required",
    });
  }

  return {
    slug,
    title: normalizeRequiredString(value.title, `${label}.title`),
    decision: normalizeRequiredString(value.decision, `${label}.decision`),
    why_it_stands: normalizeRequiredString(value.why_it_stands, `${label}.why_it_stands`),
    operational_consequence: normalizeRequiredString(value.operational_consequence, `${label}.operational_consequence`),
    source_refs: normalizeSourceRefs(value.source_refs, `${label}.source_refs`, { required: true }),
  };
}

function normalizeEntryId(value, label) {
  const normalized = normalizeRequiredString(value, label);
  if (!ENTRY_ID_PATTERN.test(normalized)) {
    throw new HarnessError(`${label} must use letters, numbers, dots, underscores, or hyphens only.`, {
      status: "action_required",
    });
  }
  return normalized;
}

function normalizeQuestionEntry(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be an object.`, {
      status: "action_required",
    });
  }

  const status = normalizeRequiredString(value.status, `${label}.status`);
  if (!ENTRY_STATUS.has(status)) {
    throw new HarnessError(`${label}.status must be one of: open, resolved, superseded.`, {
      status: "action_required",
    });
  }

  return {
    id: normalizeEntryId(value.id, `${label}.id`),
    summary: normalizeRequiredString(value.summary, `${label}.summary`),
    impact: normalizeRequiredString(value.impact, `${label}.impact`),
    next_unlock: normalizeRequiredString(value.next_unlock, `${label}.next_unlock`),
    status,
    observed_at: normalizeIsoTimestamp(value.observed_at, `${label}.observed_at`),
    resolved_at: normalizeIsoTimestamp(value.resolved_at, `${label}.resolved_at`),
    last_verified_by: normalizeOptionalString(value.last_verified_by),
    source_refs: normalizeSourceRefs(value.source_refs, `${label}.source_refs`),
    evidence_ref: normalizeOptionalString(value.evidence_ref),
  };
}

function normalizeDurableDeltaForPromotion(rawValue) {
  const durableDelta = ensureDurableDeltaShape(rawValue);
  return {
    ...durableDelta,
    decision_entries: durableDelta.decision_entries.map((value, index) => normalizeDecisionEntry(value, `decision_entries[${index}]`)),
    open_question_entries: durableDelta.open_question_entries.map((value, index) => normalizeQuestionEntry(value, `open_question_entries[${index}]`)),
    blocker_entries: durableDelta.blocker_entries.map((value, index) => normalizeQuestionEntry(value, `blocker_entries[${index}]`)),
    source_refs: normalizeSourceRefs(durableDelta.source_refs, "source_refs"),
    active_plan_pointer: durableDelta.recorded_fields.includes("active_plan_pointer")
      ? (rawValue?.active_plan_pointer === null
        ? null
        : {
            kind: normalizeRequiredString(rawValue?.active_plan_pointer?.kind, "active_plan_pointer.kind"),
            slug: normalizeRequiredString(rawValue?.active_plan_pointer?.slug, "active_plan_pointer.slug"),
            path: normalizeRequiredString(rawValue?.active_plan_pointer?.path, "active_plan_pointer.path"),
          })
      : durableDelta.active_plan_pointer,
  };
}

function extractMarkdownOwner(markdown) {
  const sections = parseMarkdownSections(markdown);
  const metadata = String(sections.Metadata || "");
  const match = /^-\s*owner:\s*`(.+?)`\s*$/m.exec(metadata);
  return match ? match[1] : "";
}

function formatSourceRef(ref) {
  if (typeof ref === "string") {
    return ref;
  }

  const pathOrUri = String(ref?.path_or_uri || "").trim();
  const locator = String(ref?.locator || "").trim();
  if (!pathOrUri) {
    return "";
  }
  return locator ? `${pathOrUri}#${locator}` : pathOrUri;
}

function renderSourceRefs(refs, emptyLine = "- none recorded") {
  const lines = (Array.isArray(refs) ? refs : [])
    .map((ref) => formatSourceRef(ref))
    .filter(Boolean)
    .map((ref) => `- \`${ref}\``);
  return lines.length ? lines.join("\n") : emptyLine;
}

function parseBulletItems(sectionText) {
  return String(sectionText || "")
    .split("\n")
    .map((line) => {
      const match = /^-\s+(.+?)\s*$/.exec(line.trim());
      return match ? match[1].trim() : "";
    })
    .filter(Boolean);
}

function renderBulletList(items, emptyLine = "- none promoted right now.") {
  const normalized = [...new Set((Array.isArray(items) ? items : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!normalized.length) {
    return emptyLine;
  }
  return normalized.map((item) => `- ${item}`).join("\n");
}

function renderMarkdownDocument(title, sections) {
  const lines = [`# ${title}`, ""];
  for (const [heading, content] of sections) {
    lines.push(`## ${heading}`, "", String(content || "").trim() || "- none recorded", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function parseQuestionSection(sectionText, kind, defaultStatus) {
  const entries = [];
  const lines = String(sectionText || "").replace(/\r\n/g, "\n").split("\n");
  let currentId = "";
  let buffer = [];

  const flush = () => {
    if (!currentId) {
      buffer = [];
      return;
    }

    const entry = {
      kind,
      id: currentId,
      status: defaultStatus,
      summary: "",
      impact: "",
      next_unlock: "",
      observed_at: "",
      resolved_at: "",
      last_verified_by: "",
      source_refs: [],
      evidence_ref: "",
    };
    let inSourceRefs = false;

    for (const rawLine of buffer) {
      const line = rawLine.trimEnd();
      if (/^-\s*source_refs:\s*$/u.test(line)) {
        inSourceRefs = true;
        continue;
      }

      if (inSourceRefs) {
        const sourceMatch = /^\s*-\s*`?(.+?)`?\s*$/u.exec(line);
        if (sourceMatch) {
          entry.source_refs.push(sourceMatch[1].trim());
          continue;
        }
        if (!line.trim()) {
          continue;
        }
        inSourceRefs = false;
      }

      const match = /^-\s*([^:]+):\s*(.+?)\s*$/u.exec(line);
      if (!match) {
        continue;
      }

      const label = match[1].trim().toLowerCase();
      const value = match[2].trim().replace(/^`(.+)`$/u, "$1");
      if (label === "id") {
        entry.id = value;
      } else if (label === "status") {
        entry.status = value;
      } else if (label === "summary") {
        entry.summary = value;
      } else if (label === "impact") {
        entry.impact = value;
      } else if (label === "next unlock") {
        entry.next_unlock = value;
      } else if (label === "observed_at") {
        entry.observed_at = value;
      } else if (label === "resolved_at") {
        entry.resolved_at = value;
      } else if (label === "last_verified_by") {
        entry.last_verified_by = value;
      } else if (label === "evidence_ref") {
        entry.evidence_ref = value;
      }
    }

    entries.push(entry);
    currentId = "";
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^###\s+`?(.+?)`?\s*$/u.exec(line.trim());
    if (headingMatch) {
      flush();
      currentId = headingMatch[1].trim();
      continue;
    }
    if (currentId) {
      buffer.push(line);
    }
  }
  flush();

  return entries;
}

function parseOpenQuestionsDocument(markdown) {
  const sections = parseMarkdownSections(markdown);
  return {
    metadata: sections.Metadata || "",
    open_questions: parseQuestionSection(sections["Open Questions"], "open_question", "open"),
    blockers: parseQuestionSection(sections.Blockers, "blocker", "open"),
    resolved: parseQuestionSection(sections["Resolved / Superseded"], "resolved", "resolved"),
  };
}

function renderActiveQuestionEntry(entry) {
  const lines = [
    `### \`${entry.id}\``,
    "",
    `- id: \`${entry.id}\``,
    "- status: `open`",
  ];
  if (entry.observed_at) {
    lines.push(`- observed_at: \`${entry.observed_at}\``);
  }
  if (entry.summary) {
    lines.push(`- summary: ${entry.summary}`);
  }
  lines.push(`- impact: ${entry.impact}`);
  lines.push(`- next unlock: ${entry.next_unlock}`);
  if (entry.last_verified_by) {
    lines.push(`- last_verified_by: \`${entry.last_verified_by}\``);
  }
  if (entry.source_refs?.length) {
    lines.push("- source_refs:");
    lines.push(...entry.source_refs.map((ref) => `  - \`${formatSourceRef(ref)}\``));
  }
  if (entry.evidence_ref) {
    lines.push(`- evidence_ref: \`${entry.evidence_ref}\``);
  }
  lines.push("");
  return lines.join("\n");
}

function renderResolvedQuestionEntry(entry) {
  const lines = [
    `### \`${entry.id}\``,
    "",
    `- id: \`${entry.id}\``,
    `- status: \`${entry.status}\``,
    `- resolved_at: \`${entry.resolved_at || localIsoString()}\``,
    `- summary: ${entry.summary}`,
  ];
  if (entry.source_refs?.length) {
    lines.push("- source_refs:");
    lines.push(...entry.source_refs.map((ref) => `  - \`${formatSourceRef(ref)}\``));
  }
  lines.push("");
  return lines.join("\n");
}

function renderOpenQuestionsDocument(existingMarkdown, openQuestions, blockers, resolved) {
  const parsed = parseMarkdownSections(existingMarkdown);
  const openQuestionEntries = [...openQuestions.values()].sort((left, right) => left.id.localeCompare(right.id));
  const blockerEntries = [...blockers.values()].sort((left, right) => left.id.localeCompare(right.id));
  const resolvedEntries = [...resolved.values()].sort((left, right) => left.id.localeCompare(right.id));

  return renderMarkdownDocument("Open Questions And Blockers", [
    ["Metadata", parsed.Metadata || ""],
    [
      "Open Questions",
      openQuestionEntries.length
        ? openQuestionEntries.map((entry) => renderActiveQuestionEntry(entry)).join("\n").trim()
        : "- none promoted right now.",
    ],
    [
      "Blockers",
      blockerEntries.length
        ? blockerEntries.map((entry) => renderActiveQuestionEntry(entry)).join("\n").trim()
        : "- none promoted right now.",
    ],
    [
      "Resolved / Superseded",
      resolvedEntries.length
        ? resolvedEntries.map((entry) => renderResolvedQuestionEntry(entry)).join("\n").trim()
        : "- none promoted right now.",
    ],
  ]);
}

function mergeSourceRefs(existingRefs, nextRefs) {
  const merged = [...(Array.isArray(existingRefs) ? existingRefs : []), ...(Array.isArray(nextRefs) ? nextRefs : [])];
  const seen = new Set();
  return merged.filter((ref) => {
    if (!ref || typeof ref !== "object") {
      return false;
    }
    const key = JSON.stringify(ref);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractDecisionMetadata(existingMarkdown, defaultUpdatedAt) {
  const sections = parseMarkdownSections(existingMarkdown || "");
  const metadata = String(sections.Metadata || "");
  const readField = (label, fallback) => {
    const match = new RegExp(`^-\\s*${label}:\\s*\`?(.+?)\`?\\s*$`, "mi").exec(metadata);
    return match ? match[1].trim() : fallback;
  };

  return {
    updated_at: defaultUpdatedAt,
    owner: readField("owner", ADAPTER_OWNER),
    status: readField("status", "confirmed"),
    review_at: reviewAtFrom(defaultUpdatedAt),
    supersedes: readField("supersedes", "none"),
    evidence_quality: readField("evidence_quality", "derived"),
  };
}

function renderDecisionDocument(existingMarkdown, entry, updatedAt) {
  const metadata = extractDecisionMetadata(existingMarkdown, updatedAt);
  return renderMarkdownDocument(`Decision: ${entry.title}`, [
    [
      "Metadata",
      [
        `- updated_at: \`${metadata.updated_at}\``,
        `- owner: \`${ADAPTER_OWNER}\``,
        `- status: \`${metadata.status}\``,
        `- review_at: \`${metadata.review_at}\``,
        `- supersedes: \`${metadata.supersedes}\``,
        `- evidence_quality: \`${metadata.evidence_quality}\``,
      ].join("\n"),
    ],
    ["Decision", renderBulletList([entry.decision])],
    ["Why It Stands", renderBulletList([entry.why_it_stands])],
    ["Operational Consequence", renderBulletList([entry.operational_consequence])],
    ["Source Refs", renderSourceRefs(entry.source_refs)],
  ]);
}

function validateRenderedArtifact(artifactPath, content) {
  const normalized = String(content || "");
  if (!normalized.trim()) {
    throw new HarnessError(`Rendered output for \`${artifactPath}\` is empty.`, {
      status: "action_required",
    });
  }

  if (artifactPath === "docs/context/current-state.md") {
    for (const heading of ["## Metadata", "## Product Shape", "## Current Focus", "## Blocked Work", "## Fallback Focus", "## Recent Confirmed Decisions", "## Next Safe Themes"]) {
      if (!normalized.includes(heading)) {
        throw new HarnessError(`Rendered current state is missing \`${heading}\`.`, {
          status: "action_required",
        });
      }
    }
  }

  if (artifactPath === "docs/context/open-questions.md" && !normalized.includes("## Resolved / Superseded")) {
    throw new HarnessError("Rendered open questions is missing `## Resolved / Superseded`.", {
      status: "action_required",
    });
  }
}

function validateAdapterForArtifacts(adapter, artifactPaths) {
  if (adapter.owner !== ADAPTER_OWNER) {
    return { type: "owner_mismatch", message: "The durable-context adapter owner does not match the repo contract." };
  }

  const touchedRoles = new Set(
    artifactPaths.map((artifactPath) => {
      if (artifactPath === ROLE_PATHS.state_summary) {
        return "state_summary";
      }
      if (artifactPath === ROLE_PATHS.active_plan_pointer) {
        return "active_plan_pointer";
      }
      if (artifactPath === ROLE_PATHS.open_questions) {
        return "open_questions";
      }
      if (artifactPath === ROLE_PATHS.metric_source) {
        return "metric_source";
      }
      if (artifactPath.startsWith("docs/context/decisions/")) {
        return "decision_store";
      }
      return "";
    }).filter(Boolean),
  );

  for (const role of touchedRoles) {
    if (adapter.roles?.[role]?.path !== ROLE_PATHS[role]) {
      return { type: "owner_mismatch", message: `Adapter role \`${role}\` no longer points at the canonical durable-context target.` };
    }

    const matches = (Array.isArray(adapter.canonical_artifacts) ? adapter.canonical_artifacts : [])
      .filter((artifactPath) => artifactPath === ROLE_PATHS[role]);
    if (!matches.length) {
      return { type: "owner_mismatch", message: `Adapter canonical artifacts no longer include \`${ROLE_PATHS[role]}\`.` };
    }
    if (matches.length > 1) {
      return { type: "ambiguous_target", message: `Adapter canonical artifacts define \`${ROLE_PATHS[role]}\` more than once.` };
    }
  }

  return null;
}

function detectDuplicateIds(existingDocument, openQuestionEntries, blockerEntries) {
  const parsed = parseOpenQuestionsDocument(existingDocument);
  const seen = new Map();

  const register = (entry, sourceLabel) => {
    if (!entry?.id) {
      return null;
    }
    const prior = seen.get(entry.id);
    if (prior) {
      return `${entry.id} (${prior} vs ${sourceLabel})`;
    }
    seen.set(entry.id, sourceLabel);
    return null;
  };

  for (const entry of [...parsed.open_questions, ...parsed.blockers, ...parsed.resolved]) {
    const duplicate = register(entry, `existing:${entry.kind}`);
    if (duplicate) {
      return duplicate;
    }
  }

  for (const entry of openQuestionEntries) {
    const duplicate = register(entry, "delta:open_question");
    if (duplicate) {
      return duplicate;
    }
  }

  for (const entry of blockerEntries) {
    const duplicate = register(entry, "delta:blocker");
    if (duplicate) {
      return duplicate;
    }
  }

  return "";
}

function buildCurrentStateMeta(existingMeta, durableDelta, blockerMap, updatedAt) {
  const recorded = new Set(durableDelta.recorded_fields);
  const meta = {
    ...existingMeta,
    updated_at: updatedAt,
    owner: ADAPTER_OWNER,
    status: existingMeta.status || "confirmed",
    review_at: reviewAtFrom(updatedAt),
    supersedes: Array.isArray(existingMeta.supersedes) ? existingMeta.supersedes : [],
    evidence_quality: existingMeta.evidence_quality || "mixed",
  };

  if (recorded.has("active_plan_pointer")) {
    meta.active_plan_pointer = durableDelta.active_plan_pointer;
  }
  if (recorded.has("plan_status")) {
    meta.plan_status = durableDelta.plan_status;
  }
  if (recorded.has("resume_condition")) {
    meta.resume_condition = durableDelta.resume_condition;
  }
  if (recorded.has("fallback_focus")) {
    meta.fallback_focus = durableDelta.fallback_focus;
  }
  if (recorded.has("source_refs")) {
    meta.source_refs = mergeSourceRefs(existingMeta.source_refs, durableDelta.source_refs);
  }
  if (recorded.has("blocker_entries")) {
    meta.blocked_by = [...blockerMap.values()].map((entry) => ({
      id: entry.id,
      summary: entry.summary,
      observed_at: entry.observed_at || "",
      evidence_ref: entry.evidence_ref || "",
      last_verified_by: entry.last_verified_by || "",
    }));
  }

  return meta;
}

function renderBlockedWorkSection(meta) {
  const activePlan = meta.active_plan_pointer?.slug || "none";
  const blockers = Array.isArray(meta.blocked_by) ? meta.blocked_by : [];
  if (!blockers.length || String(meta.plan_status || "").trim() !== "blocked") {
    return [
      "- Active blocked plan: `none`",
      "- Blocker summary: none promoted right now.",
      `- Resume condition: ${meta.resume_condition || "No blocked work is recorded right now."}`,
    ].join("\n");
  }

  return [
    `- Active blocked plan: \`${activePlan}\``,
    `- Blocker summary: ${blockers[0].summary}`,
    `- Resume condition: ${meta.resume_condition || "No resume condition was recorded."}`,
  ].join("\n");
}

function buildCurrentStateDocument(existingMarkdown, durableDelta, updatedMeta) {
  const sections = parseMarkdownSections(existingMarkdown);
  const recorded = new Set(durableDelta.recorded_fields);

  const currentFocus = recorded.has("current_focus")
    ? renderBulletList(durableDelta.current_focus)
    : (sections["Current Focus"] || "- none promoted right now.");
  const nextSafeThemes = recorded.has("next_safe_themes")
    ? renderBulletList(durableDelta.next_safe_themes)
    : (sections["Next Safe Themes"] || "- none promoted right now.");
  const fallbackFocus = recorded.has("fallback_focus")
    ? renderBulletList([durableDelta.fallback_focus])
    : (sections["Fallback Focus"] || "- none promoted right now.");
  const recentDecisions = durableDelta.decision_entries.length
    ? renderBulletList([
        ...durableDelta.decision_entries.map((entry) => entry.decision),
        ...parseBulletItems(sections["Recent Confirmed Decisions"]),
      ])
    : (sections["Recent Confirmed Decisions"] || "- none promoted right now.");
  const blockedWork = (
    recorded.has("blocker_entries")
    || recorded.has("active_plan_pointer")
    || recorded.has("plan_status")
    || recorded.has("resume_condition")
  )
    ? renderBlockedWorkSection(updatedMeta)
    : (sections["Blocked Work"] || "- none promoted right now.");

  return renderMarkdownDocument("Current State", [
    ["Metadata", sections.Metadata || ""],
    ["Product Shape", sections["Product Shape"] || ""],
    ["Current Focus", currentFocus],
    ["Blocked Work", blockedWork],
    ["Fallback Focus", fallbackFocus],
    ["Recent Confirmed Decisions", recentDecisions],
    ["Next Safe Themes", nextSafeThemes],
  ]);
}

function buildMetricsSourceDocument(existingMarkdown, durableDelta) {
  const sections = parseMarkdownSections(existingMarkdown);
  const recorded = new Set(durableDelta.recorded_fields);
  return renderMarkdownDocument("Metrics Source", [
    ["Metadata", sections.Metadata || ""],
    ["Source Of Truth", sections["Source Of Truth"] || ""],
    [
      "Current Watch Item",
      recorded.has("metric_watch")
        ? renderBulletList(durableDelta.metric_watch)
        : (sections["Current Watch Item"] || "- none promoted right now."),
    ],
    ["Non-Canonicalized Data", sections["Non-Canonicalized Data"] || ""],
  ]);
}

function buildOpenQuestionsState(existingMarkdown, durableDelta) {
  const duplicate = detectDuplicateIds(existingMarkdown, durableDelta.open_question_entries, durableDelta.blocker_entries);
  if (duplicate) {
    throw new HarnessError(`Conflicting duplicate durable-context entry id detected: ${duplicate}.`, {
      status: "action_required",
    });
  }

  const parsed = parseOpenQuestionsDocument(existingMarkdown);
  const openQuestions = new Map(parsed.open_questions.map((entry) => [entry.id, entry]));
  const blockers = new Map(parsed.blockers.map((entry) => [entry.id, entry]));
  const resolved = new Map(parsed.resolved.map((entry) => [entry.id, entry]));

  for (const entry of durableDelta.open_question_entries) {
    if (blockers.has(entry.id)) {
      throw new HarnessError(`Conflicting duplicate durable-context entry id detected: ${entry.id} (open question vs blocker).`, {
        status: "action_required",
      });
    }
    if (entry.status === "open") {
      openQuestions.set(entry.id, entry);
      resolved.delete(entry.id);
    } else {
      openQuestions.delete(entry.id);
      resolved.set(entry.id, {
        ...entry,
        kind: "resolved",
        resolved_at: entry.resolved_at || localIsoString(),
      });
    }
  }

  for (const entry of durableDelta.blocker_entries) {
    if (openQuestions.has(entry.id)) {
      throw new HarnessError(`Conflicting duplicate durable-context entry id detected: ${entry.id} (blocker vs open question).`, {
        status: "action_required",
      });
    }
    if (entry.status === "open") {
      blockers.set(entry.id, entry);
      resolved.delete(entry.id);
    } else {
      blockers.delete(entry.id);
      resolved.set(entry.id, {
        ...entry,
        kind: "resolved",
        resolved_at: entry.resolved_at || localIsoString(),
      });
    }
  }

  return {
    openQuestions,
    blockers,
    resolved,
    markdown: renderOpenQuestionsDocument(existingMarkdown, openQuestions, blockers, resolved),
  };
}

function compareArtifactHashes(repoRoot, baselineHashes) {
  for (const [artifactPath, baselineHash] of Object.entries(baselineHashes || {})) {
    const absolutePath = repoPath(repoRoot, artifactPath);
    const currentHash = existsSync(absolutePath) ? hashContent(readText(absolutePath)) : MISSING_FILE_HASH;
    if (currentHash !== baselineHash) {
      return artifactPath;
    }
  }
  return "";
}

function defaultReplaceArtifact({ targetPath, tempPath }) {
  writeFileSync(targetPath, readText(tempPath), "utf8");
}

export function promoteDurableContext({
  repoRoot = REPO_ROOT,
  slug,
  replaceArtifact = defaultReplaceArtifact,
} = {}) {
  const state = loadState(repoRoot, slug);
  state.context_promotion.required = state.harness_policy === "default";
  if (!state.context_promotion.required) {
    return promotionResult(state, {
      promotionState: "noop",
      reason: "not_required",
      nextAction: "This theme does not require durable-context auto-promotion.",
      changedArtifacts: [],
      message: "Durable-context auto-promotion is not required for this theme.",
      status: "noop",
    });
  }

  let durableDelta;
  try {
    durableDelta = normalizeDurableDeltaForPromotion(state.durable_delta);
  } catch (error) {
    const details = error instanceof HarnessError ? error.message : String(error);
    return blockedPromotion(
      state,
      "malformed_delta",
      `Repair the structured durable input with \`node scripts/theme-ops.mjs explain --slug ${slug} ...\` and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
      `Durable-context promotion is blocked because the saved durable delta is malformed: ${details}`,
    );
  }

  const artifactPaths = Object.keys(durableDelta.baseline_context_hashes).length
    ? Object.keys(durableDelta.baseline_context_hashes).sort()
    : durableDeltaTouchedArtifacts(durableDelta);
  if (!artifactPaths.length) {
    return promotionResult(state, {
      promotionState: "noop",
      reason: "no_durable_delta",
      nextAction: `Run \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\` again after recording structured durable input if this theme changes canonical durable context.`,
      changedArtifacts: [],
      message: "No durable delta was recorded for auto-promotion.",
      status: "noop",
    });
  }

  const adapterPath = repoPath(repoRoot, ADAPTER_OWNER);
  const adapter = readJson(adapterPath);
  const adapterProblem = validateAdapterForArtifacts(adapter, artifactPaths);
  if (adapterProblem) {
    return blockedPromotion(
      state,
      adapterProblem.type,
      `Restore \`${ADAPTER_OWNER}\` to the expected durable-context owner mapping and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
      adapterProblem.message,
    );
  }

  const staleArtifact = compareArtifactHashes(repoRoot, durableDelta.baseline_context_hashes);
  if (staleArtifact) {
    return blockedPromotion(
      state,
      "stale_target",
      `Rerun \`node scripts/theme-ops.mjs explain --slug ${slug} ...\` to refresh the durable delta baseline before rerunning \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
      `Durable-context promotion is blocked because \`${staleArtifact}\` changed after \`explain\` captured the baseline.`,
    );
  }

  const updatedAt = localIsoString();
  const patches = [];

  try {
    const currentStatePath = repoPath(repoRoot, ROLE_PATHS.state_summary);
    const currentStateMetaPath = repoPath(repoRoot, ROLE_PATHS.active_plan_pointer);
    const openQuestionsPath = repoPath(repoRoot, ROLE_PATHS.open_questions);
    const metricsPath = repoPath(repoRoot, ROLE_PATHS.metric_source);

    const currentStateMarkdown = readText(currentStatePath);
    const currentStateMeta = readJson(currentStateMetaPath);
    const openQuestionsMarkdown = readText(openQuestionsPath);
    const metricsMarkdown = readText(metricsPath);

    for (const [artifactPath, content] of [
      [ROLE_PATHS.state_summary, currentStateMarkdown],
      [ROLE_PATHS.open_questions, openQuestionsMarkdown],
      [ROLE_PATHS.metric_source, metricsMarkdown],
    ]) {
      const owner = extractMarkdownOwner(content);
      if (owner && owner !== ADAPTER_OWNER) {
        return blockedPromotion(
          state,
          "owner_mismatch",
          `Restore the canonical owner metadata for \`${artifactPath}\` and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
          `\`${artifactPath}\` is no longer owned by \`${ADAPTER_OWNER}\`.`,
        );
      }
    }
    if (currentStateMeta.owner && currentStateMeta.owner !== ADAPTER_OWNER) {
      return blockedPromotion(
        state,
        "owner_mismatch",
        `Restore the canonical owner metadata for \`${ROLE_PATHS.active_plan_pointer}\` and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
        `\`${ROLE_PATHS.active_plan_pointer}\` is no longer owned by \`${ADAPTER_OWNER}\`.`,
      );
    }

    const openQuestionsState = buildOpenQuestionsState(openQuestionsMarkdown, durableDelta);
    const updatedMeta = buildCurrentStateMeta(currentStateMeta, durableDelta, openQuestionsState.blockers, updatedAt);
    const currentStateDocument = buildCurrentStateDocument(currentStateMarkdown, durableDelta, updatedMeta);
    const metricsDocument = buildMetricsSourceDocument(metricsMarkdown, durableDelta);

    if (artifactPaths.includes(ROLE_PATHS.state_summary)) {
      validateRenderedArtifact(ROLE_PATHS.state_summary, currentStateDocument);
      patches.push({
        artifactPath: ROLE_PATHS.state_summary,
        targetPath: currentStatePath,
        originalExists: true,
        originalText: currentStateMarkdown,
        nextText: currentStateDocument,
      });
    }

    if (artifactPaths.includes(ROLE_PATHS.active_plan_pointer)) {
      const renderedMeta = `${JSON.stringify(updatedMeta, null, 2)}\n`;
      validateRenderedArtifact(ROLE_PATHS.active_plan_pointer, renderedMeta);
      patches.push({
        artifactPath: ROLE_PATHS.active_plan_pointer,
        targetPath: currentStateMetaPath,
        originalExists: true,
        originalText: `${JSON.stringify(currentStateMeta, null, 2)}\n`,
        nextText: renderedMeta,
      });
    }

    if (artifactPaths.includes(ROLE_PATHS.open_questions)) {
      validateRenderedArtifact(ROLE_PATHS.open_questions, openQuestionsState.markdown);
      patches.push({
        artifactPath: ROLE_PATHS.open_questions,
        targetPath: openQuestionsPath,
        originalExists: true,
        originalText: openQuestionsMarkdown,
        nextText: openQuestionsState.markdown,
      });
    }

    if (artifactPaths.includes(ROLE_PATHS.metric_source)) {
      validateRenderedArtifact(ROLE_PATHS.metric_source, metricsDocument);
      patches.push({
        artifactPath: ROLE_PATHS.metric_source,
        targetPath: metricsPath,
        originalExists: true,
        originalText: metricsMarkdown,
        nextText: metricsDocument,
      });
    }

    const decisionSlugSeen = new Set();
    for (const entry of durableDelta.decision_entries) {
      if (decisionSlugSeen.has(entry.slug)) {
        return blockedPromotion(
          state,
          "ambiguous_target",
          `Ensure each decision entry uses a unique slug before rerunning \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
          `Decision slug \`${entry.slug}\` appears more than once in the durable delta.`,
        );
      }
      decisionSlugSeen.add(entry.slug);

      const artifactPath = decisionArtifactPathForSlug(entry.slug);
      if (!artifactPaths.includes(artifactPath)) {
        continue;
      }

      const targetPath = repoPath(repoRoot, artifactPath);
      const originalExists = existsSync(targetPath);
      const originalText = originalExists ? readText(targetPath) : "";
      if (originalExists) {
        const owner = extractMarkdownOwner(originalText);
        if (owner && owner !== ADAPTER_OWNER) {
          return blockedPromotion(
            state,
            "owner_mismatch",
            `Restore the canonical owner metadata for \`${artifactPath}\` and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
            `\`${artifactPath}\` is no longer owned by \`${ADAPTER_OWNER}\`.`,
          );
        }
      }

      const renderedDecision = renderDecisionDocument(originalText, entry, updatedAt);
      validateRenderedArtifact(artifactPath, renderedDecision);
      patches.push({
        artifactPath,
        targetPath,
        originalExists,
        originalText,
        nextText: renderedDecision,
      });
    }
  } catch (error) {
    if (error instanceof HarnessError) {
      const reason = /duplicate/i.test(error.message) ? "conflicting_duplicate_ids" : "malformed_delta";
      return blockedPromotion(
        state,
        reason,
        `Repair the durable delta or canonical docs and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
        error.message,
      );
    }
    throw error;
  }

  const changedPatches = patches.filter((patch) => patch.nextText !== patch.originalText);
  if (!changedPatches.length) {
    return promotionResult(state, {
      promotionState: "noop",
      reason: "no_canonical_change",
      nextAction: `Run \`node scripts/theme-ops.mjs close --slug ${slug}\` when the rest of closeout is ready.`,
      changedArtifacts: [],
      message: "The recorded durable delta did not change any canonical durable-context artifacts.",
      status: "noop",
    });
  }

  const stagedPatches = changedPatches.map((patch, index) => {
    const tempPath = `${patch.targetPath}.tmp-${process.pid}-${Date.now()}-${index}`;
    mkdirSync(path.dirname(tempPath), { recursive: true });
    writeFileSync(tempPath, patch.nextText, "utf8");
    return {
      ...patch,
      tempPath,
    };
  });

  const applied = [];
  try {
    for (const patch of stagedPatches) {
      replaceArtifact({
        targetPath: patch.targetPath,
        tempPath: patch.tempPath,
        nextText: patch.nextText,
      });
      applied.push(patch);
    }
  } catch (error) {
    for (const patch of applied.reverse()) {
      if (patch.originalExists) {
        writeFileSync(patch.targetPath, patch.originalText, "utf8");
      } else if (existsSync(patch.targetPath)) {
        rmSync(patch.targetPath, { force: true });
      }
    }
    for (const patch of stagedPatches) {
      if (existsSync(patch.tempPath)) {
        rmSync(patch.tempPath, { force: true });
      }
    }
    return blockedPromotion(
      state,
      "write_failure",
      `Fix the filesystem issue and rerun \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`; already-touched canonical files were restored.`,
      `Durable-context promotion failed while replacing canonical artifacts: ${error instanceof Error ? error.message : String(error)}`,
      applied.map((patch) => patch.artifactPath),
    );
  }

  for (const patch of stagedPatches) {
    if (existsSync(patch.tempPath)) {
      rmSync(patch.tempPath, { force: true });
    }
  }

  return promotionResult(state, {
    promotionState: "applied",
    reason: "durable_delta_applied",
    nextAction: `Run \`node scripts/theme-ops.mjs close --slug ${slug}\` when the rest of closeout is ready.`,
    changedArtifacts: changedPatches.map((patch) => patch.artifactPath),
    message: "Durable context was promoted into the canonical docs/context surface.",
    status: "applied",
  });
}

function parseCommandLine() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      slug: { type: "string" },
    },
  });

  return {
    slug: values.slug,
  };
}

export async function main() {
  const payload = promoteDurableContext(parseCommandLine());
  printJson(payload);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    if (error instanceof HarnessError) {
      printJson(actionPayload({ status: error.status, message: error.message, details: error.details }));
      process.exit(1);
    }
    throw error;
  });
}
