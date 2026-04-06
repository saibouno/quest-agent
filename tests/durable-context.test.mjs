import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { promoteDurableContext } from "../scripts/promote-durable-context.mjs";
import { recordExplain, startTheme } from "../scripts/theme-ops.mjs";
import { loadState } from "../scripts/theme-harness-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fakeGitExecutor(repoRoot, args) {
  if (args[0] !== "worktree" || args[1] !== "add") {
    throw new Error(`Unexpected git command: ${args.join(" ")}`);
  }

  const worktreePath = args[2];
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(path.join(worktreePath, ".git"), `gitdir: ${path.join(repoRoot, ".git", "worktrees", path.basename(worktreePath))}\n`, "utf8");
}

function seedFixtureFiles(repoRoot) {
  const targets = [
    "docs/context/adapter.json",
    "docs/context/current-state.md",
    "docs/context/current-state.meta.json",
    "docs/context/open-questions.md",
    "docs/context/metrics-source.md",
    "docs/context/decisions/nested-worktree-root-and-tooling-resolution.md",
    "docs/context/decisions/windows-safe-noprofile-spellings.md",
    "docs/runbooks/theme-loop/PLAN_TEMPLATE.md",
    "docs/runbooks/theme-loop/STATUS_TEMPLATE.md",
    "docs/runbooks/theme-loop/CLOSEOUT_TEMPLATE.md",
  ];

  for (const relativePath of targets) {
    const source = path.join(REPO_ROOT, relativePath);
    const destination = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(source, "utf8"), "utf8");
  }
}

