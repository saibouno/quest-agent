import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeTheme, recordAftercare, recordExplain, setupTheme, startTheme, statusTheme } from "../scripts/theme-ops.mjs";
import { loadState } from "../scripts/theme-harness-lib.mjs";
import {
  PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE,
  PORTFOLIO_SHARED_CONTRACT_REF,
  PORTFOLIO_STATUS_REASON_PATH_OVERLAP_SAME_ARTIFACT_CLASS,
  buildPortfolioSummary,
  computePortfolioEnvelopeFingerprint,
  portfolioArtifactPath,
} from "../scripts/theme-portfolio-contract.mjs";

const CURRENT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staleSummaryScenario = JSON.parse(
  readFileSync(path.join(CURRENT_REPO_ROOT, "tests", "fixtures", "portfolio-orchestration-scenarios.json"), "utf8"),
).find((entry) => entry.scenario_id === "po_v1_stale_summary_override_001");

function fakeGitExecutor(repoRoot, args) {
  if (args[0] !== "worktree" || args[1] !== "add") {
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  }

  const worktreePath = args[2];
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(path.join(worktreePath, ".git"), `gitdir: ${path.join(repoRoot, ".git", "worktrees", path.basename(worktreePath))}\n`, "utf8");
}

function seedRunbookFiles(repoRoot) {
  const targets = [
    "docs/runbooks/theme-loop/PLAN_TEMPLATE.md",
    "docs/runbooks/theme-loop/STATUS_TEMPLATE.md",
    "docs/runbooks/theme-loop/CLOSEOUT_TEMPLATE.md",
    "docs/context/adapter.json",
    "docs/context/current-state.md",
    "docs/context/current-state.meta.json",
    "docs/context/open-questions.md",
    "docs/context/metrics-source.md",
    "docs/context/decisions/nested-worktree-root-and-tooling-resolution.md",
    "docs/context/decisions/windows-safe-noprofile-spellings.md",
  ];

  for (const relativePath of targets) {
    const source = path.join(CURRENT_REPO_ROOT, relativePath);
    const destination = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(source, "utf8"), "utf8");
  }
}

