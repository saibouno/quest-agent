import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  HUMAN_ONLY_STATUSES,
  OWNER_ONLY_STATUSES,
  WORKFLOW_STATUSES,
  HarnessError,
  actionPayload,
  buildPlanFromBrief,
  getRepoRootFromImport,
  hasBriefStubSentinel,
  loadState,
  nowIso,
  printJson,
  pushRecentDecision,
  readText,
  renderCloseoutDraft,
  renderReviewReport,
  saveState,
  saveStatusNote,
  updateHarnessMetadata,
  verifyWorkflowStatus,
  writeText,
} from "./theme-harness-lib.mjs";
import {
  benchmarkRunStub,
  scaffoldBenchmarkPack,
  validateBenchmarkPackCommand,
} from "./harness-benchmark-lib.mjs";
import { promoteDurableContext } from "./promote-durable-context.mjs";
import { evaluatePlanMarkdown } from "./theme-harness-review-core.mjs";

const REPO_ROOT = getRepoRootFromImport(import.meta.url);

function statusTemplatePath(repoRoot) {
  return path.join(repoRoot, "docs", "runbooks", "theme-loop", "STATUS_TEMPLATE.md");
}

function planTemplatePath(repoRoot) {
  return path.join(repoRoot, "docs", "runbooks", "theme-loop", "PLAN_TEMPLATE.md");
}

function closeoutTemplatePath(repoRoot) {
  return path.join(repoRoot, "docs", "runbooks", "theme-loop", "CLOSEOUT_TEMPLATE.md");
}

function runSavedCommand(command, cwd) {
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
        cwd,
        encoding: "utf8",
      })
    : spawnSync(command, {
        cwd,
        shell: true,
        encoding: "utf8",
      });
  const stderr = [result.error?.message || "", String(result.stderr || "").trim()].filter(Boolean).join("\n");

  return {
    command,
    status: !result.error && result.status === 0 ? "pass" : "fail",
    exit_code: result.status ?? 1,
    ran_at: nowIso(),
    stdout: String(result.stdout || "").trim(),
    stderr,
  };
}

export function scaffoldPlan({
  repoRoot = REPO_ROOT,
  slug,
  briefPath = "",
  updatedBy = "system",
} = {}) {
  const state = loadState(repoRoot, slug);
  const targetBriefPath = path.resolve(briefPath || state.brief_path);

  if (!existsSync(targetBriefPath)) {
    throw new HarnessError("Brief file not found.", {
      status: "action_required",
      details: {
        brief_path: targetBriefPath,
      },
    });
  }

  const briefText = readText(targetBriefPath);
  if (hasBriefStubSentinel(briefText)) {
    throw new HarnessError("Brief stub sentinel is still present.", {
      status: "action_required",
      details: {
        brief_path: targetBriefPath,
        remediation: "Replace the brief stub with the confirmed brief and remove the sentinel before running scaffold-plan.",
      },
    });
  }

  state.brief_path = targetBriefPath;
  const planText = buildPlanFromBrief({
    briefText,
    state,
    templateText: readText(planTemplatePath(repoRoot)),
  });

  writeText(state.harness.plan_path, planText);
  state.harness.workflow_status = "plan_drafted";
  updateHarnessMetadata(state, {
    milestone: "plan_drafted",
    nextAction: `Run \`node scripts/theme-harness.mjs review-plan --slug ${slug}\`.`,
    updatedBy,
  });
  pushRecentDecision(state, "Plan scaffolded from the canonical brief.");
  saveStatusNote(state, readText(statusTemplatePath(repoRoot)));
  saveState(repoRoot, state);

  return actionPayload({
    status: "pass",
    message: "Plan scaffolded.",
    details: {
      slug,
      brief_path: state.brief_path,
      plan_path: state.harness.plan_path,
      status_path: state.harness.status_path,
      workflow_status: state.harness.workflow_status,
    },
  });
}

