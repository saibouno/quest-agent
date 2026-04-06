import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  benchmarkRun,
  benchmarkScaffold,
  benchmarkValidate,
  main,
  scaffoldCloseout,
  reviewPlan,
  scaffoldPlan,
  setStatus,
  verifyTheme,
} from "../scripts/theme-harness.mjs";
import { evaluatePlanMarkdown } from "../scripts/theme-harness-review-core.mjs";
import { recordAftercare, recordExplain, startTheme } from "../scripts/theme-ops.mjs";
import { HarnessError, actionPayload, detectCanonicalRepoRoot, loadState, resolveCheckoutRoots } from "../scripts/theme-harness-lib.mjs";

const CURRENT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewFixtures = JSON.parse(
  readFileSync(path.join(CURRENT_REPO_ROOT, "tests", "fixtures", "theme-harness-review-cases.json"), "utf8"),
);

function fakeGitExecutor(repoRoot, args) {
  if (args[0] !== "worktree" || args[1] !== "add") {
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  }

  const worktreePath = args[2];
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(path.join(worktreePath, ".git"), `gitdir: ${path.join(repoRoot, ".git", "worktrees", path.basename(worktreePath))}\n`, "utf8");
}

function passCommandRunner(command) {
  return {
    command,
    status: "pass",
    exit_code: 0,
    ran_at: new Date().toISOString(),
    stdout: "",
    stderr: "",
  };
}

function fakeGitCommonDirExecutor(commonDir) {
  return (_checkoutRoot, args) => {
    assert.deepEqual(args, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return {
      status: 0,
      stdout: `${commonDir}\n`,
      stderr: "",
    };
  };
}

function failingGitCommonDirExecutor() {
  return () => ({
    status: 1,
    stdout: "",
    stderr: "fatal: simulated git failure",
  });
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
  const repoRoot = path.join(os.tmpdir(), `quest-agent-harness-${suffix}-${Date.now()}`);
  mkdirSync(repoRoot, { recursive: true });
  testContext.after(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  seedRunbookFiles(repoRoot);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n", "utf8");

  return repoRoot;
}

function benchmarkPackPath(repoRoot, packId) {
  return path.join(repoRoot, "config", "harness_benchmark_packs", `${packId}.json`);
}

const SHARED_BUDGET_KEYS = [
  "max_attempts",
  "max_no_improve_streak",
  "max_wall_clock_ms",
  "max_kept_candidates",
];

const SHARED_RETENTION_POLICY_KEYS = [
  "keep_last_n_runs",
  "keep_last_n_kept_candidates",
  "delete_unkept_patches_after_days",
  "delete_sandboxes_after_hours",
  "retain_failed_sandboxes",
];

const LEGACY_BUDGET_KEYS = [
  "max_baseline_runs",
  "max_candidate_runs",
  "max_runtime_ms",
  "parallelism",
];

const LEGACY_RETENTION_POLICY_KEYS = [
  "keep_best_runs",
  "keep_recent_runs",
  "trim_after_days",
  "recent_window_hours",
  "keep_failed_runs",
];

function confirmedBrief(slug) {
  return [
    "# Theme Brief",
    "",
    "## Summary",
    "",
    `- Theme name: Theme ${slug}`,
    `- Goal: Add deterministic harness support for ${slug}.`,
    "- Done condition: The harness scripts and docs are in place and the saved checks pass.",
    "- Expected end state: merge_and_delete",
    "",
    "## Key Changes",
    "",
    "- Add local harness docs.",
    "- Add deterministic harness scripts.",
    "",
    "## Important Interfaces",
    "",
    "- No public API changes in this fixture.",
    "",
    "## Approval Boundary",
    "",
    "- Keep the change inside the local fixture repo.",
    "",
    "## Out Of Scope",
    "",
    "- Cross-repo extraction.",
    "",
    "## Test Plan",
    "",
    "- `node -e \"process.exit(0)\"`",
    "",
    "## Assumptions",
    "",
    "- Tests run in a temporary fixture repo.",
    "",
  ].join("\n");
}

function startFixtureTheme(repoRoot, slug, requiredChecks = ["node -e \"process.exit(0)\""]) {
  const result = startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: `Theme ${slug}`,
    slug,
    goal: `Goal ${slug}`,
    doneCondition: `Done ${slug}`,
    requiredChecks,
    execGit: fakeGitExecutor,
  });
  assert.equal(result.status, "pass");
  const state = loadState(repoRoot, slug);
  writeFileSync(state.brief_path, confirmedBrief(slug), "utf8");
  return state;
}