function createFixtureRepo(testContext, suffix) {
  const repoRoot = path.join(os.tmpdir(), `quest-agent-theme-ops-${suffix}-${Date.now()}`);
  mkdirSync(repoRoot, { recursive: true });
  testContext.after(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  seedRunbookFiles(repoRoot);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n", "utf8");

  return repoRoot;
}

function readyBrief(slug) {
  return [
    "# Theme Brief",
    "",
    "## Summary",
    "",
    `- Theme name: Ready ${slug}`,
    `- Goal: Validate ${slug}.`,
    "- Done condition: Saved checks are green and closeout is ready.",
    "- Expected end state: merge_and_delete",
    "",
    "## Portfolio Coordination Envelope",
    "",
    "```json",
    JSON.stringify({
      plan_ref: `output/theme_ops/${slug}-plan.md`,
      plan_id: `plan-${slug}`,
      plan_version: 1,
      affected_surfaces: [`path:src/${slug}/**`],
      surface_confidence: 0.8,
      expected_artifacts: ["code:runtime-change"],
      prerequisites: ["foundation:fixture-contract"],
    }, null, 2),
    "```",
    "",
  ].join("\n");
}

function readyPlan(slug, planId = `plan-${slug}`) {
  return [
    "# Theme Plan Template",
    "",
    "## Portfolio Coordination Envelope",
    "",
    "```json",
    JSON.stringify({
      plan_ref: `output/theme_ops/${slug}-plan.md`,
      plan_id: planId,
      plan_version: 1,
      affected_surfaces: [`path:src/${slug}/**`],
      surface_confidence: 0.8,
      expected_artifacts: ["code:runtime-change"],
      prerequisites: ["foundation:fixture-contract"],
    }, null, 2),
    "```",
    "",
  ].join("\n");
}

function minimalCloseoutDraft() {
  return [
    "# Theme Closeout Draft",
    "",
    "## Known Issues / Follow-ups",
    "",
    "- none",
    "",
  ].join("\n");
}

function rawStatePathFor(repoRoot, slug) {
  return path.join(repoRoot, "output", "theme_ops", `${slug}.json`);
}

function updateRawState(repoRoot, slug, updater) {
  const rawStatePath = rawStatePathFor(repoRoot, slug);
  const rawState = JSON.parse(readFileSync(rawStatePath, "utf8"));
  updater(rawState);
  writeFileSync(rawStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");
}

function writeBridgeArtifacts(state, { planId = `plan-${state.slug}`, includePlan = true, includeReview = false, includeCloseout = false } = {}) {
  if (includePlan) {
    writeFileSync(state.harness.plan_path, readyPlan(state.slug, planId), "utf8");
  }
  if (includeReview) {
    writeFileSync(state.harness.review_path, "# review\n", "utf8");
  }
  if (includeCloseout) {
    writeFileSync(state.harness.closeout_path, minimalCloseoutDraft(), "utf8");
  }
}

function writeValidPortfolioSummary(repoRoot, rawState, envelope, overrides = {}) {
  const artifactPath = portfolioArtifactPath(repoRoot);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, "{\n  \"status\": \"fixture\"\n}\n", "utf8");

  rawState.portfolio_coordination = {
    envelope,
    summary: buildPortfolioSummary({
      envelopeFingerprint: computePortfolioEnvelopeFingerprint(envelope),
      coordinationStatus: PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE,
      statusReason: PORTFOLIO_STATUS_REASON_PATH_OVERLAP_SAME_ARTIFACT_CLASS,
      primaryRelationKey: `merge_candidate:${envelope.plan_id}|plan-other:${envelope.affected_surfaces[0]}`,
      triggeringRelationKeys: [`merge_candidate:${envelope.plan_id}|plan-other:${envelope.affected_surfaces[0]}`],
      relatedPlanRefs: ["plans/other.md"],
      portfolioPlanId: "portfolio-coordination-2026-04-09",
      portfolioPlanVersion: 1,
      lastRefreshedAt: "2026-04-09T00:00:00.000Z",
      sharedContractRef: PORTFOLIO_SHARED_CONTRACT_REF,
      artifactPath,
      artifactPresent: true,
      eligible: true,
      ...overrides,
    }),
  };
}

function createFakeCloseGitExecutor(worktreePath) {
  const calls = [];
  let worktreeDirty = true;

  return {
    calls,
    execGit(repoRoot, args, { cwd = repoRoot } = {}) {
      calls.push({ cwd, args });

      if (args[0] === "status" && args[1] === "--porcelain") {
        return {
          status: 0,
          stdout: cwd === worktreePath && worktreeDirty ? " M docs/example.md\n" : "",
          stderr: "",
        };
      }

      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return {
          status: 0,
          stdout: "main\n",
          stderr: "",
        };
      }

      if (args[0] === "commit") {
        worktreeDirty = false;
      }

      if (args[0] === "worktree" && args[1] === "remove") {
        rmSync(args[2], { recursive: true, force: true, maxRetries: 3 });
      }

      return {
        status: 0,
        stdout: "",
        stderr: "",
      };
    },
  };
}

test("start creates canonical brief path and initial state", (t) => {
  const repoRoot = createFixtureRepo(t, "start");
  const slug = "start";
  const result = startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Start Theme",
    slug,
    requiredChecks: ["node -e \"process.exit(0)\""],
    execGit: fakeGitExecutor,
  });

  assert.equal(result.status, "pass");
  const state = loadState(repoRoot, slug);
  assert.equal(state.harness_policy, "default");
  assert.equal(state.merge_policy, "manual");
  assert.equal(state.rollback_class, "manual");
  assert.equal(state.brief_path, path.join(repoRoot, "output", "theme_ops", `${slug}-brief.md`));
  assert.ok(existsSync(state.brief_path));
  assert.ok(existsSync(state.worktree_path));
});

test("start rejects invalid auto merge combinations", (t) => {
  const repoRoot = createFixtureRepo(t, "invalid-auto");

  assert.throws(
    () => startTheme({
      repoRoot,
      cwd: repoRoot,
      themeName: "Invalid Auto Theme",
      slug: "invalid-auto-manual-rollback",
      mergePolicy: "auto_after_green",
      rollbackClass: "manual",
      execGit: fakeGitExecutor,
    }),
    /simple_revert/,
  );

  assert.throws(
    () => startTheme({
      repoRoot,
      cwd: repoRoot,
      themeName: "Invalid Auto End State",
      slug: "invalid-auto-end-state",
      mergePolicy: "auto_after_green",
      rollbackClass: "simple_revert",
      expectedEndState: "remote_only_reference",
      execGit: fakeGitExecutor,
    }),
    /merge_and_delete/,
  );
});