export function reviewPlan({
  repoRoot = REPO_ROOT,
  slug,
  updatedBy = "system",
} = {}) {
  const state = loadState(repoRoot, slug);
  verifyWorkflowStatus(state, new Set(["plan_drafted", "plan_reviewed"]), "review-plan");

  if (!existsSync(state.harness.plan_path)) {
    throw new HarnessError("Plan artifact not found.", {
      status: "action_required",
      details: {
        plan_path: state.harness.plan_path,
      },
    });
  }

  const reviewResult = evaluatePlanMarkdown(readText(state.harness.plan_path));
  state.harness.review_results = reviewResult;
  if (reviewResult.result === "pass") {
    state.harness.workflow_status = "plan_reviewed";
    updateHarnessMetadata(state, {
      milestone: "plan_reviewed",
      nextAction: `Run \`node scripts/theme-harness.mjs set-status --slug ${slug} --to implementing\`.`,
      updatedBy,
    });
    pushRecentDecision(state, "Plan review passed with no deterministic findings.");
  } else {
    state.harness.workflow_status = "plan_drafted";
    updateHarnessMetadata(state, {
      milestone: "plan_revision_required",
      nextAction: `Revise the plan at \`${state.harness.plan_path}\` and rerun \`node scripts/theme-harness.mjs review-plan --slug ${slug}\`.`,
      updatedBy,
    });
    pushRecentDecision(state, `Plan review requires revision: ${reviewResult.finding_codes.join(", ") || "see checklist results"}.`);
  }

  writeText(state.harness.review_path, renderReviewReport(state));
  saveStatusNote(state, readText(statusTemplatePath(repoRoot)));
  saveState(repoRoot, state);

  return actionPayload({
    status: reviewResult.result,
    message: reviewResult.result === "pass" ? "Plan review passed." : "Plan review requires revision.",
    details: {
      slug,
      review_path: state.harness.review_path,
      workflow_status: state.harness.workflow_status,
      review_results: reviewResult,
    },
  });
}

export function setStatus({
  repoRoot = REPO_ROOT,
  slug,
  target,
  note = "",
  knownIssues = [],
  followUps = [],
  updatedBy = "system",
} = {}) {
  const state = loadState(repoRoot, slug);
  const current = String(state.harness.workflow_status || "");

  if (!current) {
    throw new HarnessError("`set-status` requires an initialized harness workflow state.", {
      status: "action_required",
    });
  }

  if (HUMAN_ONLY_STATUSES.has(target)) {
    throw new HarnessError(`\`${target}\` is a human-only workflow state and cannot be set from CLI.`, {
      status: "action_required",
      details: { target },
    });
  }

  if (OWNER_ONLY_STATUSES.has(target)) {
    throw new HarnessError(`\`${target}\` is owned by another harness command and cannot be set manually.`, {
      status: "action_required",
      details: { target },
    });
  }

  if (!WORKFLOW_STATUSES.has(target)) {
    throw new HarnessError("Unknown workflow status.", {
      status: "action_required",
      details: { target },
    });
  }

  const allowedTransitions = new Set([
    "plan_reviewed->implementing",
    "implementing->blocked",
    "blocked->implementing",
  ]);
  const transition = `${current}->${target}`;
  if (!allowedTransitions.has(transition)) {
    throw new HarnessError(`\`${transition}\` is not an allowed workflow transition.`, {
      status: "action_required",
      details: {
        current,
        target,
      },
    });
  }

  state.harness.workflow_status = target;
  state.harness.known_issues = [...new Set([...state.harness.known_issues, ...knownIssues])];
  state.harness.follow_ups = [...new Set([...state.harness.follow_ups, ...followUps])];
  updateHarnessMetadata(state, {
    milestone: target === "implementing" ? "implementation_in_progress" : "implementation_blocked",
    nextAction: target === "implementing"
      ? `Implement the confirmed plan and then run \`node scripts/theme-harness.mjs verify --slug ${slug}\`.`
      : "Resolve the blocker and then return to `implementing` with `set-status` or rerun `verify`.",
    updatedBy,
  });
  pushRecentDecision(state, note || `Workflow status changed from \`${current}\` to \`${target}\`.`);
  saveStatusNote(state, readText(statusTemplatePath(repoRoot)));
  saveState(repoRoot, state);

  return actionPayload({
    status: target,
    message: "Workflow status updated.",
    details: {
      slug,
      workflow_status: target,
      status_path: state.harness.status_path,
    },
  });
}