test("resolveCheckoutRoots derives canonical repo root from git common dir in a nested worktree", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-worktree");
  const checkoutRoot = path.join(repoRoot, ".worktrees", "resolver-worktree");
  mkdirSync(checkoutRoot, { recursive: true });

  const result = resolveCheckoutRoots(checkoutRoot, {
    execGit: fakeGitCommonDirExecutor(path.join(repoRoot, ".git", "worktrees", "resolver-worktree")),
  });

  assert.equal(result.checkoutRoot, checkoutRoot);
  assert.equal(result.canonicalRepoRoot, repoRoot);
  assert.equal(result.toolingRoot, path.join(repoRoot, "node_modules"));
});

test("resolveCheckoutRoots handles non-ASCII canonical paths from git common dir", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-日本語");
  const checkoutRoot = path.join(repoRoot, ".worktrees", "resolver-unicode");
  mkdirSync(checkoutRoot, { recursive: true });

  const result = resolveCheckoutRoots(checkoutRoot, {
    execGit: fakeGitCommonDirExecutor(path.join(repoRoot, ".git", "worktrees", "resolver-unicode")),
  });

  assert.equal(result.canonicalRepoRoot, repoRoot);
});

test("resolveCheckoutRoots supports .codex/worktrees path shapes through git common dir", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-codex-shape");
  const checkoutRoot = path.join(repoRoot, ".codex", "worktrees", "8242", "quest-agent");
  mkdirSync(checkoutRoot, { recursive: true });

  const result = resolveCheckoutRoots(checkoutRoot, {
    execGit: fakeGitCommonDirExecutor(path.join(repoRoot, ".git", "worktrees", "quest-agent")),
  });

  assert.equal(result.canonicalRepoRoot, repoRoot);
});

test("resolveCheckoutRoots prefers checkout-local node_modules over canonical fallback", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-local-tooling");
  const checkoutRoot = path.join(repoRoot, ".worktrees", "resolver-local-tooling");
  mkdirSync(path.join(checkoutRoot, "node_modules"), { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });

  const result = resolveCheckoutRoots(checkoutRoot, {
    execGit: fakeGitCommonDirExecutor(path.join(repoRoot, ".git", "worktrees", "resolver-local-tooling")),
  });

  assert.equal(result.toolingRoot, path.join(checkoutRoot, "node_modules"));
});

test("resolveCheckoutRoots falls back to canonical node_modules when checkout-local tooling is absent", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-canonical-tooling");
  const checkoutRoot = path.join(repoRoot, ".worktrees", "resolver-canonical-tooling");
  mkdirSync(checkoutRoot, { recursive: true });
  mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });

  const result = resolveCheckoutRoots(checkoutRoot, {
    execGit: fakeGitCommonDirExecutor(path.join(repoRoot, ".git", "worktrees", "resolver-canonical-tooling")),
  });

  assert.equal(result.toolingRoot, path.join(repoRoot, "node_modules"));
});

test("resolveCheckoutRoots raises an actionable error when required tooling packages are missing", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-missing-tooling");
  const checkoutRoot = path.join(repoRoot, ".worktrees", "resolver-missing-tooling");
  mkdirSync(checkoutRoot, { recursive: true });

  assert.throws(
    () => resolveCheckoutRoots(checkoutRoot, {
      execGit: fakeGitCommonDirExecutor(path.join(repoRoot, ".git", "worktrees", "resolver-missing-tooling")),
      requiredPackages: ["next"],
    }),
    (error) => {
      assert.match(error.message, /npm\.cmd ci/u);
      assert.match(error.message, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
      return true;
    },
  );
});