test("status distinguishes default, exempt, and legacy guidance", (t) => {
  const defaultRoot = createFixtureRepo(t, "default");
  startTheme({
    repoRoot: defaultRoot,
    cwd: defaultRoot,
    themeName: "Default Theme",
    slug: "default",
    execGit: fakeGitExecutor,
  });
  const defaultStatus = statusTheme({ repoRoot: defaultRoot, slug: "default" });
  assert.equal(defaultStatus.harness_guidance.policy, "default");
  assert.equal(defaultStatus.current_workflow_status, "not_started");
  assert.equal(defaultStatus.merge_policy, "manual");
  assert.equal(defaultStatus.merge_gate_required, false);
  assert.equal(defaultStatus.merge_gate_reason, "policy_manual");
  assert.equal(defaultStatus.portfolio_coordination_status, "not_evaluated");
  assert.equal(defaultStatus.portfolio_status_reason, "portfolio_refresh_required");
  assert.equal(defaultStatus.portfolio_summary_valid, false);
  assert.equal(defaultStatus.bridge_decision.enabled, false);
  assert.equal(defaultStatus.bridge_decision.disable_reason, "not_started");
  assert.equal(defaultStatus.bridge_decision.consumer_mode, "read_only");
  assert.equal(defaultStatus.bridge_decision.consumer_scope, "current_plan_only");

  const exemptRoot = createFixtureRepo(t, "exempt");
  startTheme({
    repoRoot: exemptRoot,
    cwd: exemptRoot,
    themeName: "Exempt Theme",
    slug: "exempt",
    harnessPolicy: "exempt",
    harnessReason: "Exempt for a docs-only test theme.",
    execGit: fakeGitExecutor,
  });
  const exemptStatus = statusTheme({ repoRoot: exemptRoot, slug: "exempt" });
  assert.equal(exemptStatus.harness_guidance.policy, "exempt");
  assert.equal(exemptStatus.current_workflow_status, "not_applicable");
  assert.equal(exemptStatus.merge_gate_reason, "policy_manual");
  assert.equal(exemptStatus.bridge_decision.enabled, false);
  assert.equal(exemptStatus.bridge_decision.disable_reason, "not_applicable");

  const legacyRoot = createFixtureRepo(t, "legacy");
  startTheme({
    repoRoot: legacyRoot,
    cwd: legacyRoot,
    themeName: "Legacy Theme",
    slug: "legacy",
    execGit: fakeGitExecutor,
  });
  const rawStatePath = path.join(legacyRoot, "output", "theme_ops", "legacy.json");
  const rawState = JSON.parse(readFileSync(rawStatePath, "utf8"));
  delete rawState.harness_policy;
  delete rawState.harness_policy_reason;
  writeFileSync(rawStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

  const legacyStatus = statusTheme({ repoRoot: legacyRoot, slug: "legacy" });
  assert.equal(legacyStatus.harness_guidance.policy, "legacy");
  assert.equal(legacyStatus.current_workflow_status, "legacy");
  assert.equal(legacyStatus.merge_gate_reason, "policy_manual");
  assert.equal(legacyStatus.bridge_decision.enabled, false);
  assert.equal(legacyStatus.bridge_decision.disable_reason, "not_applicable");
});

test("setup backfills legacy guidance metadata", (t) => {
  const repoRoot = createFixtureRepo(t, "setup");
  const slug = "setup";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Setup Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  const rawStatePath = path.join(repoRoot, "output", "theme_ops", `${slug}.json`);
  const rawState = JSON.parse(readFileSync(rawStatePath, "utf8"));
  delete rawState.harness_policy;
  delete rawState.harness_policy_reason;
  writeFileSync(rawStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

  const result = setupTheme({ repoRoot, cwd: repoRoot, slug });
  assert.equal(result.status, "pass");
  const state = loadState(repoRoot, slug);
  assert.equal(state.harness_policy, "legacy");
});

test("status bridge_decision maps workflow states and selected work refs", (t) => {
  const cases = [
    {
      name: "plan_drafted continues current plan before review",
      suffix: "bridge-plan-drafted",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true });
        rawState.harness.workflow_status = "plan_drafted";
        rawState.harness.review_results = {};
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "continue_current_plan");
        assert.equal(status.bridge_decision.decision_reason, "review_or_revision_completion_required");
        assert.equal(status.bridge_decision.selected_work_kind, "current_plan");
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-plan-drafted");
      },
    },
    {
      name: "plan_drafted failed review requests replan",
      suffix: "bridge-replan",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true, includeReview: true });
        rawState.harness.workflow_status = "plan_drafted";
        rawState.harness.review_results = { result: "revise_required" };
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "replan_current_plan");
        assert.equal(status.bridge_decision.decision_reason, "plan_review_failed");
        assert.equal(status.bridge_decision.selected_work_kind, "current_plan");
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-replan");
      },
    },
    {
      name: "plan_reviewed continues into implementing",
      suffix: "bridge-plan-reviewed",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true, includeReview: true });
        rawState.harness.workflow_status = "plan_reviewed";
        rawState.harness.review_results = { result: "pass" };
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "continue_current_plan");
        assert.equal(status.bridge_decision.decision_reason, "implementation_start_required");
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-plan-reviewed");
      },
    },
    {
      name: "implementing continues current plan",
      suffix: "bridge-implementing",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true, includeReview: true });
        rawState.harness.workflow_status = "implementing";
        rawState.harness.review_results = { result: "pass" };
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "continue_current_plan");
        assert.equal(status.bridge_decision.decision_reason, "implementation_in_progress");
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-implementing");
      },
    },
    {
      name: "verified continues into aftercare and closeout scaffolding",
      suffix: "bridge-verified",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true, includeReview: true });
        rawState.harness.workflow_status = "verified";
        rawState.harness.review_results = { result: "pass" };
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "continue_current_plan");
        assert.equal(status.bridge_decision.decision_reason, "aftercare_explain_scaffold_closeout_required");
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-verified");
      },
    },
    {
      name: "blocked pauses for human",
      suffix: "bridge-blocked",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true });
        rawState.harness.workflow_status = "blocked";
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "pause_for_human");
        assert.equal(status.bridge_decision.decision_reason, "workflow_blocked");
        assert.equal(status.bridge_decision.requires_human, true);
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-blocked");
      },
    },
    {
      name: "approved pauses for human",
      suffix: "bridge-approved",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true });
        rawState.harness.workflow_status = "approved";
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "pause_for_human");
        assert.equal(status.bridge_decision.decision_reason, "workflow_approved");
        assert.equal(status.bridge_decision.requires_human, true);
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-approved");
      },
    },
    {
      name: "rejected pauses for human",
      suffix: "bridge-rejected",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true });
        rawState.harness.workflow_status = "rejected";
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "pause_for_human");
        assert.equal(status.bridge_decision.decision_reason, "workflow_rejected");
        assert.equal(status.bridge_decision.requires_human, true);
        assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-rejected");
      },
    },
    {
      name: "closeout_ready and helper satisfied completes",
      suffix: "bridge-complete",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true, includeReview: true, includeCloseout: true });
        rawState.harness.workflow_status = "closeout_ready";
        rawState.harness.review_results = { result: "pass" };
        rawState.context_promotion.state = "noop";
        rawState.context_promotion.reason = "no_durable_delta";
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "complete");
        assert.equal(status.bridge_decision.decision_reason, "closeout_ready");
        assert.equal(status.bridge_decision.selected_work_kind, "none");
        assert.equal(status.bridge_decision.selected_work_ref, "none");
      },
    },
    {
      name: "closeout_ready without helper satisfaction pauses for human",
      suffix: "bridge-closeout-mismatch",
      mutate(rawState, state) {
        writeBridgeArtifacts(state, { includePlan: true, includeReview: true, includeCloseout: true });
        rawState.harness.workflow_status = "closeout_ready";
        rawState.harness.review_results = { result: "pass" };
        rawState.context_promotion.state = "pending";
        rawState.context_promotion.reason = "recorded_structured_delta";
      },
      assertStatus(status) {
        assert.equal(status.bridge_decision.decision, "pause_for_human");
        assert.equal(status.bridge_decision.decision_reason, "closeout_readiness_unsatisfied");
        assert.equal(status.bridge_decision.selected_work_kind, "current_plan");
        assert.equal(status.bridge_decision.requires_human, true);
      },
    },
  ];

  for (const scenario of cases) {
    const repoRoot = createFixtureRepo(t, scenario.suffix);
    const slug = scenario.suffix;
    startTheme({
      repoRoot,
      cwd: repoRoot,
      themeName: scenario.name,
      slug,
      execGit: fakeGitExecutor,
    });

    const state = loadState(repoRoot, slug);
    updateRawState(repoRoot, slug, (rawState) => {
      scenario.mutate(rawState, state);
    });

    const status = statusTheme({ repoRoot, slug });
    assert.equal(status.bridge_decision.enabled, true, scenario.name);
    scenario.assertStatus(status);
  }
});

