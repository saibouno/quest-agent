import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startTheme } from "../scripts/theme-ops.mjs";
import { loadState, saveState } from "../scripts/theme-harness-lib.mjs";
import { refreshPortfolio, statusPortfolio } from "../scripts/theme-portfolio-orchestrator.mjs";
import { buildPairwisePortfolioRelations } from "../scripts/theme-portfolio-contract.mjs";

const CURRENT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function envelope({
  slug,
  planId = `plan-${slug}`,
  planRef = `theme:${slug}`,
  affectedSurfaces = [`path:src/${slug}/**`],
  expectedArtifacts = ["artifact:code-module"],
  prerequisites = ["foundation:fixture-contract"],
  requiredResources = [],
} = {}) {
  const result = {
    plan_ref: planRef,
    plan_id: planId,
    plan_version: "1",
    parent_goal: `goal:${slug}`,
    affected_surfaces: affectedSurfaces,
    surface_confidence: "confidence:medium",
    expected_artifacts: expectedArtifacts,
    prerequisites,
  };
  if (requiredResources.length) {
    result.required_resources = requiredResources;
  }
  return result;
}

function startPortfolioTheme(repoRoot, slug, portfolioEnvelope, workflowStatus = "implementing") {
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: `Theme ${slug}`,
    slug,
    requiredChecks: ["node -e \"process.exit(0)\""],
    execGit: fakeGitExecutor,
  });

  const state = loadState(repoRoot, slug);
  state.harness.workflow_status = workflowStatus;
  state.portfolio_coordination.envelope = portfolioEnvelope;
  state.portfolio_coordination.summary.summary_valid = false;
  saveState(repoRoot, state);
}

function readArtifact(repoRoot) {
  const result = statusPortfolio({ repoRoot });
  assert.equal(result.artifact_exists, true);
  return JSON.parse(readFileSync(result.artifact_path, "utf8"));
}

test("refresh classifies disjoint surfaces as parallel_safe and execution lane", (t) => {
  const repoRoot = createFixtureRepo(t, "parallel-safe");
  startPortfolioTheme(repoRoot, "alpha", envelope({
    slug: "alpha",
    affectedSurfaces: ["path:src/alpha/**"],
    prerequisites: ["foundation:alpha-base"],
  }));
  startPortfolioTheme(repoRoot, "beta", envelope({
    slug: "beta",
    affectedSurfaces: ["path:src/beta/**"],
    prerequisites: ["foundation:beta-base"],
  }));

  const result = refreshPortfolio({ repoRoot, cwd: repoRoot });
  assert.equal(result.status, "pass");

  const artifact = readArtifact(repoRoot);
  assert.equal(artifact.relations[0].relation_type, "parallel_safe");
  assert.deepEqual(
    artifact.global_execution_lanes.find((lane) => lane.lane === "execution")?.plan_ids,
    ["plan-alpha", "plan-beta"],
  );

  const alpha = loadState(repoRoot, "alpha");
  const beta = loadState(repoRoot, "beta");
  assert.equal(alpha.portfolio_coordination.summary.coordination_status, "parallel_safe");
  assert.equal(beta.portfolio_coordination.summary.coordination_status, "parallel_safe");

  const seenPlanIds = artifact.global_execution_lanes.flatMap((lane) => lane.plan_ids);
  assert.deepEqual(seenPlanIds.sort(), ["plan-alpha", "plan-beta"]);
});

test("refresh classifies overlapping paths with the same artifact class as merge_candidate", (t) => {
  const repoRoot = createFixtureRepo(t, "merge-candidate");
  startPortfolioTheme(repoRoot, "auth", envelope({
    slug: "auth",
    affectedSurfaces: ["path:src/auth/**"],
    expectedArtifacts: ["artifact:code-module"],
  }));
  startPortfolioTheme(repoRoot, "session", envelope({
    slug: "session",
    affectedSurfaces: ["path:src/auth/session/**"],
    expectedArtifacts: ["artifact:code-module"],
  }));

  refreshPortfolio({ repoRoot, cwd: repoRoot });
  const artifact = readArtifact(repoRoot);
  assert.equal(artifact.relations[0].relation_type, "merge_candidate");
  assert.deepEqual(
    artifact.global_execution_lanes.find((lane) => lane.lane === "merge_review")?.plan_ids,
    ["plan-auth", "plan-session"],
  );
});