function createFixtureRepo(testContext, suffix) {
  const repoRoot = path.join(os.tmpdir(), `quest-agent-durable-${suffix}-${Date.now()}`);
  mkdirSync(repoRoot, { recursive: true });
  testContext.after(() => {
    rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  seedFixtureFiles(repoRoot);
  writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n", "utf8");

  return repoRoot;
}

function startFixtureTheme(repoRoot, slug) {
  startTheme({
    repoRoot,
    cwd: repoRoot,
    themeName: `Theme ${slug}`,
    slug,
    execGit: fakeGitExecutor,
  });
}

test("adapter defines canonical durable-context ownership and boundaries", () => {
  const adapter = JSON.parse(readRepoFile("docs/context/adapter.json"));

  assert.equal(adapter.schema_version, 1);
  assert.equal(adapter.repo, "quest-agent");
  assert.equal(adapter.owner, "docs/context/adapter.json");
  assert.deepEqual(adapter.source_priority, ["canonical", "derived", "fallback"]);
  assert.ok(adapter.orientation_sources.includes("AGENTS.md"));
  assert.ok(adapter.orientation_sources.includes("README.md"));
  assert.ok(!adapter.canonical_artifacts.includes("AGENTS.md"));
  assert.ok(!adapter.canonical_artifacts.includes("README.md"));
  assert.deepEqual(
    Object.keys(adapter.roles).sort(),
    ["active_plan_pointer", "decision_store", "metric_source", "open_questions", "state_summary"].sort(),
  );

  for (const expectedPath of [
    "docs/context/current-state.md",
    "docs/context/current-state.meta.json",
    "docs/context/open-questions.md",
    "docs/context/decisions/*.md",
    "docs/context/metrics-source.md",
  ]) {
    assert.ok(adapter.canonical_artifacts.includes(expectedPath));
  }
});

test("current-state artifacts expose required sections and restart metadata", () => {
  const currentState = readRepoFile("docs/context/current-state.md");
  for (const heading of [
    "## Metadata",
    "## Product Shape",
    "## Current Focus",
    "## Blocked Work",
    "## Fallback Focus",
    "## Recent Confirmed Decisions",
    "## Next Safe Themes",
  ]) {
    assert.match(currentState, new RegExp(`^${escapeRegExp(heading)}$`, "m"));
  }
  assert.match(currentState, /Dependency security stays GitHub-centered for this repo/);

  const meta = JSON.parse(readRepoFile("docs/context/current-state.meta.json"));
  for (const key of [
    "updated_at",
    "owner",
    "status",
    "review_at",
    "supersedes",
    "evidence_quality",
    "source_refs",
    "active_plan_pointer",
    "plan_status",
    "blocked_by",
    "resume_condition",
    "fallback_focus",
  ]) {
    assert.ok(Object.hasOwn(meta, key), `Missing key ${key}`);
  }

  assert.equal(meta.active_plan_pointer, null);
  assert.equal(meta.plan_status, "");
  assert.equal(meta.blocked_by.length, 0);
  assert.equal(meta.resume_condition, "No blocked work is recorded right now.");
  assert.equal(
    meta.fallback_focus,
    "Use the snapshot-backed onboarding flow for new planning work and keep legacy editing scoped to pre-snapshot goals.",
  );
});

test("open questions and decisions keep required freshness and note structure", () => {
  const openQuestions = readRepoFile("docs/context/open-questions.md");
  assert.match(openQuestions, /^## Open Questions$/m);
  assert.match(openQuestions, /^## Blockers$/m);
  assert.match(openQuestions, /^## Resolved \/ Superseded$/m);
  assert.match(openQuestions, /- none promoted right now\./);
  assert.match(openQuestions, /### `github-repo-security-settings-access`/);
  assert.match(openQuestions, /### `nested-worktree-prerender-invariant`/);
  assert.match(openQuestions, /- status: `resolved`/);
  assert.match(openQuestions, /- resolved_at: `2026-04-04T02:00:00\+09:00`/);
  assert.match(openQuestions, /- source_refs:/);

  const decisionsDir = path.join(REPO_ROOT, "docs", "context", "decisions");
  const decisionFiles = readdirSync(decisionsDir).filter((entry) => entry.endsWith(".md")).sort();
  assert.deepEqual(decisionFiles, [
    "auto-context-closeout.md",
    "goal-snapshots-own-canonical-planning-state.md",
    "nested-worktree-root-and-tooling-resolution.md",
    "root-checkout-security-remediation-lane.md",
    "route-resimulation-preserves-executed-work.md",
    "windows-safe-noprofile-spellings.md",
  ]);

  for (const fileName of decisionFiles) {
    const note = readFileSync(path.join(decisionsDir, fileName), "utf8");
    for (const heading of [
      "## Metadata",
      "## Decision",
      "## Why It Stands",
      "## Operational Consequence",
      "## Source Refs",
    ]) {
      assert.match(note, new RegExp(`^${escapeRegExp(heading)}$`, "m"));
    }
  }
});

test("metrics source stays pointer-only and read order prefers docs/context", () => {
  const metricsSource = readRepoFile("docs/context/metrics-source.md");
  assert.match(metricsSource, /lib\/quest-agent\/server\/store\.ts/);
  assert.match(metricsSource, /docs\/vercel-preview-runbook\.md/);
  assert.match(metricsSource, /No numeric metric values are canonicalized in this note\./);

  const agents = readRepoFile("AGENTS.md");
  const orderedRefs = [
    "`README.md`",
    "`docs/context/current-state.md`",
    "`docs/context/current-state.meta.json`",
    "`docs/context/open-questions.md`",
    "`docs/context/decisions/*.md`",
  ];
  const positions = orderedRefs.map((fragment) => agents.indexOf(fragment));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(agents, /`README\.md` is an orientation source, not the current-state owner\./);
});

test("promotion rules live in the runbook and theme loop only points to them", () => {
  const runbook = readRepoFile("docs/runbooks/durable-context-promotion.md");
  const skill = readRepoFile(".agents/skills/context-promotion/SKILL.md");
  const themeLoop = readRepoFile(".agents/skills/theme-loop/SKILL.md");
  const implementRunbook = readRepoFile("docs/runbooks/theme-loop/IMPLEMENT_RUNBOOK.md");
  const workflow = readRepoFile("workflows/HARNESSED_THEME_WORKFLOW.md");

  assert.match(runbook, /^## Promotion Rubric$/m);
  assert.match(runbook, /^## Evidence Quality$/m);
  assert.match(runbook, /^## `source_refs\[\]` Schema$/m);
  assert.match(runbook, /^## Closeout Payload$/m);
  assert.match(runbook, /`direct`: /);
  assert.match(runbook, /`mixed`: /);

  assert.match(skill, /docs\/runbooks\/durable-context-promotion\.md/);
  assert.match(skill, /Stop if there is no durable delta to promote\./);
  assert.doesNotMatch(skill, /evidence_quality/);
  assert.doesNotMatch(skill, /Closeout Payload/);

  for (const document of [themeLoop, implementRunbook, workflow]) {
    assert.match(document, /aftercare[\s\S]*explain[\s\S]*scaffold-closeout/i);
    assert.match(document, /auto-promot/i);
    assert.match(document, /docs\/runbooks\/durable-context-promotion\.md/);
  }
});

test("canonical durable-context files exist without depending on scratch evidence", () => {
  for (const relativePath of [
    "docs/context/adapter.json",
    "docs/context/current-state.md",
    "docs/context/current-state.meta.json",
    "docs/context/open-questions.md",
    "docs/context/metrics-source.md",
    "docs/runbooks/durable-context-promotion.md",
    ".agents/skills/context-promotion/SKILL.md",
  ]) {
    assert.ok(existsSync(path.join(REPO_ROOT, relativePath)), `Missing ${relativePath}`);
  }
});

test("promoteDurableContext returns noop when no durable delta was recorded", (t) => {
  const repoRoot = createFixtureRepo(t, "noop");
  const slug = "noop";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "No durable delta here.",
  });

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "noop");
  assert.equal(result.context_promotion_reason, "no_durable_delta");

  const state = loadState(repoRoot, slug);
  assert.equal(state.context_promotion.state, "noop");
  assert.equal(state.context_promotion.reason, "no_durable_delta");
});

test("promoteDurableContext applies canonical durable-context updates from a valid delta", (t) => {
  const repoRoot = createFixtureRepo(t, "applied");
  const slug = "applied";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Durable context changed.",
    currentFocus: ["Auto-promotion now runs inside scaffold-closeout."],
    nextSafeThemes: ["closeout-followup"],
    decisionJson: [JSON.stringify({
      slug: "auto-context-closeout",
      title: "Auto Context Closeout",
      decision: "Scaffold closeout auto-promotes the smallest durable delta before it becomes ready.",
      why_it_stands: "This keeps canonical docs/context aligned with the closeout workflow.",
      operational_consequence: "Themes must finish promotion before closeout_ready is recorded.",
      source_refs: [{
        kind: "json",
        path_or_uri: "output/theme_ops/applied.json",
        locator: "durable_delta",
        captured_at: "2026-04-04T00:00:00+09:00",
      }],
    })],
    openQuestionJson: [JSON.stringify({
      id: "auto-closeout-open-question",
      summary: "Should Product Shape ever become auto-promotable?",
      impact: "The repo keeps that section manual-only for now.",
      next_unlock: "Review the manual-only boundary after v1 closes out.",
      status: "open",
    })],
    blockerJson: [JSON.stringify({
      id: "auto-closeout-blocker",
      summary: "Promotion must finish before closeout_ready.",
      impact: "Closeout stays at verified when promotion is blocked.",
      next_unlock: "Rerun scaffold-closeout after the promotion issue is fixed.",
      status: "open",
      observed_at: "2026-04-04T00:00:00+09:00",
      evidence_ref: "output/theme_ops/applied.json#durable_delta",
    })],
    metricWatch: ["Watch the freshness of canonical durable context after closeout."],
    activePlanJson: JSON.stringify({
      kind: "theme_state",
      slug: "applied",
      path: "output/theme_ops/applied.json",
    }),
    planStatus: "blocked",
    resumeCondition: "Rerun scaffold-closeout after auto-promotion succeeds.",
    fallbackFocusValues: ["docs/context and harness hygiene"],
    sourceRefJson: [JSON.stringify({
      kind: "markdown",
      path_or_uri: "output/theme_ops/applied-closeout.md",
      locator: "Summary",
      captured_at: "2026-04-04T00:00:00+09:00",
    })],
  });

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "applied");
  assert.ok(result.context_promotion_changed_artifacts.includes("docs/context/current-state.md"));
  assert.ok(result.context_promotion_changed_artifacts.includes("docs/context/current-state.meta.json"));
  assert.ok(result.context_promotion_changed_artifacts.includes("docs/context/open-questions.md"));
  assert.ok(result.context_promotion_changed_artifacts.includes("docs/context/metrics-source.md"));
  assert.ok(result.context_promotion_changed_artifacts.includes("docs/context/decisions/auto-context-closeout.md"));

  const currentState = readFileSync(path.join(repoRoot, "docs", "context", "current-state.md"), "utf8");
  assert.match(currentState, /Auto-promotion now runs inside scaffold-closeout\./);
  assert.match(currentState, /Scaffold closeout auto-promotes the smallest durable delta before it becomes ready\./);

  const meta = JSON.parse(readFileSync(path.join(repoRoot, "docs", "context", "current-state.meta.json"), "utf8"));
  assert.equal(meta.active_plan_pointer.slug, "applied");
  assert.equal(meta.plan_status, "blocked");
  assert.equal(meta.fallback_focus, "docs/context and harness hygiene");
  assert.ok(meta.source_refs.some((entry) => entry.path_or_uri === "output/theme_ops/applied-closeout.md"));

  const openQuestions = readFileSync(path.join(repoRoot, "docs", "context", "open-questions.md"), "utf8");
  assert.match(openQuestions, /auto-closeout-open-question/);
  assert.match(openQuestions, /auto-closeout-blocker/);
  assert.match(openQuestions, /^## Resolved \/ Superseded$/m);

  const metrics = readFileSync(path.join(repoRoot, "docs", "context", "metrics-source.md"), "utf8");
  assert.match(metrics, /Watch the freshness of canonical durable context after closeout\./);

  const decision = readFileSync(path.join(repoRoot, "docs", "context", "decisions", "auto-context-closeout.md"), "utf8");
  assert.match(decision, /Auto Context Closeout/);
  assert.match(decision, /smallest durable delta/);
});

test("promoteDurableContext blocks malformed durable delta", (t) => {
  const repoRoot = createFixtureRepo(t, "malformed");
  const slug = "malformed";
  startFixtureTheme(repoRoot, slug);

  const statePath = path.join(repoRoot, "output", "theme_ops", `${slug}.json`);
  const rawState = JSON.parse(readFileSync(statePath, "utf8"));
  rawState.durable_delta = {
    ...rawState.durable_delta,
    current_focus: ["Broken durable delta."],
    decision_entries: [{
      slug: "broken",
      title: "Broken",
      decision: "Broken",
      why_it_stands: "Broken",
      operational_consequence: "Broken",
      source_refs: [],
    }],
    recorded_fields: ["current_focus", "decision_entries"],
    baseline_context_hashes: {
      "docs/context/current-state.md": "placeholder",
      "docs/context/decisions/broken.md": "placeholder",
    },
  };
  writeFileSync(statePath, `${JSON.stringify(rawState, null, 2)}\n`, "utf8");

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_reason, "malformed_delta");
});

test("promoteDurableContext blocks owner mismatches in the adapter mapping", (t) => {
  const repoRoot = createFixtureRepo(t, "owner-mismatch");
  const slug = "owner-mismatch";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Current focus changed.",
    currentFocus: ["Owner mapping must stay canonical."],
  });

  const adapterPath = path.join(repoRoot, "docs", "context", "adapter.json");
  const adapter = JSON.parse(readFileSync(adapterPath, "utf8"));
  adapter.roles.state_summary.path = "docs/context/not-current-state.md";
  writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`, "utf8");

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_reason, "owner_mismatch");
});

test("promoteDurableContext blocks ambiguous adapter targets", (t) => {
  const repoRoot = createFixtureRepo(t, "ambiguous-target");
  const slug = "ambiguous-target";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Current focus changed.",
    currentFocus: ["Ambiguous canonical targets must be rejected."],
  });

  const adapterPath = path.join(repoRoot, "docs", "context", "adapter.json");
  const adapter = JSON.parse(readFileSync(adapterPath, "utf8"));
  adapter.canonical_artifacts.push("docs/context/current-state.md");
  writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`, "utf8");

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_reason, "ambiguous_target");
});

test("promoteDurableContext blocks conflicting duplicate ids", (t) => {
  const repoRoot = createFixtureRepo(t, "duplicate-ids");
  const slug = "duplicate-ids";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Duplicate ids should block promotion.",
    openQuestionJson: [JSON.stringify({
      id: "duplicate-entry",
      summary: "Open question uses this id.",
      impact: "Conflict handling should block promotion.",
      next_unlock: "Give each entry a unique id.",
      status: "open",
    })],
    blockerJson: [JSON.stringify({
      id: "duplicate-entry",
      summary: "Blocker reuses the same id.",
      impact: "The helper should reject the conflicting durable delta.",
      next_unlock: "Give each entry a unique id.",
      status: "open",
    })],
  });

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_reason, "conflicting_duplicate_ids");
});