test("status bridge_decision pauses when saved workflow artifacts are inconsistent", (t) => {
  const repoRoot = createFixtureRepo(t, "bridge-inconsistent");
  const slug = "bridge-inconsistent";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Bridge Inconsistent Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, slug);
  writeBridgeArtifacts(state, { includePlan: true, includeReview: false });
  updateRawState(repoRoot, slug, (rawState) => {
    rawState.harness.workflow_status = "plan_reviewed";
    rawState.harness.review_results = { result: "pass" };
  });

  const status = statusTheme({ repoRoot, slug });
  assert.equal(status.bridge_decision.decision, "pause_for_human");
  assert.equal(status.bridge_decision.decision_reason, "missing_review_artifact");
  assert.equal(status.bridge_decision.selected_work_kind, "current_plan");
  assert.equal(status.bridge_decision.selected_work_ref, "plan-bridge-inconsistent");
});

test("status bridge_decision prefers state plan_id and keeps portfolio summary advisory-only", (t) => {
  const repoRoot = createFixtureRepo(t, "bridge-advisory");
  const slug = "bridge-advisory";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Bridge Advisory Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, slug);
  writeBridgeArtifacts(state, { planId: "plan-from-artifact", includePlan: true, includeReview: true });
  updateRawState(repoRoot, slug, (rawState) => {
    rawState.harness.workflow_status = "implementing";
    rawState.harness.review_results = { result: "pass" };

    const envelope = {
      plan_ref: `output/theme_ops/${slug}-plan.md`,
      plan_id: "plan-from-state",
      plan_version: 1,
      affected_surfaces: [`path:src/${slug}/**`],
      surface_confidence: 0.8,
      expected_artifacts: ["code:runtime-change"],
      prerequisites: ["foundation:fixture-contract"],
      required_resources: [],
    };
    writeValidPortfolioSummary(repoRoot, rawState, envelope);
  });

  const status = statusTheme({ repoRoot, slug });
  assert.equal(status.bridge_decision.decision, "continue_current_plan");
  assert.equal(status.bridge_decision.decision_reason, "implementation_in_progress");
  assert.equal(status.bridge_decision.selected_work_kind, "current_plan");
  assert.equal(status.bridge_decision.selected_work_ref, "plan-from-state");
  assert.deepEqual(status.bridge_decision.advisory_inputs_used, ["portfolio_coordination.summary"]);
  assert.ok(status.bridge_decision.decision_source_refs.includes("state:portfolio_coordination.summary"));
  assert.ok(!status.bridge_decision.blocking_refs.some((entry) => entry.includes("portfolio_coordination.summary")));
  assert.equal(status.portfolio_coordination_status, "merge_candidate");
  assert.equal(status.portfolio_status_reason, PORTFOLIO_STATUS_REASON_PATH_OVERLAP_SAME_ARTIFACT_CLASS);
});

