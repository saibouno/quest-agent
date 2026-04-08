import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PORTFOLIO_COORDINATION_SECTION,
  ensurePortfolioCoordinationShape,
  initialInvalidPortfolioSummary,
} from "./theme-portfolio-contract.mjs";

export const SCHEMA_VERSION = 1;
export const BRIEF_STUB_SENTINEL = "<!-- theme-brief:fill-me -->";

export const HARNESS_POLICY_DEFAULT = "default";
export const HARNESS_POLICY_EXEMPT = "exempt";
export const HARNESS_POLICY_LEGACY = "legacy";
export const MERGE_POLICY_MANUAL = "manual";
export const MERGE_POLICY_AUTO_AFTER_GREEN = "auto_after_green";
export const ROLLBACK_CLASS_MANUAL = "manual";
export const ROLLBACK_CLASS_SIMPLE_REVERT = "simple_revert";
export const MERGE_GATE_REASON_POLICY_MANUAL = "policy_manual";
export const MERGE_GATE_REASON_ELIGIBLE_READY = "eligible_ready";
export const MERGE_GATE_REASON_MISSING_CONFIRMED_BRIEF = "missing_confirmed_brief";
export const MERGE_GATE_REASON_PLAN_NOT_REVIEWED = "plan_not_reviewed";
export const MERGE_GATE_REASON_CHECKS_NOT_GREEN = "checks_not_green";
export const MERGE_GATE_REASON_CLOSEOUT_MISSING = "closeout_missing";
export const MERGE_GATE_REASON_KNOWN_ISSUES_MISSING = "known_issues_missing";
export const MERGE_GATE_REASON_ROLLBACK_NOT_SIMPLE_REVERT = "rollback_not_simple_revert";
export const MERGE_GATE_REASON_NOT_ROUTINE_ELIGIBLE = "not_routine_eligible";
export const CONTEXT_PROMOTION_STATE_PENDING = "pending";
export const CONTEXT_PROMOTION_STATE_NOOP = "noop";
export const CONTEXT_PROMOTION_STATE_APPLIED = "applied";
export const CONTEXT_PROMOTION_STATE_BLOCKED = "blocked";
export const CONTEXT_PROMOTION_SUCCESS_STATES = new Set([
  CONTEXT_PROMOTION_STATE_NOOP,
  CONTEXT_PROMOTION_STATE_APPLIED,
]);

export const WORKFLOW_STATUSES = new Set([
  "plan_drafted",
  "plan_reviewed",
  "implementing",
  "verified",
  "closeout_ready",
  "approved",
  "rejected",
  "blocked",
]);

export const HUMAN_ONLY_STATUSES = new Set(["approved", "rejected"]);
export const OWNER_ONLY_STATUSES = new Set(["plan_reviewed", "verified", "closeout_ready"]);

export class HarnessError extends Error {
  constructor(message, { status = "error", details = {} } = {}) {
    super(message);
    this.name = "HarnessError";
    this.status = status;
    this.details = details;
  }
}

function runGitCommand(checkoutRoot, args) {
  return spawnSync("git", args, {
    cwd: checkoutRoot,
    encoding: "utf8",
  });
}

export function detectCanonicalRepoRootFromFileSystem(checkoutRoot) {
  const gitPath = path.join(checkoutRoot, ".git");
  if (!existsSync(gitPath)) {
    return checkoutRoot;
  }

  const stat = lstatSync(gitPath);
  if (stat.isDirectory()) {
    return checkoutRoot;
  }

  const match = /^gitdir:\s*(.+)$/m.exec(readText(gitPath));
  if (!match) {
    return checkoutRoot;
  }

  const resolvedGitDir = path.resolve(checkoutRoot, match[1].trim());
  const parts = resolvedGitDir.split(path.sep);
  const worktreesIndex = parts.lastIndexOf("worktrees");
  if (worktreesIndex > 0 && parts[worktreesIndex - 1] === ".git") {
    return path.dirname(path.dirname(path.dirname(resolvedGitDir)));
  }

  if (path.basename(resolvedGitDir) === ".git") {
    return path.dirname(resolvedGitDir);
  }

  return checkoutRoot;
}

export function resolveCanonicalRepoRootFromGitCommonDir(gitCommonDir, checkoutRoot) {
  const trimmed = String(gitCommonDir || "").trim();
  if (!trimmed) {
    return "";
  }

  const resolvedGitCommonDir = path.isAbsolute(trimmed) ? normalizePath(trimmed) : path.resolve(checkoutRoot, trimmed);
  const parts = resolvedGitCommonDir.split(path.sep);
  const worktreesIndex = parts.lastIndexOf("worktrees");
  if (worktreesIndex > 0 && parts[worktreesIndex - 1] === ".git") {
    return normalizePath(path.dirname(path.dirname(path.dirname(resolvedGitCommonDir))));
  }

  if (path.basename(resolvedGitCommonDir) === ".git") {
    return normalizePath(path.dirname(resolvedGitCommonDir));
  }

  return "";
}

function gitStdout(checkoutRoot, args, execGit) {
  const result = execGit(checkoutRoot, args);
  if (result?.error) {
    throw result.error;
  }

  if (result?.status !== 0) {
    throw new HarnessError("Git command failed.", {
      status: "action_required",
      details: {
        command: `git ${args.join(" ")}`,
        cwd: checkoutRoot,
        stdout: String(result?.stdout || "").trim(),
        stderr: String(result?.stderr || "").trim(),
      },
    });
  }

  return String(result?.stdout || "").trim();
}

function packageInstallPath(toolingRoot, packageName) {
  return path.join(toolingRoot, ...String(packageName || "").split("/"), "package.json");
}

