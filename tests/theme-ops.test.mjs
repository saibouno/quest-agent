import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeTheme, recordAftercare, recordExplain, setupTheme, startTheme, statusTheme } from "../scripts/theme-ops.mjs";
import { loadState } from "../scripts/theme-harness-lib.mjs";

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
  assert.equal(state.brief_path, path.join(repoRoot, "output", "theme_ops", `${slug}-brief.md`));
  assert.ok(existsSync(state.brief_path));
  assert.ok(existsSync(state.worktree_path));
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