test("detectCanonicalRepoRoot falls back to filesystem gitdir parsing when git rev-parse fails", (t) => {
  const repoRoot = createFixtureRepo(t, "resolver-fallback");
  const checkoutRoot = path.join(repoRoot, ".worktrees", "resolver-fallback");
  mkdirSync(checkoutRoot, { recursive: true });
  writeFileSync(
    path.join(checkoutRoot, ".git"),
    `gitdir: ${path.join(repoRoot, ".git", "worktrees", "resolver-fallback")}\n`,
    "utf8",
  );

  assert.equal(detectCanonicalRepoRoot(checkoutRoot, { execGit: failingGitCommonDirExecutor() }), repoRoot);
});

test("scaffold-plan creates canonical plan and status artifacts", (t) => {
  const repoRoot = createFixtureRepo(t, "scaffold");
  const slug = "scaffold";
  startFixtureTheme(repoRoot, slug);

  const result = scaffoldPlan({ repoRoot, slug });
  assert.equal(result.status, "pass");

  const state = loadState(repoRoot, slug);
  assert.equal(state.harness.workflow_status, "plan_drafted");
  assert.ok(existsSync(state.harness.plan_path));
  assert.ok(existsSync(state.harness.status_path));
});

test("review-plan records pass and revise_required results", (t) => {
  const repoRoot = createFixtureRepo(t, "review");
  const slug = "review";
  startFixtureTheme(repoRoot, slug);
  scaffoldPlan({ repoRoot, slug });

  const passed = reviewPlan({ repoRoot, slug });
  assert.equal(passed.status, "pass");
  let state = loadState(repoRoot, slug);
  assert.equal(state.harness.workflow_status, "plan_reviewed");
  assert.equal(state.harness.review_results.result, "pass");

  const brokenPlan = readFileSync(state.harness.plan_path, "utf8").replace(
    /\n## Approval Boundary[\s\S]*?\n## Out Of Scope\n/u,
    "\n## Out Of Scope\n",
  );
  writeFileSync(state.harness.plan_path, brokenPlan, "utf8");
  state.harness.workflow_status = "plan_drafted";
  writeFileSync(path.join(repoRoot, "output", "theme_ops", `${slug}.json`), JSON.stringify(state, null, 2));

  const revised = reviewPlan({ repoRoot, slug });
  assert.equal(revised.status, "revise_required");
  state = loadState(repoRoot, slug);
  assert.equal(state.harness.workflow_status, "plan_drafted");
  assert.equal(state.harness.review_results.result, "revise_required");
  assert.ok(state.harness.review_results.finding_codes.includes("missing_approval_boundary"));
});

test("review evaluator matches merge contract golden cases", () => {
  for (const fixture of reviewFixtures) {
    const result = evaluatePlanMarkdown(fixture.plan_markdown);
    assert.equal(result.result, fixture.expected_result, fixture.case_id);
    assert.deepEqual(result.finding_codes, fixture.expected_finding_codes, fixture.case_id);
  }
});

test("set-status rejects human-only and owner-only targets", (t) => {
  const repoRoot = createFixtureRepo(t, "status");
  const slug = "status";
  startFixtureTheme(repoRoot, slug);
  scaffoldPlan({ repoRoot, slug });
  reviewPlan({ repoRoot, slug });

  assert.throws(() => setStatus({ repoRoot, slug, target: "approved" }), /human-only/);
  assert.throws(() => setStatus({ repoRoot, slug, target: "rejected" }), /human-only/);
  assert.throws(() => setStatus({ repoRoot, slug, target: "closeout_ready" }), /owned by another harness command/);
});

