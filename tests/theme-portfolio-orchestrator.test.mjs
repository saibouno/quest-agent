import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startTheme } from "../scripts/theme-ops.mjs";
import { loadState, saveState } from "../scripts/theme-harness-lib.mjs";
import { refreshPortfolio, statusPortfolio } from "../scripts/theme-portfolio-orchestrator.mjs";
import {
  PORTFOLIO_SHARED_CONTRACT_REF,
  buildPairwisePortfolioRelations,
} from "../scripts/theme-portfolio-contract.mjs";

const CURRENT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalScenarios = JSON.parse(
  readFileSync(path.join(CURRENT_REPO_ROOT, "tests", "fixtures", "portfolio-orchestration-scenarios.json"), "utf8"),
);

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
  const repoRoot = path.join(os.tmpdir(), `quest-agent-theme-portfolio-${suffix}-${Date.now()}`);
  mkdirSync(repoRoot, { recursive: true });
  testContext.after(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  seedRunbookFiles(repoRoot);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n", "utf8");

  return repoRoot;
}

function startPortfolioTheme(repoRoot, envelope, workflowStatus = "implementing") {
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: `Theme ${envelope.plan_id}`,
    slug: envelope.plan_id,
    requiredChecks: ["node -e \"process.exit(0)\""],
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, envelope.plan_id);
  state.harness.workflow_status = workflowStatus;
  state.portfolio_coordination.envelope = envelope;
  state.portfolio_coordination.summary.summary_valid = false;
  saveState(repoRoot, state);
}

function readArtifact(repoRoot) {
  const result = statusPortfolio({ repoRoot });
  assert.equal(result.artifact_exists, true);
  return JSON.parse(readFileSync(result.artifact_path, "utf8"));
}

function lanePlanIds(artifact, lane) {
  const planIdByRef = new Map(artifact.registered_plans.map((entry) => [entry.plan_ref, entry.plan_id]));
  return lane.plan_refs.map((planRef) => planIdByRef.get(planRef));
}

for (const scenario of canonicalScenarios.filter((entry) => Array.isArray(entry.envelopes))) {
  test(`refresh matches canonical scenario ${scenario.scenario_id}`, (t) => {
    const repoRoot = createFixtureRepo(t, scenario.scenario_id);
    for (const envelope of scenario.envelopes) {
      startPortfolioTheme(repoRoot, envelope);
    }

    const result = refreshPortfolio({ repoRoot, cwd: repoRoot });
    assert.equal(result.status, "pass");

    const artifact = readArtifact(repoRoot);
    assert.equal(typeof artifact.portfolio_plan_id, "string");
    assert.equal(artifact.portfolio_plan_version, 1);
    assert.equal(typeof artifact.generated_at, "string");
    assert.ok(!Object.hasOwn(artifact, "artifact_type"));
    assert.ok(!Object.hasOwn(artifact, "portfolio_id"));
    assert.ok(!Object.hasOwn(artifact, "portfolio_version"));

    const registeredPlanIds = artifact.registered_plans.map((entry) => entry.plan_id);
    assert.deepEqual(registeredPlanIds, [...registeredPlanIds].sort());

    const relationKeys = artifact.relations.map((entry) => entry.relation_key);
    assert.deepEqual(relationKeys, [...relationKeys].sort());
    assert.ok(!artifact.relations.some((entry) => entry.primary_relation_type === "parallel_safe"));

    const laneTypes = artifact.global_execution_lanes.map((entry) => entry.lane_type);
    assert.deepEqual(
      laneTypes,
      scenario.expected_global_execution_lanes.map((entry) => entry.lane_type),
    );

    for (const lane of artifact.global_execution_lanes) {
      const memberPlanIds = lanePlanIds(artifact, lane);
      assert.deepEqual(memberPlanIds, [...memberPlanIds].sort());
      if (lane.lane_type === "execution") {
        assert.equal(lane.plan_refs.length, 1);
        assert.deepEqual(lane.derived_from_relation_keys, []);
      }
    }

    assert.deepEqual(
      artifact.relations.map((entry) => entry.primary_relation_type),
      scenario.expected_relations.map((entry) => entry.primary_relation_type),
    );
    assert.deepEqual(
      artifact.registered_plans.map((entry) => ({
        plan_id: entry.plan_id,
        coordination_status: entry.coordination_status,
      })),
      scenario.expected_registered_plans,
    );
    assert.deepEqual(
      artifact.global_execution_lanes.map((entry) => ({
        lane_type: entry.lane_type,
        plan_ids: lanePlanIds(artifact, entry),
      })),
      scenario.expected_global_execution_lanes,
    );

    for (const envelope of scenario.envelopes) {
      const state = loadState(repoRoot, envelope.plan_id);
      assert.equal(state.portfolio_coordination.summary.summary_valid, true);
      assert.equal(state.portfolio_coordination.summary.shared_contract_ref, PORTFOLIO_SHARED_CONTRACT_REF);
    }
  });
}

test("refresh keeps merge relation keys stable across plan_ref changes and envelope ordering", () => {
  const first = buildPairwisePortfolioRelations(
    {
      envelope: {
        plan_ref: "plans/auth-docs-a.md",
        plan_id: "auth-docs-b",
        plan_version: 1,
        surface_confidence: 0.91,
        affected_surfaces: ["path:docs/runbooks/auth/session/**", "path:docs/runbooks/auth/**"],
        expected_artifacts: ["doc:runbook"],
        prerequisites: [],
        required_resources: [],
      },
    },
    {
      envelope: {
        plan_ref: "plans/auth-docs-b.md",
        plan_id: "auth-docs-a",
        plan_version: 2,
        surface_confidence: 0.88,
        affected_surfaces: ["path:docs/runbooks/auth/**"],
        expected_artifacts: ["doc:runbook"],
        prerequisites: [],
        required_resources: [],
      },
    },
  );

  const second = buildPairwisePortfolioRelations(
    {
      envelope: {
        plan_ref: "plans/renamed-auth-docs-a.md",
        plan_id: "auth-docs-a",
        plan_version: 2,
        surface_confidence: 0.88,
        affected_surfaces: ["path:docs/runbooks/auth/**"],
        expected_artifacts: ["doc:runbook"],
        prerequisites: [],
        required_resources: [],
      },
    },
    {
      envelope: {
        plan_ref: "plans/renamed-auth-docs-b.md",
        plan_id: "auth-docs-b",
        plan_version: 1,
        surface_confidence: 0.91,
        affected_surfaces: ["path:docs/runbooks/auth/**", "path:docs/runbooks/auth/session/**"],
        expected_artifacts: ["doc:runbook"],
        prerequisites: [],
        required_resources: [],
      },
    },
  );

  assert.deepEqual(
    first.map((entry) => entry.relation_key),
    ["merge_candidate:auth-docs-a|auth-docs-b:path:docs/runbooks/auth/**"],
  );
  assert.deepEqual(
    second.map((entry) => entry.relation_key),
    ["merge_candidate:auth-docs-a|auth-docs-b:path:docs/runbooks/auth/**"],
  );
});