test("status bridge_decision falls back to slug when no plan_id is available", (t) => {
  const repoRoot = createFixtureRepo(t, "bridge-slug-fallback");
  const slug = "bridge-slug-fallback";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Bridge Slug Fallback Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, slug);
  writeFileSync(state.harness.plan_path, "# Theme Plan Template\n\n## Portfolio Coordination Envelope\n\n```json\n{}\n```\n", "utf8");
  updateRawState(repoRoot, slug, (rawState) => {
    rawState.harness.workflow_status = "plan_drafted";
    rawState.harness.review_results = {};
    rawState.portfolio_coordination = {
      envelope: null,
      summary: rawState.portfolio_coordination.summary,
    };
  });

  const status = statusTheme({ repoRoot, slug });
  assert.equal(status.bridge_decision.decision, "continue_current_plan");
  assert.equal(status.bridge_decision.selected_work_kind, "current_plan");
  assert.equal(status.bridge_decision.selected_work_ref, slug);
});

test("aftercare, explain, and close return remediation from the wrong cwd", (t) => {
  const repoRoot = createFixtureRepo(t, "cwd");
  const slug = "cwd";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Cwd Theme",
    slug,
    execGit: fakeGitExecutor,
  });
  const state = loadState(repoRoot, slug);
  const wrongCwd = state.worktree_path;

  assert.throws(
    () => recordAftercare({
      repoRoot,
      cwd: wrongCwd,
      slug,
      stuckPoints: ["A stuck point."],
      preventionChanges: ["A prevention change."],
    }),
    /canonical repo root/,
  );

  assert.throws(
    () => recordExplain({
      repoRoot,
      cwd: wrongCwd,
      slug,
      oneLine: "Summary",
    }),
    /canonical repo root/,
  );

  assert.throws(
    () => closeTheme({
      repoRoot,
      cwd: wrongCwd,
      slug,
    }),
    /canonical repo root/,
  );
});