function missingToolingPackagesMessage({
  checkoutRoot,
  canonicalRepoRoot,
  toolingRoot,
  missingPackages,
}) {
  const missingList = missingPackages.map((packageName) => `\`${packageName}\``).join(", ");
  const useCheckoutInstall = normalizePath(toolingRoot) === normalizePath(path.join(checkoutRoot, "node_modules"));
  const installRoot = useCheckoutInstall ? checkoutRoot : canonicalRepoRoot;
  const reason = useCheckoutInstall
    ? `Checkout-local tooling is preferred when \`${path.join(checkoutRoot, "node_modules")}\` exists.`
    : `No checkout-local \`node_modules\` directory was found, so the canonical repo root fallback was selected.`;

  return [
    `Missing required tooling package(s) ${missingList} under \`${toolingRoot}\`.`,
    reason,
    `Run \`npm.cmd ci\` in \`${installRoot}\` to restore the expected install before rerunning this command.`,
  ].join(" ");
}

export function detectCanonicalRepoRoot(checkoutRoot, { execGit = runGitCommand } = {}) {
  const normalizedCheckoutRoot = normalizePath(checkoutRoot);

  try {
    const gitCommonDir = gitStdout(
      normalizedCheckoutRoot,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      execGit,
    );
    const canonicalRepoRoot = resolveCanonicalRepoRootFromGitCommonDir(gitCommonDir, normalizedCheckoutRoot);
    if (canonicalRepoRoot) {
      return canonicalRepoRoot;
    }
  } catch {
    // Fall back to the existing filesystem-based detection for older git or sandbox failures.
  }

  return detectCanonicalRepoRootFromFileSystem(normalizedCheckoutRoot);
}

export function resolveCheckoutRoots(checkoutRoot, { execGit = runGitCommand, requiredPackages = [] } = {}) {
  const normalizedCheckoutRoot = normalizePath(checkoutRoot);
  const canonicalRepoRoot = detectCanonicalRepoRoot(normalizedCheckoutRoot, { execGit });
  const checkoutToolingRoot = path.join(normalizedCheckoutRoot, "node_modules");
  const canonicalToolingRoot = path.join(canonicalRepoRoot, "node_modules");
  const toolingRoot = existsSync(checkoutToolingRoot) ? checkoutToolingRoot : canonicalToolingRoot;
  const missingPackages = [...new Set((Array.isArray(requiredPackages) ? requiredPackages : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .filter((packageName) => !existsSync(packageInstallPath(toolingRoot, packageName)));

  if (missingPackages.length) {
    throw new HarnessError(
      missingToolingPackagesMessage({
        checkoutRoot: normalizedCheckoutRoot,
        canonicalRepoRoot,
        toolingRoot,
        missingPackages,
      }),
      {
        status: "action_required",
        details: {
          checkout_root: normalizedCheckoutRoot,
          canonical_repo_root: canonicalRepoRoot,
          tooling_root: toolingRoot,
          missing_packages: missingPackages,
        },
      },
    );
  }

  return {
    checkoutRoot: normalizedCheckoutRoot,
    canonicalRepoRoot,
    toolingRoot,
    toolingProjectRoot: normalizePath(path.dirname(toolingRoot)),
  };
}

export function getRepoRootFromImport(importMetaUrl) {
  const checkoutRoot = path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
  return detectCanonicalRepoRoot(checkoutRoot);
}

export function normalizePath(value) {
  return path.resolve(String(value || "").trim());
}

export function nowIso() {
  return new Date().toISOString();
}

export function hashContent(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function outputDir(repoRoot) {
  return path.join(repoRoot, "output", "theme_ops");
}

export function statePath(repoRoot, slug) {
  return path.join(outputDir(repoRoot), `${slug}.json`);
}

export function artifactPath(repoRoot, slug, kind) {
  return path.join(outputDir(repoRoot), `${slug}-${kind}.md`);
}

export function briefPathFor(repoRoot, slug) {
  return artifactPath(repoRoot, slug, "brief");
}

export function planPathFor(repoRoot, slug) {
  return artifactPath(repoRoot, slug, "plan");
}

export function reviewPathFor(repoRoot, slug) {
  return artifactPath(repoRoot, slug, "review");
}

export function statusPathFor(repoRoot, slug) {
  return artifactPath(repoRoot, slug, "status");
}

export function closeoutPathFor(repoRoot, slug) {
  return artifactPath(repoRoot, slug, "closeout");
}

export function decisionArtifactPathForSlug(slug) {
  return path.posix.join("docs", "context", "decisions", `${String(slug || "").trim()}.md`);
}

export function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

export function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, String(content).replace(/\r?\n/g, "\n"), "utf8");
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function defaultPolicyReason(policy) {
  if (policy === HARNESS_POLICY_EXEMPT) {
    return "Harness is explicitly exempt for this theme in v1.";
  }

  if (policy === HARNESS_POLICY_LEGACY) {
    return "Legacy theme state without explicit harness policy metadata.";
  }

  return "Soft default harness route for new normal themes in quest-agent v1.";
}

export function initialAftercareState() {
  return {
    checked_at: "",
    stuck_points: [],
    prevention_changes: [],
    follow_up_debt: [],
  };
}

export function initialPlainLanguageSummaryState() {
  return {
    recorded_at: "",
    one_line: "",
    what_changed: [],
    can_do: [],
    ops_change: [],
    next_steps: [],
    tech_notes: [],
  };
}

export function initialDurableDeltaState() {
  return {
    current_focus: [],
    next_safe_themes: [],
    fallback_focus: "",
    decision_entries: [],
    open_question_entries: [],
    blocker_entries: [],
    metric_watch: [],
    active_plan_pointer: null,
    plan_status: "",
    resume_condition: "",
    source_refs: [],
    recorded_fields: [],
    baseline_context_hashes: {},
  };
}

export function initialContextPromotionState(required = true) {
  if (!required) {
    return {
      required: false,
      state: CONTEXT_PROMOTION_STATE_NOOP,
      reason: "not_required",
      next_action: "This theme does not require durable-context auto-promotion.",
      updated_at: "",
      changed_artifacts: [],
    };
  }

  return {
    required: true,
    state: CONTEXT_PROMOTION_STATE_PENDING,
    reason: "pending",
    next_action: "Run `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` after `aftercare` and `explain` to evaluate auto-promotion.",
    updated_at: "",
    changed_artifacts: [],
  };
}

export function initialHarnessState(repoRoot, slug) {
  return {
    workflow_status: "",
    current_milestone: "selected",
    next_action: `Fill the canonical brief at \`${briefPathFor(repoRoot, slug)}\` and then run \`node scripts/theme-harness.mjs scaffold-plan --slug ${slug}\`.`,
    plan_path: planPathFor(repoRoot, slug),
    review_path: reviewPathFor(repoRoot, slug),
    status_path: statusPathFor(repoRoot, slug),
    closeout_path: closeoutPathFor(repoRoot, slug),
    review_results: {},
    validation_runs: [],
    known_issues: [],
    follow_ups: [],
    recent_decisions: [],
    updated_at: "",
    updated_by: "",
  };
}

export function initialPortfolioCoordinationState() {
  return {
    envelope: null,
    summary: initialInvalidPortfolioSummary(),
  };
}

export function ensureSourceRefs(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => value && typeof value === "object")
    .map((value) => ({
      kind: String(value.kind || "other"),
      path_or_uri: String(value.path_or_uri || ""),
      locator: String(value.locator || ""),
      captured_at: String(value.captured_at || ""),
    }))
    .filter((value) => value.path_or_uri);
}

function ensureDecisionEntries(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => value && typeof value === "object")
    .map((value) => ({
      slug: String(value.slug || ""),
      title: String(value.title || ""),
      decision: String(value.decision || ""),
      why_it_stands: String(value.why_it_stands || ""),
      operational_consequence: String(value.operational_consequence || ""),
      source_refs: ensureSourceRefs(value.source_refs),
    }))
    .filter((value) => value.slug);
}

function ensureQuestionEntries(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => value && typeof value === "object")
    .map((value) => ({
      id: String(value.id || ""),
      summary: String(value.summary || ""),
      impact: String(value.impact || ""),
      next_unlock: String(value.next_unlock || ""),
      status: String(value.status || ""),
      observed_at: String(value.observed_at || ""),
      resolved_at: String(value.resolved_at || ""),
      last_verified_by: String(value.last_verified_by || ""),
      source_refs: ensureSourceRefs(value.source_refs),
      evidence_ref: String(value.evidence_ref || ""),
    }))
    .filter((value) => value.id);
}