test("verify runs saved checks and persists validation runs", (t) => {
  const repoRoot = createFixtureRepo(t, "verify");
  const slug = "verify";
  startFixtureTheme(repoRoot, slug, ["node -e \"process.exit(0)\""]);
  scaffoldPlan({ repoRoot, slug });
  reviewPlan({ repoRoot, slug });
  setStatus({ repoRoot, slug, target: "implementing" });

  const result = verifyTheme({ repoRoot, slug, commandRunner: passCommandRunner });
  assert.equal(result.status, "verified");

  const state = loadState(repoRoot, slug);
  assert.equal(state.harness.workflow_status, "verified");
  assert.equal(state.harness.validation_runs.length, 1);
  assert.equal(state.harness.validation_runs[0].status, "pass");
});

test("benchmark-scaffold creates a tracked benchmark pack", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-scaffold");
  const packId = "prompt-pack";

  const result = benchmarkScaffold({ repoRoot, packId });
  assert.equal(result.status, "pass");
  assert.equal(result.benchmark_id, packId);
  assert.equal(result.created, true);
  assert.equal(result.overwritten, false);
  assert.ok(existsSync(result.pack_path));

  const pack = JSON.parse(readFileSync(result.pack_path, "utf8"));
  assert.equal(pack.extensions["quest-agent"].execution_capability, "adapter_shell_only");
  assert.deepEqual(Object.keys(pack.budgets).sort(), [...SHARED_BUDGET_KEYS].sort());
  assert.deepEqual(Object.keys(pack.retention_policy).sort(), [...SHARED_RETENTION_POLICY_KEYS].sort());
  for (const legacyKey of LEGACY_BUDGET_KEYS) {
    assert.equal(Object.hasOwn(pack.budgets, legacyKey), false);
  }
  for (const legacyKey of LEGACY_RETENTION_POLICY_KEYS) {
    assert.equal(Object.hasOwn(pack.retention_policy, legacyKey), false);
  }
  assert.deepEqual(pack.verification_commands, [
    "npm.cmd run harness:test:noprofile",
    "npm.cmd run lint:noprofile",
    "npm.cmd run typecheck:noprofile",
    "npm.cmd run build:noprofile",
    "npm.cmd run guardrails:noprofile",
  ]);
});

test("benchmark-scaffold rejects an existing pack unless force is set", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-scaffold-existing");
  const packId = "prompt-pack";

  benchmarkScaffold({ repoRoot, packId });

  assert.throws(
    () => benchmarkScaffold({ repoRoot, packId }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && /already exists/u.test(error.message),
  );
});

test("benchmark-scaffold overwrites an existing pack only with force", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-scaffold-force");
  const packId = "prompt-pack";
  const first = benchmarkScaffold({ repoRoot, packId });

  const packPath = benchmarkPackPath(repoRoot, packId);
  const mutated = JSON.parse(readFileSync(packPath, "utf8"));
  mutated.description = "stale";
  writeFileSync(packPath, JSON.stringify(mutated, null, 2), "utf8");

  const result = benchmarkScaffold({ repoRoot, packId, force: true });
  assert.equal(result.status, "pass");
  assert.equal(result.created, false);
  assert.equal(result.overwritten, true);
  assert.equal(result.pack_hash === first.pack_hash, true);

  const overwritten = JSON.parse(readFileSync(packPath, "utf8"));
  assert.notEqual(overwritten.description, "stale");
});

test("benchmark-validate passes for a scaffolded pack with the full required contract", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-pass");
  const packId = "validate-pass";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.equal(result.benchmark_id, packId);
  assert.equal(result.pack_path, scaffolded.pack_path);
  assert.equal(result.pack_hash, scaffolded.pack_hash);
  assert.equal(result.normalized_pack.primary_score.metric_key, "benchmark_score");
  assert.deepEqual(Object.keys(result.normalized_pack.budgets).sort(), [...SHARED_BUDGET_KEYS].sort());
  assert.deepEqual(
    Object.keys(result.normalized_pack.retention_policy).sort(),
    [...SHARED_RETENTION_POLICY_KEYS].sort(),
  );
});