test("explain stores normalized durable delta and context promotion baseline", (t) => {
  const repoRoot = createFixtureRepo(t, "explain-durable");
  const slug = "explain-durable";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Explain Durable Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  const result = recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Durable context changed.",
    currentFocus: ["Auto-promote closeout context.", "Auto-promote closeout context."],
    nextSafeThemes: ["docs-followup"],
    decisionJson: [JSON.stringify({
      slug: "auto-context-closeout",
      title: "Auto Context Closeout",
      decision: "Scaffold closeout auto-promotes durable context before becoming ready.",
      why_it_stands: "It keeps closeout readiness aligned with canonical docs/context state.",
      operational_consequence: "Explain must record durable input before scaffold-closeout can finish.",
      source_refs: [{
        kind: "json",
        path_or_uri: "output/theme_ops/explain-durable.json",
        locator: "durable_delta",
        captured_at: "2026-04-04T00:00:00+09:00",
      }],
    })],
    openQuestionJson: [JSON.stringify({
      id: "closeout-auto-promotion-followup",
      summary: "Confirm whether Product Shape should stay manual-only.",
      impact: "Future automation scope depends on this boundary.",
      next_unlock: "Review the durable-context promotion contract after v1 lands.",
      status: "open",
    })],
    blockerJson: [JSON.stringify({
      id: "closeout-promotion-blocker",
      summary: "Promotion must run before closeout_ready is recorded.",
      impact: "Closeout cannot finish until promotion state is applied or noop.",
      next_unlock: "Run scaffold-closeout after explain records the durable delta.",
      status: "open",
      observed_at: "2026-04-04T00:00:00+09:00",
      evidence_ref: "output/theme_ops/explain-durable.json#durable_delta",
    })],
    metricWatch: ["Watch the durable-context freshness window."],
    activePlanJson: JSON.stringify({
      kind: "theme_state",
      slug: "explain-durable",
      path: "output/theme_ops/explain-durable.json",
    }),
    planStatus: "blocked",
    resumeCondition: "Rerun scaffold-closeout after promotion finishes.",
    fallbackFocusValues: ["docs/context hygiene"],
    sourceRefJson: [JSON.stringify({
      kind: "markdown",
      path_or_uri: "output/theme_ops/explain-durable-closeout.md",
      locator: "Summary",
      captured_at: "2026-04-04T00:00:00+09:00",
    })],
  });

  assert.equal(result.status, "pass");
  assert.equal(result.durable_delta_recorded, true);
  assert.ok(result.durable_delta_artifacts.includes("docs/context/current-state.md"));
  assert.ok(result.durable_delta_artifacts.includes("docs/context/current-state.meta.json"));
  assert.equal(result.context_promotion_state, "pending");

  const state = loadState(repoRoot, slug);
  assert.deepEqual(state.durable_delta.current_focus, ["Auto-promote closeout context."]);
  assert.deepEqual(state.durable_delta.next_safe_themes, ["docs-followup"]);
  assert.equal(state.durable_delta.fallback_focus, "docs/context hygiene");
  assert.equal(state.durable_delta.decision_entries.length, 1);
  assert.equal(state.durable_delta.open_question_entries.length, 1);
  assert.equal(state.durable_delta.blocker_entries.length, 1);
  assert.equal(state.durable_delta.metric_watch.length, 1);
  assert.equal(state.context_promotion.state, "pending");
  assert.ok(Object.keys(state.durable_delta.baseline_context_hashes).includes("docs/context/current-state.md"));
});