function ensureActivePlanPointer(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    kind: String(value.kind || ""),
    slug: String(value.slug || ""),
    path: String(value.path || ""),
  };
}

export function ensureDurableDeltaShape(value) {
  const durableDelta = value && typeof value === "object" ? value : {};
  const baselineHashes = durableDelta.baseline_context_hashes && typeof durableDelta.baseline_context_hashes === "object"
    ? durableDelta.baseline_context_hashes
    : {};

  return {
    ...initialDurableDeltaState(),
    current_focus: ensureTextEntries(durableDelta.current_focus),
    next_safe_themes: ensureTextEntries(durableDelta.next_safe_themes),
    fallback_focus: String(durableDelta.fallback_focus || ""),
    decision_entries: ensureDecisionEntries(durableDelta.decision_entries),
    open_question_entries: ensureQuestionEntries(durableDelta.open_question_entries),
    blocker_entries: ensureQuestionEntries(durableDelta.blocker_entries),
    metric_watch: ensureTextEntries(durableDelta.metric_watch),
    active_plan_pointer: ensureActivePlanPointer(durableDelta.active_plan_pointer),
    plan_status: String(durableDelta.plan_status || ""),
    resume_condition: String(durableDelta.resume_condition || ""),
    source_refs: ensureSourceRefs(durableDelta.source_refs),
    recorded_fields: ensureTextEntries(durableDelta.recorded_fields),
    baseline_context_hashes: Object.fromEntries(
      Object.entries(baselineHashes)
        .map(([artifactPath, hash]) => [String(artifactPath || ""), String(hash || "")])
        .filter(([artifactPath]) => artifactPath),
    ),
  };
}

export function ensureContextPromotionShape(value, { required = true } = {}) {
  const contextPromotion = value && typeof value === "object" ? value : {};
  const fallback = initialContextPromotionState(required);

  return {
    required: typeof contextPromotion.required === "boolean" ? contextPromotion.required : fallback.required,
    state: String(contextPromotion.state || fallback.state),
    reason: String(contextPromotion.reason || fallback.reason),
    next_action: String(contextPromotion.next_action || fallback.next_action),
    updated_at: String(contextPromotion.updated_at || ""),
    changed_artifacts: ensureTextEntries(contextPromotion.changed_artifacts),
  };
}

export function durableDeltaTouchedArtifacts(durableDelta) {
  const normalized = ensureDurableDeltaShape(durableDelta);
  const touched = new Set();
  const recorded = new Set(normalized.recorded_fields);

  if (
    normalized.current_focus.length
    || normalized.next_safe_themes.length
    || normalized.fallback_focus
    || normalized.decision_entries.length
    || normalized.active_plan_pointer
    || normalized.plan_status
    || normalized.resume_condition
    || normalized.blocker_entries.length
    || recorded.has("active_plan_pointer")
  ) {
    touched.add("docs/context/current-state.md");
  }

  if (
    normalized.active_plan_pointer
    || normalized.plan_status
    || normalized.blocker_entries.length
    || normalized.resume_condition
    || normalized.fallback_focus
    || normalized.source_refs.length
    || recorded.has("active_plan_pointer")
  ) {
    touched.add("docs/context/current-state.meta.json");
  }

  if (normalized.open_question_entries.length || normalized.blocker_entries.length) {
    touched.add("docs/context/open-questions.md");
  }

  if (normalized.metric_watch.length) {
    touched.add("docs/context/metrics-source.md");
  }

  for (const entry of normalized.decision_entries) {
    touched.add(decisionArtifactPathForSlug(entry.slug));
  }

  return [...touched].sort();
}