test("benchmark-validate passes for the checked-in tracked pack", () => {
  const packPath = path.join(
    CURRENT_REPO_ROOT,
    "config",
    "harness_benchmark_packs",
    "quest-agent-theme-harness-v1.json",
  );

  const result = benchmarkValidate({ packPath });
  assert.equal(result.status, "pass");
  assert.equal(result.benchmark_id, "quest-agent-theme-harness-v1");
  assert.equal(result.pack_path, packPath);
});

test("benchmark-validate accepts packs without primary_score.target_value", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-optional-target");
  const packId = "validate-optional-target";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  delete pack.primary_score.target_value;
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.equal(Object.hasOwn(result.normalized_pack.primary_score, "target_value"), false);
});

test("benchmark-validate accepts packs with empty secondary_metrics", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-empty-secondary");
  const packId = "validate-empty-secondary";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.secondary_metrics = [];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.normalized_pack.secondary_metrics, []);
});

test("benchmark-validate accepts packs with empty mutable_paths", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-empty-mutable");
  const packId = "validate-empty-mutable";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.mutable_paths = [];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.normalized_pack.mutable_paths, []);
});

test("benchmark-validate accepts packs with empty fixed_paths", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-empty-fixed");
  const packId = "validate-empty-fixed";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.fixed_paths = [];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.normalized_pack.fixed_paths, []);
});

test("benchmark-validate accepts packs with empty verification_commands", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-empty-verification");
  const packId = "validate-empty-verification";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.verification_commands = [];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.normalized_pack.verification_commands, []);
});

test("benchmark-validate accepts packs when mutable_paths, fixed_paths, and verification_commands are all empty", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-empty-arrays");
  const packId = "validate-empty-arrays";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.mutable_paths = [];
  pack.fixed_paths = [];
  pack.verification_commands = [];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.deepEqual(result.normalized_pack.mutable_paths, []);
  assert.deepEqual(result.normalized_pack.fixed_paths, []);
  assert.deepEqual(result.normalized_pack.verification_commands, []);
});

test("benchmark-validate accepts packs without target_value and with empty secondary_metrics", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-shared-contract");
  const packId = "validate-shared-contract";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  delete pack.primary_score.target_value;
  pack.secondary_metrics = [];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  const result = benchmarkValidate({ packPath: scaffolded.pack_path });
  assert.equal(result.status, "pass");
  assert.equal(Object.hasOwn(result.normalized_pack.primary_score, "target_value"), false);
  assert.deepEqual(result.normalized_pack.secondary_metrics, []);
});

test("benchmark-validate rejects legacy local budgets keys", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-legacy-budgets");
  const packId = "validate-legacy-budgets";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.budgets.max_baseline_runs = 3;
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  assert.throws(
    () => benchmarkValidate({ packPath: scaffolded.pack_path }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && error.details.field === "budgets"
      && Array.isArray(error.details.unknown_keys)
      && error.details.unknown_keys.includes("max_baseline_runs"),
  );
});

test("benchmark-validate rejects legacy local retention_policy keys", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-legacy-retention");
  const packId = "validate-legacy-retention";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.retention_policy.keep_best_runs = 3;
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  assert.throws(
    () => benchmarkValidate({ packPath: scaffolded.pack_path }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && error.details.field === "retention_policy"
      && Array.isArray(error.details.unknown_keys)
      && error.details.unknown_keys.includes("keep_best_runs"),
  );
});

test("benchmark-validate rejects unknown top-level keys", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-unknown");
  const packId = "validate-unknown";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.unexpected = true;
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  assert.throws(
    () => benchmarkValidate({ packPath: scaffolded.pack_path }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && Array.isArray(error.details.unknown_top_level_keys)
      && error.details.unknown_top_level_keys.includes("unexpected"),
  );
});

test("benchmark-validate rejects overlaps between mutable_paths and fixed_paths", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-overlap");
  const packId = "validate-overlap";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  pack.fixed_paths = ["prompts/**", ...pack.fixed_paths];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  assert.throws(
    () => benchmarkValidate({ packPath: scaffolded.pack_path }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && Array.isArray(error.details.overlaps)
      && error.details.overlaps.some((entry) => entry.fixed_path === "prompts/**"),
  );
});