test("explain rejects malformed structured durable input", (t) => {
  const repoRoot = createFixtureRepo(t, "explain-malformed");
  const slug = "explain-malformed";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Explain Malformed Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  assert.throws(
    () => recordExplain({
      repoRoot,
      cwd: repoRoot,
      slug,
      oneLine: "Malformed durable input.",
      decisionJson: ["{"],
    }),
    /Malformed --decision-json/,
  );
});

test("explain keeps fallback focus single-value", (t) => {
  const repoRoot = createFixtureRepo(t, "explain-fallback");
  const slug = "explain-fallback";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Explain Fallback Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  assert.throws(
    () => recordExplain({
      repoRoot,
      cwd: repoRoot,
      slug,
      oneLine: "Too many fallback focus values.",
      fallbackFocusValues: ["one", "two"],
    }),
    /--fallback-focus/,
  );
});

test("close reports action_required while context promotion is pending", (t) => {
  const repoRoot = createFixtureRepo(t, "close-pending");
  const slug = "close-pending";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Close Pending Theme",
    slug,
    execGit: fakeGitExecutor,
  });

  const rawStatePath = path.join(repoRoot, "output", "theme_ops", `${slug}.json`);
  const rawState = JSON.parse(readFileSync(rawStatePath, "utf8"));
  rawState.harness.workflow_status = "closeout_ready";
  rawState.context_promotion.state = "pending";
  rawState.context_promotion.reason = "recorded_structured_delta";
  rawState.context_promotion.next_action = "Run scaffold-closeout again.";
  writeFileSync(rawStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

  const result = closeTheme({
    repoRoot,
    cwd: repoRoot,
    slug,
  });

  assert.equal(result.status, "action_required");
  assert.equal(result.context_promotion_state, "pending");
  assert.equal(result.ready, false);
});