export function durableDeltaHasStructuredContent(durableDelta) {
  return durableDeltaTouchedArtifacts(durableDelta).length > 0;
}

export function createInitialState({
  repoRoot,
  themeName,
  slug,
  branch,
  worktreePath,
  goal = "",
  doneCondition = "",
  expectedEndState = "merge_and_delete",
  requiredChecks = [],
  harnessPolicy = HARNESS_POLICY_DEFAULT,
  harnessReason = "",
  mergePolicy = MERGE_POLICY_MANUAL,
  rollbackClass = ROLLBACK_CLASS_MANUAL,
}) {
  const normalizedPolicy = harnessPolicy || HARNESS_POLICY_DEFAULT;
  const contextPromotionRequired = normalizedPolicy === HARNESS_POLICY_DEFAULT;

  return ensureStateShape(
    {
      schema_version: SCHEMA_VERSION,
      theme_name: themeName,
      slug,
      repo_root: repoRoot,
      branch,
      worktree_path: worktreePath,
      goal,
      done_condition: doneCondition,
      expected_end_state: expectedEndState,
      required_checks: requiredChecks,
      harness_policy: normalizedPolicy,
      harness_policy_reason: harnessReason || defaultPolicyReason(normalizedPolicy),
      merge_policy: mergePolicy || MERGE_POLICY_MANUAL,
      rollback_class: rollbackClass || ROLLBACK_CLASS_MANUAL,
      brief_path: briefPathFor(repoRoot, slug),
      created_at: nowIso(),
      updated_at: nowIso(),
      aftercare: initialAftercareState(),
      plain_language_summary: initialPlainLanguageSummaryState(),
      durable_delta: initialDurableDeltaState(),
      context_promotion: initialContextPromotionState(contextPromotionRequired),
      portfolio_coordination: initialPortfolioCoordinationState(),
      harness: initialHarnessState(repoRoot, slug),
    },
    { repoRoot, slug },
  );
}

export function ensureTextEntries(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

export function ensureStateShape(state, { repoRoot, slug }) {
  const resolvedRepoRoot = repoRoot || normalizePath(state.repo_root || process.cwd());
  const resolvedSlug = slug || String(state.slug || "").trim();
  const resolvedPolicy = String(state.harness_policy || "").trim() || HARNESS_POLICY_LEGACY;
  const resolvedMergePolicy = String(state.merge_policy || "").trim() || MERGE_POLICY_MANUAL;
  const resolvedRollbackClass = String(state.rollback_class || "").trim() || ROLLBACK_CLASS_MANUAL;
  const harness = state.harness && typeof state.harness === "object" ? { ...state.harness } : {};
  const aftercare = state.aftercare && typeof state.aftercare === "object" ? { ...state.aftercare } : {};
  const summary = state.plain_language_summary && typeof state.plain_language_summary === "object"
    ? { ...state.plain_language_summary }
    : {};
  const durableDelta = state.durable_delta && typeof state.durable_delta === "object" ? { ...state.durable_delta } : {};
  const contextPromotion = state.context_promotion && typeof state.context_promotion === "object"
    ? { ...state.context_promotion }
    : {};
  const portfolioCoordination = state.portfolio_coordination && typeof state.portfolio_coordination === "object"
    ? { ...state.portfolio_coordination }
    : {};
  const contextPromotionRequired = resolvedPolicy === HARNESS_POLICY_DEFAULT;

  return {
    schema_version: Number(state.schema_version || SCHEMA_VERSION),
    theme_name: String(state.theme_name || resolvedSlug || "untitled theme"),
    slug: resolvedSlug,
    repo_root: resolvedRepoRoot,
    branch: String(state.branch || `codex/${resolvedSlug}`),
    worktree_path: String(state.worktree_path || path.join(resolvedRepoRoot, ".worktrees", resolvedSlug)),
    goal: String(state.goal || ""),
    done_condition: String(state.done_condition || ""),
    expected_end_state: String(state.expected_end_state || "merge_and_delete"),
    required_checks: ensureTextEntries(state.required_checks),
    harness_policy: resolvedPolicy,
    harness_policy_reason: String(state.harness_policy_reason || defaultPolicyReason(resolvedPolicy)),
    merge_policy: resolvedMergePolicy,
    rollback_class: resolvedRollbackClass,
    brief_path: String(state.brief_path || briefPathFor(resolvedRepoRoot, resolvedSlug)),
    created_at: String(state.created_at || nowIso()),
    updated_at: String(state.updated_at || nowIso()),
    aftercare: {
      checked_at: String(aftercare.checked_at || ""),
      stuck_points: ensureTextEntries(aftercare.stuck_points),
      prevention_changes: ensureTextEntries(aftercare.prevention_changes),
      follow_up_debt: ensureTextEntries(aftercare.follow_up_debt),
    },
    plain_language_summary: {
      recorded_at: String(summary.recorded_at || ""),
      one_line: String(summary.one_line || ""),
      what_changed: ensureTextEntries(summary.what_changed),
      can_do: ensureTextEntries(summary.can_do),
      ops_change: ensureTextEntries(summary.ops_change),
      next_steps: ensureTextEntries(summary.next_steps),
      tech_notes: ensureTextEntries(summary.tech_notes),
    },
    durable_delta: ensureDurableDeltaShape(durableDelta),
    context_promotion: ensureContextPromotionShape(contextPromotion, {
      required: contextPromotionRequired,
    }),
    portfolio_coordination: ensurePortfolioCoordinationShape(portfolioCoordination),
    harness: {
      ...initialHarnessState(resolvedRepoRoot, resolvedSlug),
      ...harness,
      plan_path: String(harness.plan_path || planPathFor(resolvedRepoRoot, resolvedSlug)),
      review_path: String(harness.review_path || reviewPathFor(resolvedRepoRoot, resolvedSlug)),
      status_path: String(harness.status_path || statusPathFor(resolvedRepoRoot, resolvedSlug)),
      closeout_path: String(harness.closeout_path || closeoutPathFor(resolvedRepoRoot, resolvedSlug)),
      review_results: harness.review_results && typeof harness.review_results === "object" ? harness.review_results : {},
      validation_runs: Array.isArray(harness.validation_runs) ? harness.validation_runs : [],
      known_issues: ensureTextEntries(harness.known_issues),
      follow_ups: ensureTextEntries(harness.follow_ups),
      recent_decisions: ensureTextEntries(harness.recent_decisions),
      updated_at: String(harness.updated_at || ""),
      updated_by: String(harness.updated_by || ""),
    },
  };
}

export function loadState(repoRoot, slug) {
  const target = statePath(repoRoot, slug);
  if (!existsSync(target)) {
    throw new HarnessError(`Theme state not found for slug \`${slug}\`.`, {
      status: "action_required",
      details: {
        slug,
        state_path: target,
      },
    });
  }

  return ensureStateShape(readJson(target), { repoRoot, slug });
}

export function saveState(repoRoot, state) {
  const normalized = ensureStateShape(state, { repoRoot, slug: state.slug });
  normalized.updated_at = nowIso();
  writeJson(statePath(repoRoot, normalized.slug), normalized);
  return normalized;
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseMarkdownSections(markdown) {
  const sections = {};
  let currentHeading = "";
  let buffer = [];

  for (const line of String(markdown || "").replace(/\r\n/g, "\n").split("\n")) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (currentHeading) {
        sections[currentHeading] = buffer.join("\n").trim();
      }
      currentHeading = headingMatch[1].trim();
      buffer = [];
      continue;
    }

    if (currentHeading) {
      buffer.push(line);
    }
  }

  if (currentHeading) {
    sections[currentHeading] = buffer.join("\n").trim();
  }

  return sections;
}