export function verifyTheme({
  repoRoot = REPO_ROOT,
  slug,
  updatedBy = "system",
  commandRunner = runSavedCommand,
} = {}) {
  const state = loadState(repoRoot, slug);
  verifyWorkflowStatus(state, new Set(["implementing", "blocked"]), "verify");

  const requiredChecks = state.required_checks;
  if (!requiredChecks.length) {
    state.harness.workflow_status = "blocked";
    state.harness.known_issues = [...new Set([...state.harness.known_issues, "missing_required_checks"])];
    updateHarnessMetadata(state, {
      milestone: "verification_blocked",
      nextAction: "Record at least one required check with `node scripts/theme-ops.mjs start --check-cmd ...` before rerunning verify.",
      updatedBy,
    });
    pushRecentDecision(state, "Verification blocked because no saved checks were recorded.");
    saveStatusNote(state, readText(statusTemplatePath(repoRoot)));
    saveState(repoRoot, state);

    return actionPayload({
      status: "blocked",
      message: "Verification blocked because no required checks were recorded.",
      details: {
        slug,
        workflow_status: state.harness.workflow_status,
        reason: "missing_required_checks",
      },
    });
  }

  const validationRuns = [...state.harness.validation_runs];
  const runResults = requiredChecks.map((command) => commandRunner(command, state.worktree_path));
  validationRuns.push(...runResults);
  state.harness.validation_runs = validationRuns;

  const failedRuns = runResults.filter((row) => row.status !== "pass");
  if (failedRuns.length) {
    state.harness.workflow_status = "blocked";
    updateHarnessMetadata(state, {
      milestone: "verification_blocked",
      nextAction: "Fix the failing checks and rerun `node scripts/theme-harness.mjs verify --slug <slug>`.",
      updatedBy,
    });
    pushRecentDecision(state, `Verification failed for ${failedRuns.length} saved check(s).`);
  } else {
    state.harness.workflow_status = "verified";
    updateHarnessMetadata(state, {
      milestone: "verified",
      nextAction: `Run \`node scripts/theme-ops.mjs aftercare --slug ${slug} ...\`, \`node scripts/theme-ops.mjs explain --slug ${slug} ...\`, and then \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\` to auto-promote durable context before closeout.`,
      updatedBy,
    });
    pushRecentDecision(state, "All saved verification commands passed.");
  }

  saveStatusNote(state, readText(statusTemplatePath(repoRoot)));
  saveState(repoRoot, state);

  return actionPayload({
    status: state.harness.workflow_status,
    message: failedRuns.length ? "Verification completed with failures." : "Verification passed.",
    details: {
      slug,
      workflow_status: state.harness.workflow_status,
      validation_run_count: runResults.length,
      failed_commands: failedRuns.map((row) => row.command),
    },
  });
}

export function scaffoldCloseout({
  repoRoot = REPO_ROOT,
  slug,
  updatedBy = "system",
  promotionRunner = promoteDurableContext,
} = {}) {
  const state = loadState(repoRoot, slug);
  if (String(state.harness.workflow_status || "") !== "verified") {
    throw new HarnessError("`scaffold-closeout` requires workflow status `verified`.", {
      status: "action_required",
      details: {
        workflow_status: state.harness.workflow_status || "selected",
      },
    });
  }

  const missingGates = [];
  if (!state.aftercare.checked_at) {
    missingGates.push("aftercare_missing");
  }
  if (!state.plain_language_summary.recorded_at) {
    missingGates.push("plain_language_summary_missing");
  }

  if (missingGates.length) {
    throw new HarnessError("`scaffold-closeout` requires recorded aftercare and plain-language summary.", {
      status: "action_required",
      details: {
        missing_gates: missingGates,
        remediation: `Run \`node scripts/theme-ops.mjs aftercare --slug ${slug} ...\` and \`node scripts/theme-ops.mjs explain --slug ${slug} ...\` before scaffold-closeout auto-promotes durable context.`,
      },
    });
  }

  const promotion = promotionRunner({ repoRoot, slug });
  if (!["applied", "noop"].includes(String(promotion.status || ""))) {
    const refreshedState = loadState(repoRoot, slug);
    refreshedState.harness.workflow_status = "verified";
    updateHarnessMetadata(refreshedState, {
      milestone: "context_promotion_blocked",
      nextAction: refreshedState.context_promotion.next_action || `Rerun \`node scripts/theme-ops.mjs explain --slug ${slug} ...\` and then \`node scripts/theme-harness.mjs scaffold-closeout --slug ${slug}\`.`,
      updatedBy,
    });
    pushRecentDecision(refreshedState, `Durable-context auto-promotion blocked closeout: ${refreshedState.context_promotion.reason}.`);
    saveStatusNote(refreshedState, readText(statusTemplatePath(repoRoot)));
    saveState(repoRoot, refreshedState);

    return actionPayload({
      status: "blocked",
      message: "Closeout remains blocked until durable-context auto-promotion succeeds.",
      details: {
        slug,
        workflow_status: refreshedState.harness.workflow_status,
        closeout_path: refreshedState.harness.closeout_path,
        context_promotion_required: refreshedState.context_promotion.required,
        context_promotion_state: refreshedState.context_promotion.state,
        context_promotion_reason: refreshedState.context_promotion.reason,
        context_promotion_next_action: refreshedState.context_promotion.next_action,
        context_promotion_changed_artifacts: refreshedState.context_promotion.changed_artifacts,
      },
    });
  }

  const refreshedState = loadState(repoRoot, slug);
  const closeoutText = renderCloseoutDraft(refreshedState, readText(closeoutTemplatePath(repoRoot)));
  writeText(refreshedState.harness.closeout_path, closeoutText);
  refreshedState.harness.workflow_status = "closeout_ready";
  updateHarnessMetadata(refreshedState, {
    milestone: "closeout_ready",
    nextAction: `Run \`node scripts/theme-ops.mjs close --slug ${slug}\` from the repo root.`,
    updatedBy,
  });
  pushRecentDecision(refreshedState, `Closeout draft scaffolded after durable-context auto-promotion finished with \`${promotion.status}\`.`);
  saveStatusNote(refreshedState, readText(statusTemplatePath(repoRoot)));
  saveState(repoRoot, refreshedState);

  return actionPayload({
    status: "pass",
    message: "Closeout draft scaffolded.",
    details: {
      slug,
      closeout_path: refreshedState.harness.closeout_path,
      workflow_status: refreshedState.harness.workflow_status,
      promotion_result: String(promotion.status || "noop"),
      context_promotion_state: refreshedState.context_promotion.state,
      context_promotion_reason: refreshedState.context_promotion.reason,
      context_promotion_next_action: refreshedState.context_promotion.next_action,
      context_promotion_changed_artifacts: refreshedState.context_promotion.changed_artifacts,
    },
  });
}

