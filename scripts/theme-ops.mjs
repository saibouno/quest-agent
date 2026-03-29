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
  actionPayload,
  aftercareIsRecorded,
  assertRootOwnedCwd,
  briefStubContent,
  closeoutIsReady,
  createInitialState,
  determineGuidance,
  getRepoRootFromImport,
  loadState,
  nowIso,
  ownerBoundary,
  printJson,
  saveState,
  statePath,
  summaryIsRecorded,
  writeText,
} from "./theme-harness-lib.mjs";

const REPO_ROOT = getRepoRootFromImport(import.meta.url);

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function runGit(repoRoot, args) {
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `git ${args.map(quoteForCmd).join(" ")}`], {
        cwd: repoRoot,
        encoding: "utf8",
      })
    : spawnSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
      });

  if (result.error) {
    throw new HarnessError("Git command failed.", {
      status: "error",
      details: {
        command: `git ${args.join(" ")}`,
        error: result.error.message,
      },
    });
  }

  if (result.status !== 0) {
    throw new HarnessError("Git command failed.", {
      status: "action_required",
      details: {
        command: `git ${args.join(" ")}`,
        stdout: String(result.stdout || "").trim(),
        stderr: String(result.stderr || "").trim(),
      },
    });
  }
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
  execGit = runGit,
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs start --slug <slug>");

  if (!themeName || !slug) {
    throw new HarnessError("`start` requires both `--theme` and `--slug`.", {
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
    },
  });
}

export function statusTheme({
  repoRoot = REPO_ROOT,
  slug,
} = {}) {
  const state = loadState(repoRoot, slug);
  const guidance = determineGuidance(state);

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
      harness_guidance: guidance,
      current_workflow_status: guidance.workflow_status,
      aftercare_recorded: aftercareIsRecorded(state),
      plain_language_summary_recorded: summaryIsRecorded(state),
      closeout_ready: closeoutIsReady(state),
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
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-ops.mjs close --slug <slug>");

  const state = loadState(repoRoot, slug);
  const guidance = determineGuidance(state);
  const ready = guidance.policy === HARNESS_POLICY_DEFAULT ? closeoutIsReady(state) : true;

  return actionPayload({
    status: "pass",
    message: ready ? "Local closeout readiness satisfied." : "Local closeout readiness is not satisfied yet.",
    details: {
      slug,
      canonical_repo_root: repoRoot,
      owner_boundary: ownerBoundary(),
      harness_policy: guidance.policy,
      harness_policy_reason: guidance.reason,
      current_workflow_status: guidance.workflow_status,
      aftercare_recorded: aftercareIsRecorded(state),
      plain_language_summary_recorded: summaryIsRecorded(state),
      closeout_ready: closeoutIsReady(state),
      ready,
      next_action: ready
        ? "Use the repo's normal git closeout flow manually. `theme-ops.mjs close` does not automate commit, push, PR, merge, or cleanup in v1."
        : guidance.next_action,
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
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
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