export function readSummaryField(summarySection, label) {
  const match = new RegExp(`^-\\s*${escapeRegExp(label)}:\\s*(.+)$`, "mi").exec(String(summarySection || ""));
  if (!match) {
    return "";
  }

  return match[1].trim().replace(/^`(.+)`$/u, "$1");
}

export function renderList(items, emptyLine = "- none recorded") {
  const normalized = ensureTextEntries(items);
  if (!normalized.length) {
    return emptyLine;
  }

  return normalized.map((item) => `- ${item}`).join("\n");
}

export function defaultSharedCoreRisk() {
  return "No shared-core or protected-file changes are planned in this v1 harness adoption; if that changes, return to the approval boundary.";
}

export function defaultImportantInterfaces() {
  return "- No public API, schema, or product-facing contract changes are planned in this v1 harness adoption.";
}

export function defaultApprovalBoundary() {
  return "Stay inside `quest-agent` and the local harness surface. Do not extract shared code or add external mutations in v1.";
}

export function defaultPublishBoundary(mergePolicy = MERGE_POLICY_MANUAL) {
  if (mergePolicy === MERGE_POLICY_AUTO_AFTER_GREEN) {
    return "Continue through local closeout and the eligible `close --wait-for-merge` merge-and-cleanup path only when the shared merge gate is ready.";
  }

  return "Stop at local closeout and a local commit. Push, PR creation, and merge handling stay out of scope unless the confirmed brief explicitly extends the lane.";
}

export function defaultOutOfScope() {
  return [
    "- Shared extraction with `cafe-agent-os`.",
    "- Eval runners, observability/event log surfaces, or model-policy work beyond this local harness loop.",
    "- Cross-repo merge executor unification beyond Quest Agent's repo-local routine lane.",
    "- Remote push, PR creation, and remote branch cleanup automation in `theme-ops.mjs close`.",
  ].join("\n");
}

export function defaultAssumptions() {
  return [
    "- This theme updates only `quest-agent`.",
    "- Generated harness artifacts stay scratch-only under `output/theme_ops/`.",
    "- `approved` and `rejected` remain human-only workflow vocabulary in v1.",
  ].join("\n");
}

export function defaultTestPlan(requiredChecks) {
  const commands = ensureTextEntries(requiredChecks);
  if (!commands.length) {
    return "- No saved verification commands were recorded yet.";
  }

  return commands.map((command) => `- \`${command}\``).join("\n");
}

export function renderTemplate(templateText, replacements) {
  let result = String(templateText || "");
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return result;
}