test("status and close match canonical scenario po_v1_stale_summary_override_001 without blocking readiness", (t) => {
  const repoRoot = createFixtureRepo(t, "portfolio-summary");
  const slug = "portfolio-summary";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Portfolio Summary Theme",
    slug,
    requiredChecks: ["node -e \"process.exit(0)\""],
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, slug);
  writeFileSync(state.brief_path, readyBrief(slug), "utf8");
  writeFileSync(state.harness.review_path, "# review\n", "utf8");
  writeFileSync(
    state.harness.closeout_path,
    [
      "# Theme Closeout Draft",
      "",
      "## Known Issues / Follow-ups",
      "",
      "- none",
      "",
    ].join("\n"),
    "utf8",
  );

  const rawStatePath = path.join(repoRoot, "output", "theme_ops", `${slug}.json`);
  const rawState = JSON.parse(readFileSync(rawStatePath, "utf8"));
  rawState.harness.workflow_status = "closeout_ready";
  rawState.harness.review_results = { result: "pass" };
  rawState.context_promotion.state = "noop";
  rawState.context_promotion.reason = "no_durable_delta";
  rawState.context_promotion.next_action = "Ready to close.";
  rawState.harness.validation_runs = [
    {
      command: "node -e \"process.exit(0)\"",
      status: "pass",
      exit_code: 0,
      ran_at: new Date().toISOString(),
      stdout: "",
      stderr: "",
    },
  ];
  rawState.portfolio_coordination = {
    envelope: {
      plan_ref: `output/theme_ops/${slug}-plan.md`,
      plan_id: `plan-${slug}`,
      plan_version: 1,
      affected_surfaces: ["path:src/portfolio-summary/**"],
      surface_confidence: 0.8,
      expected_artifacts: ["code:runtime-change"],
      prerequisites: ["foundation:fixture-contract"],
      required_resources: [],
    },
    summary: {
      coordination_status: staleSummaryScenario.saved_summary.coordination_status,
      status_reason: staleSummaryScenario.saved_summary.status_reason,
      primary_relation_key: staleSummaryScenario.saved_summary.primary_relation_key,
      triggering_relation_keys: staleSummaryScenario.saved_summary.triggering_relation_keys,
      related_plan_refs: staleSummaryScenario.saved_summary.related_plan_refs,
      portfolio_plan_id: "portfolio-coordination-2026-04-08",
      portfolio_plan_version: 1,
      last_refreshed_at: "2026-04-08T00:00:00.000Z",
      summary_valid: staleSummaryScenario.saved_summary.summary_valid,
      envelope_fingerprint: "abc123",
      summary_basis_fingerprint: "def456",
      shared_contract_ref: PORTFOLIO_SHARED_CONTRACT_REF,
      advisory_notes: ["stale advisory"],
    },
  };
  writeFileSync(rawStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

  const status = statusTheme({ repoRoot, slug });
  assert.equal(status.portfolio_coordination_status, staleSummaryScenario.expected_display.coordination_status);
  assert.equal(status.portfolio_status_reason, staleSummaryScenario.expected_display.status_reason);
  assert.deepEqual(status.portfolio_related_plan_refs, staleSummaryScenario.expected_display.related_plan_refs);
  assert.equal(status.portfolio_summary_valid, false);
  assert.equal(status.portfolio_primary_relation_key, staleSummaryScenario.expected_display.primary_relation_key);

  const close = closeTheme({
    repoRoot,
    cwd: repoRoot,
    slug,
  });
  assert.equal(close.status, "pass");
  assert.equal(close.ready, true);
  assert.equal(close.portfolio_coordination_status, staleSummaryScenario.expected_display.coordination_status);
  assert.equal(close.portfolio_status_reason, staleSummaryScenario.expected_display.status_reason);
  assert.deepEqual(close.portfolio_related_plan_refs, staleSummaryScenario.expected_display.related_plan_refs);
  assert.equal(close.portfolio_primary_relation_key, staleSummaryScenario.expected_display.primary_relation_key);
});

test("close --wait-for-merge merges and cleans up an eligible routine theme locally", (t) => {
  const repoRoot = createFixtureRepo(t, "auto-close");
  const slug = "auto-close";
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: "Auto Close Theme",
    slug,
    requiredChecks: ["node -e \"process.exit(0)\""],
    mergePolicy: "auto_after_green",
    rollbackClass: "simple_revert",
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, slug);
  writeFileSync(state.brief_path, readyBrief(slug), "utf8");
  writeFileSync(state.harness.review_path, "# review\n", "utf8");
  writeFileSync(
    state.harness.closeout_path,
    [
      "# Theme Closeout Draft",
      "",
      "## Known Issues / Follow-ups",
      "",
      "- none",
      "",
    ].join("\n"),
    "utf8",
  );

  const rawStatePath = path.join(repoRoot, "output", "theme_ops", `${slug}.json`);
  const rawState = JSON.parse(readFileSync(rawStatePath, "utf8"));
  rawState.harness.workflow_status = "closeout_ready";
  rawState.harness.review_results = { result: "pass" };
  rawState.context_promotion.state = "noop";
  rawState.context_promotion.reason = "no_durable_delta";
  rawState.context_promotion.next_action = "Ready to close.";
  rawState.harness.validation_runs = [
    {
      command: "node -e \"process.exit(0)\"",
      status: "pass",
      exit_code: 0,
      ran_at: new Date().toISOString(),
      stdout: "",
      stderr: "",
    },
  ];
  writeFileSync(rawStatePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

  const git = createFakeCloseGitExecutor(state.worktree_path);
  const result = closeTheme({
    repoRoot,
    cwd: repoRoot,
    slug,
    waitForMerge: true,
    execGit: git.execGit,
  });

  assert.equal(result.status, "pass");
  assert.equal(result.merge_gate_reason, "eligible_ready");
  assert.equal(result.merged, true);
  assert.equal(result.committed_worktree_changes, true);
  assert.ok(!existsSync(state.worktree_path));
  assert.ok(git.calls.some((call) => call.args.join(" ") === "merge --no-ff --no-edit codex/auto-close"));
  assert.ok(git.calls.some((call) => call.args.join(" ") === "branch -d codex/auto-close"));
});