test("promoteDurableContext blocks stale target hashes", (t) => {
  const repoRoot = createFixtureRepo(t, "stale");
  const slug = "stale";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Current focus changed.",
    currentFocus: ["Stale hashes should block promotion."],
  });

  const currentStatePath = path.join(repoRoot, "docs", "context", "current-state.md");
  writeFileSync(currentStatePath, `${readFileSync(currentStatePath, "utf8")}\n`, "utf8");

  const result = promoteDurableContext({ repoRoot, slug });
  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_reason, "stale_target");
});

test("promoteDurableContext restores touched files after a write failure", (t) => {
  const repoRoot = createFixtureRepo(t, "write-failure");
  const slug = "write-failure";
  startFixtureTheme(repoRoot, slug);

  recordExplain({
    repoRoot,
    cwd: repoRoot,
    slug,
    oneLine: "Promotion should roll back on write failure.",
    currentFocus: ["Rollback write failures cleanly."],
    sourceRefJson: [JSON.stringify({
      kind: "markdown",
      path_or_uri: "output/theme_ops/write-failure-closeout.md",
      locator: "Summary",
      captured_at: "2026-04-04T00:00:00+09:00",
    })],
  });

  const currentStatePath = path.join(repoRoot, "docs", "context", "current-state.md");
  const metaPath = path.join(repoRoot, "docs", "context", "current-state.meta.json");
  const currentStateBefore = readFileSync(currentStatePath, "utf8");
  const metaBefore = readFileSync(metaPath, "utf8");

  let callCount = 0;
  const result = promoteDurableContext({
    repoRoot,
    slug,
    replaceArtifact({ targetPath, tempPath }) {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("simulated write failure");
      }
      writeFileSync(targetPath, readFileSync(tempPath, "utf8"), "utf8");
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.context_promotion_reason, "write_failure");
  assert.equal(readFileSync(currentStatePath, "utf8"), currentStateBefore);
  assert.equal(readFileSync(metaPath, "utf8"), metaBefore);
});