export function buildPlanFromBrief({ briefText, state, templateText }) {
  const sections = parseMarkdownSections(briefText);
  const summarySection = sections.Summary || "";
  const defaultPortfolioEnvelope = [
    "```json",
    "{",
    "  \"plan_ref\": \"theme:<fill:plan-ref>\",",
    "  \"plan_id\": \"<fill:plan-id>\",",
    "  \"plan_version\": \"1\",",
    "  \"parent_goal\": \"<fill:parent-goal>\",",
    "  \"affected_surfaces\": [",
    "    \"path:<fill:affected-surface>\"",
    "  ],",
    "  \"surface_confidence\": \"confidence:medium\",",
    "  \"expected_artifacts\": [",
    "    \"artifact:<fill:expected-artifact>\"",
    "  ],",
    "  \"prerequisites\": [",
    "    \"foundation:<fill:prerequisite>\"",
    "  ]",
    "}",
    "```",
  ].join("\n");
  const publishBoundary = readSummaryField(summarySection, "Publish / handoff boundary")
    || readSummaryField(summarySection, "Publish boundary")
    || readSummaryField(summarySection, "Handoff boundary")
    || defaultPublishBoundary(state.merge_policy);
  const replacements = {
    THEME_NAME: readSummaryField(summarySection, "Theme name") || state.theme_name,
    BRANCH: state.branch,
    WORKTREE_PATH: state.worktree_path,
    GOAL: readSummaryField(summarySection, "Goal") || state.goal || "Document the confirmed goal in the canonical brief before implementation.",
    DONE_CONDITION: readSummaryField(summarySection, "Done condition") || state.done_condition || "Finish the requested theme and verify the saved commands.",
    EXPECTED_END_STATE: readSummaryField(summarySection, "Expected end state") || state.expected_end_state || "merge_and_delete",
    SHARED_CORE_RISK: readSummaryField(summarySection, "Shared-core / hot-file risk") || defaultSharedCoreRisk(),
    MERGE_POLICY: state.merge_policy || MERGE_POLICY_MANUAL,
    ROLLBACK_CLASS: state.rollback_class || ROLLBACK_CLASS_MANUAL,
    PUBLISH_BOUNDARY: publishBoundary,
    BRIEF_PATH: state.brief_path,
    KEY_CHANGES: sections["Key Changes"] || "- Capture the implementation changes in the canonical brief before scaffold-plan.",
    IMPORTANT_INTERFACES: sections["Important Interfaces"] || defaultImportantInterfaces(),
    APPROVAL_BOUNDARY: sections["Approval Boundary"] || defaultApprovalBoundary(),
    OUT_OF_SCOPE: sections["Out Of Scope"] || defaultOutOfScope(),
    TEST_PLAN: sections["Test Plan"] || defaultTestPlan(state.required_checks),
    ASSUMPTIONS: sections.Assumptions || defaultAssumptions(),
    PORTFOLIO_COORDINATION_ENVELOPE: sections[PORTFOLIO_COORDINATION_SECTION] || defaultPortfolioEnvelope,
  };

  return renderTemplate(templateText, replacements).trimEnd() + "\n";
}

export function briefStubContent(state) {
  const lines = [
    "# Theme Brief",
    "",
    BRIEF_STUB_SENTINEL,
    "",
    "Replace this stub with the confirmed brief before running `node scripts/theme-harness.mjs scaffold-plan --slug <slug>`.",
    "",
    "## Summary",
    "",
    `- Theme name: ${state.theme_name}`,
    `- Branch / worktree: \`${state.branch}\` / \`${state.worktree_path}\``,
    `- Goal: ${state.goal || "<fill:goal>"}`,
    `- Done condition: ${state.done_condition || "<fill:done-condition>"}`,
    `- Expected end state: ${state.expected_end_state || "merge_and_delete"}`,
    `- Merge Policy: \`${state.merge_policy || MERGE_POLICY_MANUAL}\``,
    `- Rollback Class: \`${state.rollback_class || ROLLBACK_CLASS_MANUAL}\``,
    `- Publish / handoff boundary: ${defaultPublishBoundary(state.merge_policy)}`,
    "",
    "## Key Changes",
    "",
    "- <fill:key-changes>",
    "",
    "## Test Plan",
    "",
    state.required_checks.length ? defaultTestPlan(state.required_checks) : "- <fill:test-plan>",
    "",
    "## Assumptions",
    "",
    "- <fill:assumptions>",
    "",
    `## ${PORTFOLIO_COORDINATION_SECTION}`,
    "",
    "```json",
    "{",
    "  \"plan_ref\": \"theme:<fill:plan-ref>\",",
    "  \"plan_id\": \"<fill:plan-id>\",",
    "  \"plan_version\": \"1\",",
    "  \"parent_goal\": \"<fill:parent-goal>\",",
    "  \"affected_surfaces\": [",
    "    \"path:<fill:affected-surface>\"",
    "  ],",
    "  \"surface_confidence\": \"confidence:medium\",",
    "  \"expected_artifacts\": [",
    "    \"artifact:<fill:expected-artifact>\"",
    "  ],",
    "  \"prerequisites\": [",
    "    \"foundation:<fill:prerequisite>\"",
    "  ]",
    "}",
    "```",
    "",
  ];

  return lines.join("\n");
}

export function hasBriefStubSentinel(text) {
  return String(text || "").includes(BRIEF_STUB_SENTINEL);
}

export function pushRecentDecision(state, entry) {
  const current = ensureTextEntries(state.harness.recent_decisions);
  current.unshift(entry);
  state.harness.recent_decisions = current.slice(0, 8);
}

export function updateHarnessMetadata(state, { milestone, nextAction, updatedBy = "" }) {
  if (milestone) {
    state.harness.current_milestone = milestone;
  }
  if (nextAction) {
    state.harness.next_action = nextAction;
  }
  state.harness.updated_at = nowIso();
  state.harness.updated_by = String(updatedBy || "");
}

export function renderStatusNote(state, templateText) {
  const replacements = {
    THEME_NAME: state.theme_name,
    SLUG: state.slug,
    WORKFLOW_STATUS: state.harness.workflow_status || "selected",
    CURRENT_MILESTONE: state.harness.current_milestone || "selected",
    NEXT_ACTION: state.harness.next_action || "No next action recorded.",
    UPDATED_AT: state.harness.updated_at || state.updated_at,
    UPDATED_BY: state.harness.updated_by || "system",
    KNOWN_ISSUES: renderList(state.harness.known_issues),
    FOLLOW_UPS: renderList(state.harness.follow_ups),
    RECENT_DECISIONS: renderList(state.harness.recent_decisions),
  };

  return renderTemplate(templateText, replacements).trimEnd() + "\n";
}

export function saveStatusNote(state, templateText) {
  const target = state.harness.status_path;
  writeText(target, renderStatusNote(state, templateText));
  return target;
}

