import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  CONTEXT_PROMOTION_STATE_PENDING,
  HARNESS_POLICY_DEFAULT,
  HARNESS_POLICY_EXEMPT,
  HARNESS_POLICY_LEGACY,
  HarnessError,
  MERGE_POLICY_AUTO_AFTER_GREEN,
  MERGE_POLICY_MANUAL,
  ROLLBACK_CLASS_MANUAL,
  ROLLBACK_CLASS_SIMPLE_REVERT,
  actionPayload,
  aftercareIsRecorded,
  assertRootOwnedCwd,
  briefStubContent,
  closeoutIsReady,
  durableDeltaTouchedArtifacts,
  createInitialState,
  determineGuidance,
  getRepoRootFromImport,
  hashContent,
  loadState,
  mergeGatePayload,
  mergePolicyUsesWaitPath,
  nowIso,
  ownerBoundary,
  printJson,
  readText,
  saveState,
  statePath,
  summaryIsRecorded,
  writeText,
} from "./theme-harness-lib.mjs";
import { portfolioSummaryDisplay } from "./theme-portfolio-contract.mjs";
import { evaluateWorkflowStateBridgeDecision } from "./theme-workflow-state-bridge.mjs";

const REPO_ROOT = getRepoRootFromImport(import.meta.url);

function runGit(repoRoot, args, { cwd = repoRoot } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.error) {
    throw new HarnessError("Git command failed.", {
      status: "error",
      details: {
        command: `git ${args.join(" ")}`,
        cwd,
        error: result.error.message,
      },
    });
  }

  if (result.status !== 0) {
    throw new HarnessError("Git command failed.", {
      status: "action_required",
      details: {
        command: `git ${args.join(" ")}`,
        cwd,
        stdout: String(result.stdout || "").trim(),
        stderr: String(result.stderr || "").trim(),
      },
    });
  }

  return result;
}

function gitStdout(repoRoot, args, execGit = runGit, cwd = repoRoot) {
  const result = execGit(repoRoot, args, { cwd });
  return String(result?.stdout || "").trim();
}

function bridgeArtifactInput(targetPath, { includeText = false } = {}) {
  const normalizedPath = String(targetPath || "").trim();
  const artifactExists = Boolean(normalizedPath) && existsSync(normalizedPath);
  return {
    path: normalizedPath,
    exists: artifactExists,
    text: includeText && artifactExists ? readText(normalizedPath) : "",
  };
}

const CONTEXT_PROMOTION_SUCCESS_STATES = new Set(["applied", "noop"]);
const DURABLE_ENTRY_STATUS = new Set(["open", "resolved", "superseded"]);
const DECISION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MISSING_FILE_HASH = "__missing__";