test("refresh classifies overlapping paths with different artifact classes as conflict_review", (t) => {
  const repoRoot = createFixtureRepo(t, "conflict-review");
  startPortfolioTheme(repoRoot, "auth", envelope({
    slug: "auth",
    affectedSurfaces: ["path:src/auth/**"],
    expectedArtifacts: ["artifact:code-module"],
  }));
  startPortfolioTheme(repoRoot, "docs", envelope({
    slug: "docs",
    affectedSurfaces: ["path:src/auth/session/**"],
    expectedArtifacts: ["artifact:docs-page"],
  }));

  refreshPortfolio({ repoRoot, cwd: repoRoot });
  const artifact = readArtifact(repoRoot);
  assert.equal(artifact.relations[0].relation_type, "conflict_review");
  assert.deepEqual(
    artifact.global_execution_lanes.find((lane) => lane.lane === "review_hold")?.plan_ids,
    ["plan-auth", "plan-docs"],
  );
});

test("refresh classifies shared foundation prerequisites as shared_foundation_candidate", (t) => {
  const repoRoot = createFixtureRepo(t, "shared-foundation");
  startPortfolioTheme(repoRoot, "alpha", envelope({
    slug: "alpha",
    affectedSurfaces: ["path:src/alpha/**"],
    prerequisites: ["foundation:shared-auth"],
  }));
  startPortfolioTheme(repoRoot, "beta", envelope({
    slug: "beta",
    affectedSurfaces: ["path:src/beta/**"],
    prerequisites: ["foundation:shared-auth"],
  }));

  refreshPortfolio({ repoRoot, cwd: repoRoot });
  const artifact = readArtifact(repoRoot);
  assert.equal(artifact.relations[0].relation_type, "shared_foundation_candidate");
  assert.deepEqual(
    artifact.global_execution_lanes.find((lane) => lane.lane === "foundation_first")?.plan_ids,
    ["plan-alpha", "plan-beta"],
  );
});

test("refresh keeps raw prerequisite correlation advisory-only", (t) => {
  const repoRoot = createFixtureRepo(t, "raw-prerequisite");
  startPortfolioTheme(repoRoot, "alpha", envelope({
    slug: "alpha",
    affectedSurfaces: ["path:src/alpha/**"],
    prerequisites: ["foundation:alpha-base", "shared-auth"],
  }));
  startPortfolioTheme(repoRoot, "beta", envelope({
    slug: "beta",
    affectedSurfaces: ["path:src/beta/**"],
    prerequisites: ["foundation:beta-base", "shared-auth"],
  }));

  refreshPortfolio({ repoRoot, cwd: repoRoot });
  const artifact = readArtifact(repoRoot);
  assert.equal(artifact.relations[0].relation_type, "parallel_safe");
  assert.ok(artifact.extensions["quest-agent"].refresh_diagnostics.advisory_notes.some((note) => note.includes("shared-auth")));
  assert.ok(artifact.registered_plans.every((plan) => plan.advisory_notes.some((note) => note.includes("shared-auth"))));
});

test("relation keys stay stable across plan order, surface order, and plan_ref changes", () => {
  const first = buildPairwisePortfolioRelations(
    {
      envelope: envelope({
        slug: "alpha",
        planId: "plan-b",
        planRef: "theme:alpha-a",
        affectedSurfaces: ["path:src/auth/**", "path:src/auth/session/**"],
        expectedArtifacts: ["artifact:code-module"],
      }),
    },
    {
      envelope: envelope({
        slug: "beta",
        planId: "plan-a",
        planRef: "theme:beta-a",
        affectedSurfaces: ["path:src/auth/session/**", "path:src/auth/**"],
        expectedArtifacts: ["artifact:code-module"],
      }),
    },
  ).map((relation) => relation.relation_key);

  const second = buildPairwisePortfolioRelations(
    {
      envelope: envelope({
        slug: "alpha",
        planId: "plan-b",
        planRef: "theme:alpha-b",
        affectedSurfaces: ["path:src/auth/session/**", "path:src/auth/**"],
        expectedArtifacts: ["artifact:code-module"],
      }),
    },
    {
      envelope: envelope({
        slug: "beta",
        planId: "plan-a",
        planRef: "theme:beta-b",
        affectedSurfaces: ["path:src/auth/**", "path:src/auth/session/**"],
        expectedArtifacts: ["artifact:code-module"],
      }),
    },
  ).map((relation) => relation.relation_key);

  assert.deepEqual(first, second);
});