export function renderReviewReport(state) {
  const review = state.harness.review_results || {};
  const checklist = Array.isArray(review.checklist_results) ? review.checklist_results : [];
  const findings = ensureTextEntries(review.finding_codes);

  return [
    "# Theme Plan Review",
    "",
    `- schema_version: \`${review.schema_version || SCHEMA_VERSION}\``,
    `- result: \`${review.result || "unknown"}\``,
    "",
    "## Checklist",
    "",
    ...checklist.map((item) => `- [${item.result}] \`${item.item_id}\` ${item.label}${item.message ? ` - ${item.message}` : ""}`),
    checklist.length ? "" : "- none recorded",
    "",
    "## Findings",
    "",
    findings.length ? findings.map((code) => `- \`${code}\``) : ["- none"],
    "",
  ].join("\n");
}

export function renderValidationRuns(values) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) {
    return "- No validation runs were recorded.";
  }

  return rows.map((row) => `- [${row.status || "unknown"}] \`${row.command || ""}\``).join("\n");
}

export function renderCloseoutDraft(state, templateText) {
  const summary = state.plain_language_summary;
  const whyLines = state.harness.recent_decisions.length
    ? renderList(state.harness.recent_decisions)
    : "- Local harness adoption for deterministic plan, review, verification, and closeout flow.";
  const impactLines = ensureTextEntries([...summary.can_do, ...summary.ops_change]);
  const knownIssues = ensureTextEntries([
    ...state.harness.known_issues,
    ...state.harness.follow_ups,
    ...state.aftercare.follow_up_debt,
  ]);

  return renderTemplate(templateText, {
    PLAIN_LANGUAGE_SUMMARY: summary.one_line || "- Plain-language summary not recorded.",
    CHANGED: renderList(summary.what_changed),
    WHY: whyLines,
    IMPACT: renderList(impactLines),
    VERIFICATION: renderValidationRuns(state.harness.validation_runs),
    KNOWN_ISSUES: renderList(knownIssues, "- none"),
  }).trimEnd() + "\n";
}

export function actionPayload({ status = "pass", message = "", details = {} } = {}) {
  return {
    status,
    message,
    ...details,
  };
}

export function verifyWorkflowStatus(state, allowed, commandName) {
  const status = String(state.harness.workflow_status || "");
  if (!status) {
    throw new HarnessError(`\`${commandName}\` requires \`scaffold-plan\` to initialize the harness state.`, {
      status: "action_required",
      details: {
        allowed: [...allowed],
      },
    });
  }

  if (!allowed.has(status)) {
    throw new HarnessError(`\`${commandName}\` cannot run from workflow status \`${status}\`.`, {
      status: "action_required",
      details: {
        workflow_status: status,
        allowed: [...allowed],
      },
    });
  }

  return status;
}

export function ownerBoundary() {
  return {
    root_owned: [
      "node scripts/theme-ops.mjs start ...",
      "node scripts/theme-ops.mjs setup --slug <slug>",
      "node scripts/theme-ops.mjs aftercare --slug <slug> ...",
      "node scripts/theme-ops.mjs explain --slug <slug> ...",
      "node scripts/theme-ops.mjs close --slug <slug> [--wait-for-merge]",
    ],
    worktree_owned: [
      "node scripts/theme-harness.mjs scaffold-plan --slug <slug>",
      "node scripts/theme-harness.mjs review-plan --slug <slug>",
      "node scripts/theme-harness.mjs set-status --slug <slug> --to implementing|blocked",
      "node scripts/theme-harness.mjs verify --slug <slug>",
      "node scripts/theme-harness.mjs scaffold-closeout --slug <slug>",
    ],
  };
}

export function assertRootOwnedCwd(repoRoot, cwd, command) {
  if (normalizePath(cwd) !== normalizePath(repoRoot)) {
    throw new HarnessError(`${command} must run from the canonical repo root.`, {
      status: "action_required",
      details: {
        expected_cwd: normalizePath(repoRoot),
        actual_cwd: normalizePath(cwd),
        remediation: `Run \`${command}\` from ${normalizePath(repoRoot)}.`,
      },
    });
  }
}

export function determineGuidance(state) {
  const policy = String(state.harness_policy || HARNESS_POLICY_LEGACY);
  const workflowStatus = String(state.harness.workflow_status || "");

  if (policy === HARNESS_POLICY_EXEMPT) {
    return {
      policy,
      reason: state.harness_policy_reason,
      workflow_status: workflowStatus || "not_applicable",
      next_action: "Harness is exempt for this theme in v1.",
    };
  }

  if (policy === HARNESS_POLICY_LEGACY) {
    return {
      policy,
      reason: state.harness_policy_reason,
      workflow_status: workflowStatus || "legacy",
      next_action: "Legacy theme state. No harness backfill is required in v1.",
    };
  }

  if (!workflowStatus) {
    return {
      policy,
      reason: state.harness_policy_reason,
      workflow_status: "not_started",
      next_action: `Fill the canonical brief at \`${state.brief_path}\` and run \`node scripts/theme-harness.mjs scaffold-plan --slug ${state.slug}\`.`,
    };
  }

  const nextActionByStatus = {
    plan_drafted: `Run \`node scripts/theme-harness.mjs review-plan --slug ${state.slug}\`.`,
    plan_reviewed: `Run \`node scripts/theme-harness.mjs set-status --slug ${state.slug} --to implementing\`.`,
    implementing: "Finish implementation and then run `node scripts/theme-harness.mjs verify --slug <slug>`.",
    blocked: "Resolve the blocker and then return to `implementing` with `set-status` or rerun `verify`.",
    verified: `Run \`node scripts/theme-ops.mjs aftercare --slug ${state.slug} ...\`, \`node scripts/theme-ops.mjs explain --slug ${state.slug} ...\`, and then \`node scripts/theme-harness.mjs scaffold-closeout --slug ${state.slug}\` to auto-promote durable context before closeout.`,
    closeout_ready: mergePolicyUsesWaitPath(state.merge_policy)
      ? `Run \`node scripts/theme-ops.mjs close --slug ${state.slug} --wait-for-merge\` from the repo root.`
      : `Run \`node scripts/theme-ops.mjs close --slug ${state.slug}\` from the repo root.`,
  };

  return {
    policy,
    reason: state.harness_policy_reason,
    workflow_status: workflowStatus,
    next_action: nextActionByStatus[workflowStatus] || state.harness.next_action || "Continue the recorded harness workflow.",
  };
}