function durableArtifactAbsolutePath(repoRoot, artifactPath) {
  return path.join(repoRoot, ...String(artifactPath || "").split("/"));
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

function parseJsonFlag(value, label) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new HarnessError(`Malformed ${label}.`, {
      status: "action_required",
      details: {
        label,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function normalizeSourceRefInput(value, label) {
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

function normalizeSourceRefList(values, label, { required = false } = {}) {
  const list = Array.isArray(values) ? values : [];
  if (required && !list.length) {
    throw new HarnessError(`${label} must include at least one source ref.`, {
      status: "action_required",
    });
  }

  return list.map((value, index) => normalizeSourceRefInput(value, `${label}[${index}]`));
}

function normalizeDecisionSlug(value, label) {
  const normalized = normalizeRequiredString(value, label);
  if (!DECISION_SLUG_PATTERN.test(normalized)) {
    throw new HarnessError(`${label} must use lowercase letters, numbers, and hyphens only.`, {
      status: "action_required",
    });
  }
  return normalized;
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

function normalizeDecisionEntryInput(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be an object.`, {
      status: "action_required",
    });
  }

  return {
    slug: normalizeDecisionSlug(value.slug, `${label}.slug`),
    title: normalizeRequiredString(value.title, `${label}.title`),
    decision: normalizeRequiredString(value.decision, `${label}.decision`),
    why_it_stands: normalizeRequiredString(value.why_it_stands, `${label}.why_it_stands`),
    operational_consequence: normalizeRequiredString(value.operational_consequence, `${label}.operational_consequence`),
    source_refs: normalizeSourceRefList(value.source_refs, `${label}.source_refs`, { required: true }),
  };
}

function normalizeQuestionEntryInput(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be an object.`, {
      status: "action_required",
    });
  }

  const status = normalizeRequiredString(value.status, `${label}.status`);
  if (!DURABLE_ENTRY_STATUS.has(status)) {
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
    source_refs: normalizeSourceRefList(value.source_refs, `${label}.source_refs`),
    evidence_ref: normalizeOptionalString(value.evidence_ref),
  };
}

function normalizeActivePlanPointerInput(value, label) {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be null or an object.`, {
      status: "action_required",
    });
  }

  return {
    kind: normalizeRequiredString(value.kind, `${label}.kind`),
    slug: normalizeRequiredString(value.slug, `${label}.slug`),
    path: normalizeRequiredString(value.path, `${label}.path`),
  };
}

function captureDurableDeltaBaseline(repoRoot, artifactPaths) {
  return Object.fromEntries(
    [...new Set(Array.isArray(artifactPaths) ? artifactPaths : [])].sort().map((artifactPath) => {
      const absolutePath = durableArtifactAbsolutePath(repoRoot, artifactPath);
      const hash = existsSync(absolutePath) ? hashContent(readText(absolutePath)) : MISSING_FILE_HASH;
      return [artifactPath, hash];
    }),
  );
}

function normalizeExplainDurableDelta({
  repoRoot,
  currentFocus = [],
  nextSafeThemes = [],
  decisionJson = [],
  openQuestionJson = [],
  blockerJson = [],
  metricWatch = [],
  activePlanJson = undefined,
  planStatus = "",
  resumeCondition = "",
  fallbackFocusValues = [],
  sourceRefJson = [],
} = {}) {
  if (fallbackFocusValues.length > 1) {
    throw new HarnessError("`--fallback-focus` accepts only one value.", {
      status: "action_required",
    });
  }

  const normalized = {
    current_focus: [...new Set((Array.isArray(currentFocus) ? currentFocus : []).map(normalizeOptionalString).filter(Boolean))],
    next_safe_themes: [...new Set((Array.isArray(nextSafeThemes) ? nextSafeThemes : []).map(normalizeOptionalString).filter(Boolean))],
    fallback_focus: normalizeOptionalString(fallbackFocusValues[0] || ""),
    decision_entries: (Array.isArray(decisionJson) ? decisionJson : [])
      .map((value, index) => normalizeDecisionEntryInput(parseJsonFlag(value, "--decision-json"), `decision_entries[${index}]`)),
    open_question_entries: (Array.isArray(openQuestionJson) ? openQuestionJson : [])
      .map((value, index) => normalizeQuestionEntryInput(parseJsonFlag(value, "--open-question-json"), `open_question_entries[${index}]`)),
    blocker_entries: (Array.isArray(blockerJson) ? blockerJson : [])
      .map((value, index) => normalizeQuestionEntryInput(parseJsonFlag(value, "--blocker-json"), `blocker_entries[${index}]`)),
    metric_watch: [...new Set((Array.isArray(metricWatch) ? metricWatch : []).map(normalizeOptionalString).filter(Boolean))],
    active_plan_pointer: activePlanJson === undefined
      ? null
      : normalizeActivePlanPointerInput(parseJsonFlag(activePlanJson, "--active-plan-json"), "active_plan_pointer"),
    plan_status: normalizeOptionalString(planStatus),
    resume_condition: normalizeOptionalString(resumeCondition),
    source_refs: (Array.isArray(sourceRefJson) ? sourceRefJson : [])
      .map((value, index) => normalizeSourceRefInput(parseJsonFlag(value, "--source-ref-json"), `source_refs[${index}]`)),
  };

  normalized.recorded_fields = [
    normalized.current_focus.length ? "current_focus" : "",
    normalized.next_safe_themes.length ? "next_safe_themes" : "",
    normalized.fallback_focus ? "fallback_focus" : "",
    normalized.decision_entries.length ? "decision_entries" : "",
    normalized.open_question_entries.length ? "open_question_entries" : "",
    normalized.blocker_entries.length ? "blocker_entries" : "",
    normalized.metric_watch.length ? "metric_watch" : "",
    activePlanJson !== undefined ? "active_plan_pointer" : "",
    normalized.plan_status ? "plan_status" : "",
    normalized.resume_condition ? "resume_condition" : "",
    normalized.source_refs.length ? "source_refs" : "",
  ].filter(Boolean);

  const artifactPaths = new Set(durableDeltaTouchedArtifacts(normalized));

  normalized.baseline_context_hashes = artifactPaths.size
    ? captureDurableDeltaBaseline(repoRoot, [...artifactPaths])
    : {};

  return normalized;
}

function contextPromotionPayload(state) {
  return {
    context_promotion_required: Boolean(state.context_promotion?.required),
    context_promotion_state: String(state.context_promotion?.state || CONTEXT_PROMOTION_STATE_PENDING),
    context_promotion_reason: String(state.context_promotion?.reason || "pending"),
    context_promotion_next_action: String(state.context_promotion?.next_action || ""),
    context_promotion_changed_artifacts: Array.isArray(state.context_promotion?.changed_artifacts)
      ? state.context_promotion.changed_artifacts
      : [],
  };
}

function commitThemeWorktreeIfNeeded(repoRoot, state, execGit = runGit) {
  const worktreeStatus = gitStdout(repoRoot, ["status", "--porcelain"], execGit, state.worktree_path);
  if (!worktreeStatus) {
    return false;
  }

  execGit(repoRoot, ["add", "-A"], { cwd: state.worktree_path });
  execGit(repoRoot, ["commit", "-m", state.theme_name], { cwd: state.worktree_path });
  return true;
}

function mergeAndCleanupTheme(repoRoot, state, execGit = runGit) {
  const currentRootBranch = gitStdout(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], execGit, repoRoot);
  if (currentRootBranch !== "main") {
    throw new HarnessError("`close --wait-for-merge` must run from the canonical `main` checkout.", {
      status: "action_required",
      details: {
        current_branch: currentRootBranch || "unknown",
      },
    });
  }

  const rootStatus = gitStdout(repoRoot, ["status", "--porcelain"], execGit, repoRoot);
  if (rootStatus) {
    throw new HarnessError("Root checkout is dirty; refusing to merge an auto lane theme into `main`.", {
      status: "action_required",
      details: {
        current_branch: currentRootBranch,
      },
    });
  }

  const committedWorktreeChanges = commitThemeWorktreeIfNeeded(repoRoot, state, execGit);
  execGit(repoRoot, ["merge", "--no-ff", "--no-edit", state.branch], { cwd: repoRoot });
  if (existsSync(state.worktree_path)) {
    execGit(repoRoot, ["worktree", "remove", state.worktree_path], { cwd: repoRoot });
  }
  execGit(repoRoot, ["branch", "-d", state.branch], { cwd: repoRoot });

  return {
    committed_worktree_changes: committedWorktreeChanges,
  };
}

export function startTheme({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
  themeName,
  slug,
  branch = "",
  worktree = "",
  goal = "",
  doneCondition = "",
  expectedEndState = "merge_and_delete",
  requiredChecks = [],
  harnessPolicy = HARNESS_POLICY_DEFAULT,
  harnessReason = "",
  mergePolicy = MERGE_POLICY_MANUAL,
  rollbackClass = ROLLBACK_CLASS_MANUAL,
  execGit = runGit,
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs start --slug <slug>");

  if (!themeName || !slug) {
    throw new HarnessError("`start` requires both `--theme` and `--slug`.", {
      status: "action_required",
    });
  }

  const normalizedMergePolicy = String(mergePolicy || MERGE_POLICY_MANUAL).trim() || MERGE_POLICY_MANUAL;
  const normalizedRollbackClass = String(rollbackClass || ROLLBACK_CLASS_MANUAL).trim() || ROLLBACK_CLASS_MANUAL;
  if (![MERGE_POLICY_MANUAL, MERGE_POLICY_AUTO_AFTER_GREEN].includes(normalizedMergePolicy)) {
    throw new HarnessError("Unsupported merge policy.", {
      status: "action_required",
      details: {
        merge_policy: normalizedMergePolicy,
      },
    });
  }
  if (![ROLLBACK_CLASS_MANUAL, ROLLBACK_CLASS_SIMPLE_REVERT].includes(normalizedRollbackClass)) {
    throw new HarnessError("Unsupported rollback class.", {
      status: "action_required",
      details: {
        rollback_class: normalizedRollbackClass,
      },
    });
  }
  if (normalizedMergePolicy === MERGE_POLICY_AUTO_AFTER_GREEN && expectedEndState !== "merge_and_delete") {
    throw new HarnessError("`auto_after_green` requires `--expected-end-state merge_and_delete`.", {
      status: "action_required",
    });
  }
  if (normalizedMergePolicy === MERGE_POLICY_AUTO_AFTER_GREEN && normalizedRollbackClass !== ROLLBACK_CLASS_SIMPLE_REVERT) {
    throw new HarnessError("`auto_after_green` requires `--rollback-class simple_revert`.", {
      status: "action_required",
    });
  }

  const targetStatePath = statePath(repoRoot, slug);
  if (existsSync(targetStatePath)) {
    const existing = loadState(repoRoot, slug);
    return actionPayload({
      status: "already_exists",
      message: "Theme state already exists.",
      details: {
        slug,
        state_path: targetStatePath,
        branch: existing.branch,
        worktree_path: existing.worktree_path,
        brief_path: existing.brief_path,
        merge_policy: existing.merge_policy,
        rollback_class: existing.rollback_class,
      },
    });
  }

  const resolvedBranch = branch || `codex/${slug}`;
  const resolvedWorktree = path.resolve(worktree || path.join(repoRoot, ".worktrees", slug));
  if (!existsSync(resolvedWorktree)) {
    execGit(repoRoot, ["worktree", "add", resolvedWorktree, "-b", resolvedBranch]);
  }

  const state = createInitialState({
    repoRoot,
    themeName,
    slug,
    branch: resolvedBranch,
    worktreePath: resolvedWorktree,
    goal,
    doneCondition,
    expectedEndState,
    requiredChecks,
    harnessPolicy,
    harnessReason,
    mergePolicy: normalizedMergePolicy,
    rollbackClass: normalizedRollbackClass,
  });

  writeText(state.brief_path, briefStubContent(state));
  saveState(repoRoot, state);

  return actionPayload({
    status: "pass",
    message: "Theme started.",
    details: {
      slug,
      branch: resolvedBranch,
      worktree_path: resolvedWorktree,
      brief_path: state.brief_path,
      state_path: targetStatePath,
      required_checks: state.required_checks,
      harness_policy: state.harness_policy,
      merge_policy: state.merge_policy,
      rollback_class: state.rollback_class,
    },
  });
}

export function statusTheme({
  repoRoot = REPO_ROOT,
  slug,
} = {}) {
  const state = loadState(repoRoot, slug);
  const guidance = determineGuidance(state);
  const mergeGate = mergeGatePayload(state);
  const portfolioSummary = portfolioSummaryDisplay(state, repoRoot);
  const bridgeDecision = evaluateWorkflowStateBridgeDecision({
    slug: state.slug,
    harness_policy: state.harness_policy,
    workflow_status: state.harness.workflow_status,
    review_result: state.harness.review_results?.result,
    plan_artifact: bridgeArtifactInput(state.harness.plan_path, { includeText: true }),
    review_artifact: bridgeArtifactInput(state.harness.review_path),
    closeout_artifact: bridgeArtifactInput(state.harness.closeout_path),
    closeout_ready: closeoutIsReady(state),
    portfolio_envelope_plan_id: state.portfolio_coordination?.envelope?.plan_id,
    portfolio_summary: portfolioSummary.portfolio_summary_valid
      ? {
          coordination_status: portfolioSummary.portfolio_coordination_status,
          status_reason: portfolioSummary.portfolio_status_reason,
          shared_contract_ref: portfolioSummary.portfolio_shared_contract_ref,
        }
      : null,
  });

  return actionPayload({
    status: "pass",
    message: "Theme status loaded.",
    details: {
      slug,
      canonical_repo_root: repoRoot,
      owner_boundary: ownerBoundary(),
      branch: state.branch,
      worktree_path: state.worktree_path,
      state_path: statePath(repoRoot, slug),
      brief_path: state.brief_path,
      required_checks: state.required_checks,
      merge_policy: state.merge_policy,
      rollback_class: state.rollback_class,
      harness_guidance: guidance,
      current_workflow_status: guidance.workflow_status,
      aftercare_recorded: aftercareIsRecorded(state),
      plain_language_summary_recorded: summaryIsRecorded(state),
      closeout_ready: closeoutIsReady(state),
      ...contextPromotionPayload(state),
      bridge_decision: bridgeDecision,
      ...portfolioSummary,
      ...mergeGate,
    },
  });
}

export function setupTheme({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
  slug,
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs setup --slug <slug>");

  const state = loadState(repoRoot, slug);
  if (!state.harness_policy || ![HARNESS_POLICY_DEFAULT, HARNESS_POLICY_EXEMPT, HARNESS_POLICY_LEGACY].includes(state.harness_policy)) {
    state.harness_policy = HARNESS_POLICY_LEGACY;
    state.harness_policy_reason = "Legacy theme state without explicit harness policy metadata.";
  } else if (!state.harness_policy_reason) {
    if (state.harness_policy === HARNESS_POLICY_EXEMPT) {
      state.harness_policy_reason = "Harness is explicitly exempt for this theme in v1.";
    } else if (state.harness_policy === HARNESS_POLICY_DEFAULT) {
      state.harness_policy_reason = "Soft default harness route for new normal themes in quest-agent v1.";
    } else {
      state.harness_policy_reason = "Legacy theme state without explicit harness policy metadata.";
    }
  }

  state.context_promotion.required = state.harness_policy === HARNESS_POLICY_DEFAULT;
  if (!state.context_promotion.required) {
    state.context_promotion.state = "noop";
    state.context_promotion.reason = "not_required";
    state.context_promotion.next_action = "This theme does not require durable-context auto-promotion.";
  } else if (!state.context_promotion.state || state.context_promotion.state === "not_required") {
    state.context_promotion.state = CONTEXT_PROMOTION_STATE_PENDING;
    state.context_promotion.reason = "pending";
    state.context_promotion.next_action = "Run `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` after `aftercare` and `explain` to evaluate auto-promotion.";
  }

  saveState(repoRoot, state);

  return actionPayload({
    status: "pass",
    message: "Harness guidance metadata refreshed.",
    details: {
      slug,
      harness_policy: state.harness_policy,
      harness_policy_reason: state.harness_policy_reason,
      brief_path: state.brief_path,
      state_path: statePath(repoRoot, slug),
      merge_policy: state.merge_policy,
      rollback_class: state.rollback_class,
    },
  });
}

export function recordAftercare({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
  slug,
  stuckPoints = [],
  preventionChanges = [],
  followUpDebt = [],
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs aftercare --slug <slug> ...");

  if (!stuckPoints.length || !preventionChanges.length) {
    throw new HarnessError("`aftercare` requires at least one `--stuck-point` and one `--prevention-change`.", {
      status: "action_required",
    });
  }

  const state = loadState(repoRoot, slug);
  state.aftercare.checked_at = nowIso();
  state.aftercare.stuck_points = [...new Set(stuckPoints)];
  state.aftercare.prevention_changes = [...new Set(preventionChanges)];
  state.aftercare.follow_up_debt = [...new Set(followUpDebt)];
  state.harness.recent_decisions = [
    "Implementation aftercare was recorded.",
    ...state.harness.recent_decisions,
  ].slice(0, 8);
  saveState(repoRoot, state);

  return actionPayload({
    status: "pass",
    message: "Aftercare recorded.",
    details: {
      slug,
      checked_at: state.aftercare.checked_at,
      stuck_points: state.aftercare.stuck_points,
      prevention_changes: state.aftercare.prevention_changes,
      follow_up_debt: state.aftercare.follow_up_debt,
    },
  });
}

export function recordExplain({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
  slug,
  oneLine,
  whatChanged = [],
  canDo = [],
  opsChange = [],
  nextSteps = [],
  techNotes = [],
  currentFocus = [],
  nextSafeThemes = [],
  decisionJson = [],
  openQuestionJson = [],
  blockerJson = [],
  metricWatch = [],
  activePlanJson = undefined,
  planStatus = "",
  resumeCondition = "",
  fallbackFocusValues = [],
  sourceRefJson = [],
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs explain --slug <slug> ...");

  if (!oneLine) {
    throw new HarnessError("`explain` requires `--one-line`.", {
      status: "action_required",
    });
  }

  const state = loadState(repoRoot, slug);
  state.plain_language_summary.recorded_at = nowIso();
  state.plain_language_summary.one_line = oneLine;
  state.plain_language_summary.what_changed = [...new Set(whatChanged)];
  state.plain_language_summary.can_do = [...new Set(canDo)];
  state.plain_language_summary.ops_change = [...new Set(opsChange)];
  state.plain_language_summary.next_steps = [...new Set(nextSteps)];
  state.plain_language_summary.tech_notes = [...new Set(techNotes)];
  state.durable_delta = normalizeExplainDurableDelta({
    repoRoot,
    currentFocus,
    nextSafeThemes,
    decisionJson,
    openQuestionJson,
    blockerJson,
    metricWatch,
    activePlanJson,
    planStatus,
    resumeCondition,
    fallbackFocusValues,
    sourceRefJson,
  });
  const durableDeltaRecorded = Object.keys(state.durable_delta.baseline_context_hashes).length > 0;
  state.context_promotion.required = state.harness_policy === HARNESS_POLICY_DEFAULT;
  if (state.context_promotion.required) {
    state.context_promotion.state = CONTEXT_PROMOTION_STATE_PENDING;
    state.context_promotion.reason = durableDeltaRecorded
      ? "recorded_structured_delta"
      : "pending_no_structured_delta";
    state.context_promotion.next_action = `Run \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\` to auto-promote durable context before closeout.`;
    state.context_promotion.updated_at = nowIso();
    state.context_promotion.changed_artifacts = [];
  } else {
    state.context_promotion.state = "noop";
    state.context_promotion.reason = "not_required";
    state.context_promotion.next_action = "This theme does not require durable-context auto-promotion.";
    state.context_promotion.updated_at = nowIso();
    state.context_promotion.changed_artifacts = [];
  }
  state.harness.recent_decisions = [
    "Plain-language closeout summary was recorded.",
    ...state.harness.recent_decisions,
  ].slice(0, 8);
  saveState(repoRoot, state);

  return actionPayload({
    status: "pass",
    message: "Plain-language summary recorded.",
    details: {
      slug,
      recorded_at: state.plain_language_summary.recorded_at,
      one_line: state.plain_language_summary.one_line,
      durable_delta_recorded: durableDeltaRecorded,
      durable_delta_artifacts: Object.keys(state.durable_delta.baseline_context_hashes).sort(),
      ...contextPromotionPayload(state),
    },
  });
}

export function closeTheme({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
  slug,
  waitForMerge = false,
  execGit = runGit,
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs close --slug <slug>");

  const state = loadState(repoRoot, slug);
  const guidance = determineGuidance(state);
  const mergeGate = mergeGatePayload(state);
  const ready = guidance.policy === HARNESS_POLICY_DEFAULT ? closeoutIsReady(state) : true;
  const promotion = contextPromotionPayload(state);
  const portfolioSummary = portfolioSummaryDisplay(state, repoRoot);

  if (waitForMerge && mergePolicyUsesWaitPath(state.merge_policy)) {
    if (!mergeGate.merge_gate_ready) {
      return actionPayload({
        status: "action_required",
        message: "Routine merge gate is not satisfied yet.",
        details: {
          slug,
          canonical_repo_root: repoRoot,
          owner_boundary: ownerBoundary(),
          harness_policy: guidance.policy,
          harness_policy_reason: guidance.reason,
          rollback_class: state.rollback_class,
          aftercare_recorded: aftercareIsRecorded(state),
          plain_language_summary_recorded: summaryIsRecorded(state),
          closeout_ready: closeoutIsReady(state),
          ...promotion,
          ...portfolioSummary,
          ready,
          wait_for_merge: true,
          next_action: mergeGate.merge_gate_next_action,
          ...mergeGate,
        },
      });
    }

    const mergeResult = mergeAndCleanupTheme(repoRoot, state, execGit);
    return actionPayload({
      status: "pass",
      message: "Routine theme merged into local main and cleaned up.",
      details: {
        slug,
        canonical_repo_root: repoRoot,
        owner_boundary: ownerBoundary(),
        harness_policy: guidance.policy,
        harness_policy_reason: guidance.reason,
        rollback_class: state.rollback_class,
        aftercare_recorded: aftercareIsRecorded(state),
        plain_language_summary_recorded: summaryIsRecorded(state),
        closeout_ready: closeoutIsReady(state),
        ...promotion,
        ...portfolioSummary,
        ready,
        wait_for_merge: true,
        merged: true,
        next_action: "Local merge-and-cleanup completed. Push, PR, and remote branch cleanup remain repo-local follow-up work.",
        ...mergeGate,
        ...mergeResult,
      },
    });
  }

  return actionPayload({
    status: ready ? "pass" : "action_required",
    message: ready ? "Local closeout readiness satisfied." : "Local closeout readiness is not satisfied yet.",
    details: {
      slug,
      canonical_repo_root: repoRoot,
      owner_boundary: ownerBoundary(),
      harness_policy: guidance.policy,
      harness_policy_reason: guidance.reason,
      merge_policy: state.merge_policy,
      rollback_class: state.rollback_class,
      current_workflow_status: guidance.workflow_status,
      aftercare_recorded: aftercareIsRecorded(state),
      plain_language_summary_recorded: summaryIsRecorded(state),
      closeout_ready: closeoutIsReady(state),
      ...promotion,
      ...portfolioSummary,
      ready,
      wait_for_merge: waitForMerge,
      next_action: waitForMerge && mergeGate.merge_gate_required
        ? mergeGate.merge_gate_next_action
        : ready
          ? "Use the repo's normal git closeout flow manually."
          : CONTEXT_PROMOTION_SUCCESS_STATES.has(promotion.context_promotion_state)
            ? guidance.next_action
            : promotion.context_promotion_next_action || guidance.next_action,
      ...mergeGate,
    },
  });
}

function parseCommandLine() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "start": {
      const { values } = parseArgs({
        args: rest,
        options: {
          theme: { type: "string" },
          slug: { type: "string" },
          branch: { type: "string" },
          worktree: { type: "string" },
          goal: { type: "string" },
          "done-condition": { type: "string" },
          "expected-end-state": { type: "string" },
          "check-cmd": { type: "string", multiple: true },
          "harness-policy": { type: "string" },
          "harness-reason": { type: "string" },
          "merge-policy": { type: "string" },
          "rollback-class": { type: "string" },
        },
      });
      return {
        command,
        values: {
          themeName: values.theme,
          slug: values.slug,
          branch: values.branch || "",
          worktree: values.worktree || "",
          goal: values.goal || "",
          doneCondition: values["done-condition"] || "",
          expectedEndState: values["expected-end-state"] || "merge_and_delete",
          requiredChecks: values["check-cmd"] || [],
          harnessPolicy: values["harness-policy"] || HARNESS_POLICY_DEFAULT,
          harnessReason: values["harness-reason"] || "",
          mergePolicy: values["merge-policy"] || MERGE_POLICY_MANUAL,
          rollbackClass: values["rollback-class"] || ROLLBACK_CLASS_MANUAL,
        },
      };
    }
    case "status":
    case "setup":
    case "close": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "wait-for-merge": { type: "boolean" },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          waitForMerge: Boolean(values["wait-for-merge"]),
        },
      };
    }
    case "aftercare": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "stuck-point": { type: "string", multiple: true },
          "prevention-change": { type: "string", multiple: true },
          "follow-up-debt": { type: "string", multiple: true },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          stuckPoints: values["stuck-point"] || [],
          preventionChanges: values["prevention-change"] || [],
          followUpDebt: values["follow-up-debt"] || [],
        },
      };
    }
    case "explain": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "one-line": { type: "string" },
          "what-changed": { type: "string", multiple: true },
          "can-do": { type: "string", multiple: true },
          "ops-change": { type: "string", multiple: true },
          "next-step": { type: "string", multiple: true },
          "tech-note": { type: "string", multiple: true },
          "current-focus": { type: "string", multiple: true },
          "next-safe-theme": { type: "string", multiple: true },
          "decision-json": { type: "string", multiple: true },
          "open-question-json": { type: "string", multiple: true },
          "blocker-json": { type: "string", multiple: true },
          "metric-watch": { type: "string", multiple: true },
          "active-plan-json": { type: "string" },
          "plan-status": { type: "string" },
          "resume-condition": { type: "string" },
          "fallback-focus": { type: "string", multiple: true },
          "source-ref-json": { type: "string", multiple: true },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          oneLine: values["one-line"] || "",
          whatChanged: values["what-changed"] || [],
          canDo: values["can-do"] || [],
          opsChange: values["ops-change"] || [],
          nextSteps: values["next-step"] || [],
          techNotes: values["tech-note"] || [],
          currentFocus: values["current-focus"] || [],
          nextSafeThemes: values["next-safe-theme"] || [],
          decisionJson: values["decision-json"] || [],
          openQuestionJson: values["open-question-json"] || [],
          blockerJson: values["blocker-json"] || [],
          metricWatch: values["metric-watch"] || [],
          activePlanJson: values["active-plan-json"],
          planStatus: values["plan-status"] || "",
          resumeCondition: values["resume-condition"] || "",
          fallbackFocusValues: values["fallback-focus"] || [],
          sourceRefJson: values["source-ref-json"] || [],
        },
      };
    }
    default:
      throw new HarnessError("Unknown theme-ops command.", {
        status: "action_required",
        details: {
          command,
        },
      });
  }
}

export async function main() {
  const { command, values } = parseCommandLine();
  let payload;

  switch (command) {
    case "start":
      payload = startTheme(values);
      break;
    case "status":
      payload = statusTheme(values);
      break;
    case "setup":
      payload = setupTheme(values);
      break;
    case "aftercare":
      payload = recordAftercare(values);
      break;
    case "explain":
      payload = recordExplain(values);
      break;
    case "close":
      payload = closeTheme(values);
      break;
    default:
      throw new HarnessError("Unknown theme-ops command.", {
        status: "action_required",
      });
  }

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