export function benchmarkScaffold({
  repoRoot = REPO_ROOT,
  packId,
  outPath = "",
  force = false,
} = {}) {
  return scaffoldBenchmarkPack({
    repoRoot,
    packId,
    outPath,
    force,
  });
}

export function benchmarkValidate({
  packPath,
} = {}) {
  return validateBenchmarkPackCommand({ packPath });
}

export function benchmarkRun({
  packPath,
} = {}) {
  return benchmarkRunStub({ packPath });
}

function parseCommandLine() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "scaffold-plan": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "brief-path": { type: "string" },
          "updated-by": { type: "string" },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          briefPath: values["brief-path"] || "",
          updatedBy: values["updated-by"] || "system",
        },
      };
    }
    case "review-plan": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "updated-by": { type: "string" },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          updatedBy: values["updated-by"] || "system",
        },
      };
    }
    case "set-status": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          to: { type: "string" },
          note: { type: "string" },
          "known-issue": { type: "string", multiple: true },
          "follow-up": { type: "string", multiple: true },
          "updated-by": { type: "string" },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          target: values.to,
          note: values.note || "",
          knownIssues: values["known-issue"] || [],
          followUps: values["follow-up"] || [],
          updatedBy: values["updated-by"] || "system",
        },
      };
    }
    case "verify": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "updated-by": { type: "string" },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          updatedBy: values["updated-by"] || "system",
        },
      };
    }
    case "scaffold-closeout": {
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: "string" },
          "updated-by": { type: "string" },
        },
      });
      return {
        command,
        values: {
          slug: values.slug,
          updatedBy: values["updated-by"] || "system",
        },
      };
    }
    case "benchmark-scaffold": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "pack-id": { type: "string" },
          out: { type: "string" },
          force: { type: "boolean" },
        },
      });
      return {
        command,
        values: {
          packId: values["pack-id"],
          outPath: values.out || "",
          force: values.force || false,
        },
      };
    }
    case "benchmark-validate": {
      const { values } = parseArgs({
        args: rest,
        options: {
          pack: { type: "string" },
        },
      });
      return {
        command,
        values: {
          packPath: values.pack,
        },
      };
    }
    case "benchmark-run": {
      const { values } = parseArgs({
        args: rest,
        options: {
          pack: { type: "string" },
        },
      });
      return {
        command,
        values: {
          packPath: values.pack,
        },
      };
    }
    default:
      throw new HarnessError("Unknown theme-harness command.", {
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
    case "scaffold-plan":
      payload = scaffoldPlan(values);
      break;
    case "review-plan":
      payload = reviewPlan(values);
      break;
    case "set-status":
      payload = setStatus(values);
      break;
    case "verify":
      payload = verifyTheme(values);
      break;
    case "scaffold-closeout":
      payload = scaffoldCloseout(values);
      break;
    case "benchmark-scaffold":
      payload = benchmarkScaffold(values);
      break;
    case "benchmark-validate":
      payload = benchmarkValidate(values);
      break;
    case "benchmark-run":
      payload = benchmarkRun(values);
      break;
    default:
      throw new HarnessError("Unknown theme-harness command.", {
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