export function summaryIsRecorded(state) {
  return Boolean(state.plain_language_summary.recorded_at);
}

export function aftercareIsRecorded(state) {
  return Boolean(state.aftercare.checked_at);
}

export function contextPromotionIsSatisfied(state) {
  if (!state.context_promotion?.required) {
    return true;
  }

  return CONTEXT_PROMOTION_SUCCESS_STATES.has(String(state.context_promotion?.state || ""));
}

export function closeoutIsReady(state) {
  return String(state.harness.workflow_status || "") === "closeout_ready"
    && existsSync(state.harness.closeout_path)
    && contextPromotionIsSatisfied(state);
}

export function briefIsConfirmed(state) {
  return existsSync(state.brief_path) && !hasBriefStubSentinel(readText(state.brief_path));
}

export function planReviewIsPassed(state) {
  return existsSync(state.harness.review_path) && String(state.harness.review_results?.result || "") === "pass";
}

export function latestValidationRunByCommand(state) {
  const latest = new Map();
  for (const run of Array.isArray(state.harness.validation_runs) ? state.harness.validation_runs : []) {
    const command = String(run?.command || "").trim();
    if (command) {
      latest.set(command, run);
    }
  }
  return latest;
}

export function savedRequiredChecksAreGreen(state) {
  const requiredChecks = ensureTextEntries(state.required_checks);
  if (!requiredChecks.length) {
    return false;
  }

  const latestByCommand = latestValidationRunByCommand(state);
  return requiredChecks.every((command) => latestByCommand.get(command)?.status === "pass");
}

export function closeoutSections(state) {
  if (!existsSync(state.harness.closeout_path)) {
    return {};
  }

  return parseMarkdownSections(readText(state.harness.closeout_path));
}

export function closeoutSectionHasContent(text, { allowNone = false } = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }

  if (allowNone && /^(?:-\s*)?none(?:\s+recorded)?$/iu.test(normalized)) {
    return true;
  }

  return true;
}

export function closeoutKnownIssuesRecorded(state) {
  const sections = closeoutSections(state);
  return closeoutSectionHasContent(
    sections["Known Issues / Follow-ups"] || sections["Known Issues / Follow-Ups"] || "",
    { allowNone: true },
  );
}

export function mergePolicyUsesWaitPath(mergePolicy) {
  return String(mergePolicy || "").trim() === MERGE_POLICY_AUTO_AFTER_GREEN;
}

export function mergeGatePayload(state) {
  const mergePolicy = String(state.merge_policy || MERGE_POLICY_MANUAL).trim() || MERGE_POLICY_MANUAL;
  const rollbackClass = String(state.rollback_class || ROLLBACK_CLASS_MANUAL).trim() || ROLLBACK_CLASS_MANUAL;
  const guidance = determineGuidance(state);

  if (mergePolicy === MERGE_POLICY_MANUAL) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: false,
      merge_gate_ready: true,
      merge_gate_reason: MERGE_GATE_REASON_POLICY_MANUAL,
      merge_gate_next_action: "Merge remains a human checkpoint for this theme.",
    };
  }

  if (mergePolicy !== MERGE_POLICY_AUTO_AFTER_GREEN || state.harness_policy !== HARNESS_POLICY_DEFAULT || state.expected_end_state !== "merge_and_delete") {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_NOT_ROUTINE_ELIGIBLE,
      merge_gate_next_action: "Use `manual` for exempt, legacy, or non-merge-and-delete themes.",
    };
  }

  if (rollbackClass !== ROLLBACK_CLASS_SIMPLE_REVERT) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_ROLLBACK_NOT_SIMPLE_REVERT,
      merge_gate_next_action: `Restart the theme with \`--merge-policy ${MERGE_POLICY_MANUAL}\` or \`--rollback-class ${ROLLBACK_CLASS_SIMPLE_REVERT}\`.`,
    };
  }

  if (!briefIsConfirmed(state)) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_MISSING_CONFIRMED_BRIEF,
      merge_gate_next_action: `Fill the canonical brief at \`${state.brief_path}\` and remove the stub sentinel.`,
    };
  }

  if (!planReviewIsPassed(state)) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_PLAN_NOT_REVIEWED,
      merge_gate_next_action: `Run \`node scripts/theme-harness.mjs review-plan --slug ${state.slug}\`.`,
    };
  }

  if (!savedRequiredChecksAreGreen(state)) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_CHECKS_NOT_GREEN,
      merge_gate_next_action: `Run \`node scripts/theme-harness.mjs verify --slug ${state.slug}\`.`,
    };
  }

  if (!closeoutIsReady(state)) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_CLOSEOUT_MISSING,
      merge_gate_next_action: guidance.next_action,
    };
  }

  if (!closeoutKnownIssuesRecorded(state)) {
    return {
      merge_policy: mergePolicy,
      current_workflow_status: guidance.workflow_status,
      merge_gate_required: true,
      merge_gate_ready: false,
      merge_gate_reason: MERGE_GATE_REASON_KNOWN_ISSUES_MISSING,
      merge_gate_next_action: `Update \`${state.harness.closeout_path}\` so \`## Known Issues / Follow-ups\` is recorded.`,
    };
  }

  return {
    merge_policy: mergePolicy,
    current_workflow_status: guidance.workflow_status,
    merge_gate_required: true,
    merge_gate_ready: true,
    merge_gate_reason: MERGE_GATE_REASON_ELIGIBLE_READY,
    merge_gate_next_action: `Run \`node scripts/theme-ops.mjs close --slug ${state.slug} --wait-for-merge\` from the repo root.`,
  };
}

export function relativeRepoPath(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath) || ".";
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}${os.EOL}`);
}
