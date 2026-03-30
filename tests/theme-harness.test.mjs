import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scaffoldCloseout, reviewPlan, scaffoldPlan, setStatus, verifyTheme } from "../scripts/theme-harness.mjs";
import { evaluatePlanMarkdown } from "../scripts/theme-harness-review-core.mjs";
import { recordAftercare, recordExplain, startTheme } from "../scripts/theme-ops.mjs";
import { loadState } from "../scripts/theme-harness-lib.mjs";

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

function seedRunbookFiles(repoRoot) {
  const targets = [
    "docs/runbooks/theme-loop/PLAN_TEMPLATE.md",
    "docs/runbooks/theme-loop/STATUS_TEMPLATE.md",
    "docs/runbooks/theme-loop/CLOSEOUT_TEMPLATE.md",
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

  const updated = loadState(repoRoot, slug);
  assert.equal(updated.harness.workflow_status, "closeout_ready");
  assert.ok(existsSync(updated.harness.closeout_path));
  assert.match(readFileSync(updated.harness.closeout_path, "utf8"), /## Known Issues \/ Follow-ups/u);
});
