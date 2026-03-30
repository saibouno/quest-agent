import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
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
  createInitialState,
  determineGuidance,
  getRepoRootFromImport,
  loadState,
  mergeGatePayload,
  mergePolicyUsesWaitPath,
  nowIso,
  ownerBoundary,
  printJson,
  saveState,
  statePath,
  summaryIsRecorded,
  writeText,
} from "./theme-harness-lib.mjs";

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
    status: "pass",
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
      ready,
      wait_for_merge: waitForMerge,
      next_action: waitForMerge && mergeGate.merge_gate_required
        ? mergeGate.merge_gate_next_action
        : ready
          ? "Use the repo's normal git closeout flow manually."
          : guidance.next_action,
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
