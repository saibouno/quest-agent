import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  assert.match(currentState, /GitHub-centered dependency security baseline/);

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

  assert.deepEqual(meta.active_plan_pointer, {
    kind: "manual_follow_up",
    slug: "dependency-security-settings-activation",
    path: "docs/runbooks/dependency-security.md",
  });
  assert.equal(meta.plan_status, "pending_external");
  assert.equal(meta.blocked_by.length, 1);
  assert.equal(
    meta.blocked_by[0].summary,
    "The repo-local dependency security baseline is in place, but GitHub repository security settings still require an admin-side confirmation or enablement pass when the implementer lacks valid repo-admin authentication.",
  );
  assert.equal(
    meta.resume_condition,
    "a repository admin confirms Dependency graph, Dependabot alerts, Dependabot security updates, and Dependabot malware alerts are enabled.",
  );
  assert.equal(meta.fallback_focus, "normal feature work with GitHub-centered dependency monitoring active in code and CI");
});

test("open questions and decisions keep required freshness and note structure", () => {
  const openQuestions = readRepoFile("docs/context/open-questions.md");
  assert.match(openQuestions, /^## Open Questions$/m);
  assert.match(openQuestions, /^## Blockers$/m);
  assert.match(openQuestions, /- id: `github-repo-security-settings-access`/);
  assert.match(openQuestions, /- observed_at: `2026-04-04T00:00:00\+09:00`/);
  assert.match(openQuestions, /- impact: /);
  assert.match(openQuestions, /- next unlock: /);
  assert.match(openQuestions, /- (last_verified_by|evidence_ref): /);

  const decisionsDir = path.join(REPO_ROOT, "docs", "context", "decisions");
  const decisionFiles = readdirSync(decisionsDir).filter((entry) => entry.endsWith(".md")).sort();
  assert.deepEqual(decisionFiles, [
    "nested-worktree-root-and-tooling-resolution.md",
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
    assert.match(document, /aftercare[\s\S]*explain[\s\S]*context promotion[\s\S]*scaffold-closeout/i);
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