test("benchmark-validate rejects packs without extensions.quest-agent", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-extension");
  const packId = "validate-extension";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));
  delete pack.extensions["quest-agent"];
  writeFileSync(scaffolded.pack_path, JSON.stringify(pack, null, 2), "utf8");

  assert.throws(
    () => benchmarkValidate({ packPath: scaffolded.pack_path }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && /extensions\.quest-agent/u.test(error.message),
  );
});

test("benchmark-validate computes the same hash across key order and formatting changes", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-validate-hash");
  const packId = "validate-hash";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const pack = JSON.parse(readFileSync(scaffolded.pack_path, "utf8"));

  const reorderedPack = {
    extensions: {
      "quest-agent": {
        verification_profile: pack.extensions["quest-agent"].verification_profile,
        future_runtime_root: pack.extensions["quest-agent"].future_runtime_root,
        execution_capability: pack.extensions["quest-agent"].execution_capability,
      },
    },
    retention_policy: {
      retain_failed_sandboxes: pack.retention_policy.retain_failed_sandboxes,
      delete_sandboxes_after_hours: pack.retention_policy.delete_sandboxes_after_hours,
      delete_unkept_patches_after_days: pack.retention_policy.delete_unkept_patches_after_days,
      keep_last_n_kept_candidates: pack.retention_policy.keep_last_n_kept_candidates,
      keep_last_n_runs: pack.retention_policy.keep_last_n_runs,
    },
    keep_policy: {
      allow_equal_primary_with_secondary_improvement:
        pack.keep_policy.allow_equal_primary_with_secondary_improvement,
    },
    budgets: {
      max_kept_candidates: pack.budgets.max_kept_candidates,
      max_wall_clock_ms: pack.budgets.max_wall_clock_ms,
      max_no_improve_streak: pack.budgets.max_no_improve_streak,
      max_attempts: pack.budgets.max_attempts,
    },
    secondary_metrics: [
      {
        improvement_threshold: pack.secondary_metrics[0].improvement_threshold,
        objective: pack.secondary_metrics[0].objective,
        metric_key: pack.secondary_metrics[0].metric_key,
      },
    ],
    primary_score: {
      target_value: pack.primary_score.target_value,
      improvement_threshold: pack.primary_score.improvement_threshold,
      objective: pack.primary_score.objective,
      metric_key: pack.primary_score.metric_key,
    },
    verification_commands: [...pack.verification_commands],
    run_command: pack.run_command,
    fixed_paths: [...pack.fixed_paths],
    mutable_paths: [...pack.mutable_paths],
    target_surface: pack.target_surface,
    description: pack.description,
    benchmark_id: pack.benchmark_id,
    contract_version: pack.contract_version,
  };

  const altPackPath = benchmarkPackPath(repoRoot, "validate-hash-reordered");
  writeFileSync(altPackPath, `${JSON.stringify(reorderedPack, null, 4)}\n\n`, "utf8");

  const original = benchmarkValidate({ packPath: scaffolded.pack_path });
  const reordered = benchmarkValidate({ packPath: altPackPath });

  assert.equal(original.pack_hash, reordered.pack_hash);
});

test("benchmark-run direct invocation uses HarnessError action_required flow", (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-run-direct");
  const packId = "run-direct";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });

  assert.throws(
    () => benchmarkRun({ packPath: scaffolded.pack_path }),
    (error) => error instanceof HarnessError
      && error.status === "action_required"
      && error.details.execution_capability === "adapter_shell_only"
      && error.details.benchmark_id === packId,
  );
});

test("benchmark-run returns a non-runnable stub without creating runtime artifacts", async (t) => {
  const repoRoot = createFixtureRepo(t, "benchmark-run-cli");
  const packId = "run-cli";
  const scaffolded = benchmarkScaffold({ repoRoot, packId });
  const runtimeRoot = path.join(repoRoot, "output", "theme_ops", "benchmark");

  assert.equal(existsSync(runtimeRoot), false);

  const originalArgv = process.argv;
  let exitCode = 0;
  let payload = null;

  process.argv = [
    process.execPath,
    path.join(CURRENT_REPO_ROOT, "scripts", "theme-harness.mjs"),
    "benchmark-run",
    "--pack",
    scaffolded.pack_path,
  ];

  try {
    await main();
    assert.fail("benchmark-run should surface an action_required error through the CLI flow.");
  } catch (error) {
    if (!(error instanceof HarnessError)) {
      throw error;
    }
    payload = actionPayload({ status: error.status, message: error.message, details: error.details });
    exitCode = 1;
  } finally {
    process.argv = originalArgv;
  }

  assert.equal(exitCode, 1);
  assert.equal(payload.status, "action_required");
  assert.equal(payload.execution_capability, "adapter_shell_only");
  assert.equal(payload.benchmark_id, packId);
  assert.equal(payload.pack_path, scaffolded.pack_path);
  assert.equal(payload.pack_hash, scaffolded.pack_hash);
  assert.equal(existsSync(runtimeRoot), false);
});
test("scaffold-closeout gates on aftercare and explain, then succeeds", (t) => {
  const repoRoot = createFixtureRepo(t, "closeout");
  const slug = "closeout";
  startFixtureTheme(repoRoot, slug, ["node -e \"process.exit(0)\""]);
  scaffoldPlan({ repoRoot, slug });
  reviewPlan({ repoRoot, slug });
  setStatus({ repoRoot, slug, target: "implementing" });
  verifyTheme({ repoRoot, slug, commandRunner: passCommandRunner });

  assert.throws(() => scaffoldCloseout({ repoRoot, slug }), /requires recorded aftercare and plain-language summary/);

  recordAftercare({
    repoRoot,
    cwd: repoRoot,
    slug,
    stuckPoints: ["Type-check worker setup was flaky."],
    preventionChanges: ["Added deterministic harness tests."],
  });
  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Harness closeout is ready.",
    whatChanged: ["Added local harness scripts and runbooks."],
  });

  const result = scaffoldCloseout({ repoRoot, slug });
  assert.equal(result.status, "pass");
  assert.equal(result.promotion_result, "noop");

  const updated = loadState(repoRoot, slug);
  assert.equal(updated.harness.workflow_status, "closeout_ready");
  assert.equal(updated.context_promotion.state, "noop");
  assert.ok(existsSync(updated.harness.closeout_path));
  assert.match(readFileSync(updated.harness.closeout_path, "utf8"), /## Known Issues \/ Follow-ups/u);
});

test("scaffold-closeout stays at verified when durable-context promotion is blocked", (t) => {
  const repoRoot = createFixtureRepo(t, "closeout-blocked");
  const slug = "closeout-blocked";
  startFixtureTheme(repoRoot, slug, ["node -e \"process.exit(0)\""]);
  scaffoldPlan({ repoRoot, slug });
  reviewPlan({ repoRoot, slug });
  setStatus({ repoRoot, slug, target: "implementing" });
  verifyTheme({ repoRoot, slug, commandRunner: passCommandRunner });

  recordAftercare({
    repoRoot,
    cwd: repoRoot,
    slug,
    stuckPoints: ["Promotion drift was introduced after explain."],
    preventionChanges: ["Auto-promotion now checks stale target hashes before writing."],
  });
  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Closeout needs durable-context promotion first.",
    currentFocus: ["Promote durable delta before closeout."],
  });

  const currentStatePath = path.join(repoRoot, "docs", "context", "current-state.md");
  writeFileSync(currentStatePath, `${readFileSync(currentStatePath, "utf8")}\n`, "utf8");

  const result = scaffoldCloseout({ repoRoot, slug });
  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_state, "blocked");
  assert.equal(result.context_promotion_reason, "stale_target");

  const updated = loadState(repoRoot, slug);
  assert.equal(updated.harness.workflow_status, "verified");
  assert.equal(updated.context_promotion.state, "blocked");
  assert.equal(updated.context_promotion.reason, "stale_target");
  assert.ok(!existsSync(updated.harness.closeout_path));
});
