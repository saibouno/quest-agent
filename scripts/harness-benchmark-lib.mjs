import { existsSync } from "node:fs";
import path from "node:path";

import {
  HarnessError,
  actionPayload,
  ensureDir,
  hashContent,
  normalizePath,
  readJson,
  writeJson,
} from "./theme-harness-lib.mjs";

export const BENCHMARK_PACKS_DIR = "config/harness_benchmark_packs";
export const DEFAULT_BENCHMARK_PACK_ID = "quest-agent-theme-harness-v1";
export const ADAPTER_EXECUTION_CAPABILITY = "adapter_shell_only";
export const FUTURE_RUNTIME_ROOT = "output/theme_ops/benchmark";
export const VERIFICATION_PROFILE = "quest-agent-harness-v1";

export const REQUIRED_TOP_LEVEL_KEYS = [
  "contract_version",
  "benchmark_id",
  "description",
  "target_surface",
  "mutable_paths",
  "fixed_paths",
  "run_command",
  "verification_commands",
  "primary_score",
  "secondary_metrics",
  "budgets",
  "keep_policy",
  "retention_policy",
  "extensions",
];

const REQUIRED_TOP_LEVEL_KEY_SET = new Set(REQUIRED_TOP_LEVEL_KEYS);
const REQUIRED_BUDGET_KEYS = [
  "max_attempts",
  "max_no_improve_streak",
  "max_wall_clock_ms",
  "max_kept_candidates",
];
const REQUIRED_BUDGET_KEY_SET = new Set(REQUIRED_BUDGET_KEYS);
const REQUIRED_RETENTION_POLICY_KEYS = [
  "keep_last_n_runs",
  "keep_last_n_kept_candidates",
  "delete_unkept_patches_after_days",
  "delete_sandboxes_after_hours",
  "retain_failed_sandboxes",
];
const REQUIRED_RETENTION_POLICY_KEY_SET = new Set(REQUIRED_RETENTION_POLICY_KEYS);

const DEFAULT_MUTABLE_PATHS = [
  "prompts/archivist_system.md",
  "prompts/realist_system.md",
  "prompts/router_system.md",
  "prompts/scout_system.md",
  "prompts/skeptic_system.md",
];

const DEFAULT_FIXED_PATHS = [
  ".agents/skills/theme-loop/SKILL.md",
  ".agents/skills/context-promotion/SKILL.md",
  "workflows/HARNESSED_THEME_WORKFLOW.md",
  "scripts/theme-harness.mjs",
  "scripts/theme-harness-lib.mjs",
  "scripts/theme-ops.mjs",
  "scripts/promote-durable-context.mjs",
  "docs/context/**",
  "app/**",
  "components/**",
  "lib/**",
  "data/**",
  "supabase/**",
  "package.json",
  "package-lock.json",
];

const DEFAULT_VERIFICATION_COMMANDS = [
  "npm.cmd run harness:test:noprofile",
  "npm.cmd run lint:noprofile",
  "npm.cmd run typecheck:noprofile",
  "npm.cmd run build:noprofile",
  "npm.cmd run guardrails:noprofile",
];

function ensureNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HarnessError(`${label} must be a non-empty string.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  return value.trim();
}

function ensureFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HarnessError(`${label} must be a finite number.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  return value;
}

function ensureInteger(value, label, { minimum = null } = {}) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HarnessError(`${label} must be an integer.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  if (minimum !== null && value < minimum) {
    throw new HarnessError(`${label} must be greater than or equal to ${minimum}.`, {
      status: "action_required",
      details: {
        field: label,
        minimum,
        value,
      },
    });
  }

  return value;
}

function ensureBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new HarnessError(`${label} must be a boolean.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  return value;
}

function ensureObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HarnessError(`${label} must be an object.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  return value;
}

function ensureExactObjectFields(value, label, requiredKeys, requiredKeySet) {
  const object = ensureObject(value, label);
  const missingKeys = requiredKeys.filter((key) => !Object.hasOwn(object, key));
  if (missingKeys.length) {
    throw new HarnessError(`${label} is missing required fields.`, {
      status: "action_required",
      details: {
        field: label,
        missing_keys: missingKeys,
      },
    });
  }

  const unknownKeys = Object.keys(object).filter((key) => !requiredKeySet.has(key));
  if (unknownKeys.length) {
    throw new HarnessError(`${label} includes unknown fields.`, {
      status: "action_required",
      details: {
        field: label,
        unknown_keys: unknownKeys,
      },
    });
  }

  return object;
}

function normalizeRepoRelativePath(value, label) {
  const normalized = ensureNonEmptyString(value, label).replaceAll("\\", "/");
  const collapsed = path.posix.normalize(normalized);

  if (!collapsed || collapsed === "." || collapsed.startsWith("../") || collapsed.startsWith("/")) {
    throw new HarnessError(`${label} must stay within the repository.`, {
      status: "action_required",
      details: {
        field: label,
        value,
      },
    });
  }

  return collapsed;
}

function ensureStringArray(values, label, { normalizePaths = false } = {}) {
  if (!Array.isArray(values)) {
    throw new HarnessError(`${label} must be an array.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  return values.map((value, index) => (
    normalizePaths
      ? normalizeRepoRelativePath(value, `${label}[${index}]`)
      : ensureNonEmptyString(value, `${label}[${index}]`)
  ));
}

function ensureMetric(value, label, { requireTargetValue = false } = {}) {
  const metric = ensureObject(value, label);
  const normalized = {
    metric_key: ensureNonEmptyString(metric.metric_key, `${label}.metric_key`),
    objective: ensureNonEmptyString(metric.objective, `${label}.objective`),
    improvement_threshold: ensureFiniteNumber(metric.improvement_threshold, `${label}.improvement_threshold`),
  };

  if (!["maximize", "minimize"].includes(normalized.objective)) {
    throw new HarnessError(`${label}.objective must be \`maximize\` or \`minimize\`.`, {
      status: "action_required",
      details: {
        field: `${label}.objective`,
        value: normalized.objective,
      },
    });
  }

  if (requireTargetValue || Object.hasOwn(metric, "target_value")) {
    normalized.target_value = ensureFiniteNumber(metric.target_value, `${label}.target_value`);
  }

  return normalized;
}

function ensureMetricArray(values, label) {
  if (!Array.isArray(values)) {
    throw new HarnessError(`${label} must be an array.`, {
      status: "action_required",
      details: { field: label },
    });
  }

  return values.map((value, index) => ensureMetric(value, `${label}[${index}]`));
}

function ensureQuestAgentExtension(value) {
  const extension = ensureObject(value, "extensions.quest-agent");
  const normalized = {
    execution_capability: ensureNonEmptyString(
      extension.execution_capability,
      "extensions.quest-agent.execution_capability",
    ),
    future_runtime_root: normalizeRepoRelativePath(
      extension.future_runtime_root,
      "extensions.quest-agent.future_runtime_root",
    ),
    verification_profile: ensureNonEmptyString(
      extension.verification_profile,
      "extensions.quest-agent.verification_profile",
    ),
  };

  if (normalized.execution_capability !== ADAPTER_EXECUTION_CAPABILITY) {
    throw new HarnessError(
      `extensions.quest-agent.execution_capability must be \`${ADAPTER_EXECUTION_CAPABILITY}\`.`,
      {
        status: "action_required",
        details: { field: "extensions.quest-agent.execution_capability" },
      },
    );
  }

  if (normalized.future_runtime_root !== FUTURE_RUNTIME_ROOT) {
    throw new HarnessError(`extensions.quest-agent.future_runtime_root must be \`${FUTURE_RUNTIME_ROOT}\`.`, {
      status: "action_required",
      details: { field: "extensions.quest-agent.future_runtime_root" },
    });
  }

  if (normalized.verification_profile !== VERIFICATION_PROFILE) {
    throw new HarnessError(`extensions.quest-agent.verification_profile must be \`${VERIFICATION_PROFILE}\`.`, {
      status: "action_required",
      details: { field: "extensions.quest-agent.verification_profile" },
    });
  }

  return normalized;
}

function ensureBudgets(value) {
  const budgets = ensureExactObjectFields(value, "budgets", REQUIRED_BUDGET_KEYS, REQUIRED_BUDGET_KEY_SET);

  return {
    max_attempts: ensureInteger(budgets.max_attempts, "budgets.max_attempts", { minimum: 1 }),
    max_no_improve_streak: ensureInteger(
      budgets.max_no_improve_streak,
      "budgets.max_no_improve_streak",
      { minimum: 0 },
    ),
    max_wall_clock_ms: ensureInteger(budgets.max_wall_clock_ms, "budgets.max_wall_clock_ms", { minimum: 1 }),
    max_kept_candidates: ensureInteger(
      budgets.max_kept_candidates,
      "budgets.max_kept_candidates",
      { minimum: 1 },
    ),
  };
}

function ensureRetentionPolicy(value) {
  const retentionPolicy = ensureExactObjectFields(
    value,
    "retention_policy",
    REQUIRED_RETENTION_POLICY_KEYS,
    REQUIRED_RETENTION_POLICY_KEY_SET,
  );

  return {
    keep_last_n_runs: ensureInteger(retentionPolicy.keep_last_n_runs, "retention_policy.keep_last_n_runs", {
      minimum: 0,
    }),
    keep_last_n_kept_candidates: ensureInteger(
      retentionPolicy.keep_last_n_kept_candidates,
      "retention_policy.keep_last_n_kept_candidates",
      { minimum: 0 },
    ),
    delete_unkept_patches_after_days: ensureInteger(
      retentionPolicy.delete_unkept_patches_after_days,
      "retention_policy.delete_unkept_patches_after_days",
      { minimum: 0 },
    ),
    delete_sandboxes_after_hours: ensureInteger(
      retentionPolicy.delete_sandboxes_after_hours,
      "retention_policy.delete_sandboxes_after_hours",
      { minimum: 0 },
    ),
    retain_failed_sandboxes: ensureBoolean(
      retentionPolicy.retain_failed_sandboxes,
      "retention_policy.retain_failed_sandboxes",
    ),
  };
}

function splitPattern(pattern) {
  return pattern.split("/").filter(Boolean);
}

function segmentPatternOverlap(left, right) {
  if (left === right || left === "*" || right === "*") {
    return true;
  }

  if (!left.includes("*") && !right.includes("*")) {
    return left === right;
  }

  if (!left.includes("*")) {
    return new RegExp(`^${right.split("*").map(escapeRegExp).join(".*")}$`, "u").test(left);
  }

  if (!right.includes("*")) {
    return new RegExp(`^${left.split("*").map(escapeRegExp).join(".*")}$`, "u").test(right);
  }

  const leftPrefix = left.split("*")[0];
  const rightPrefix = right.split("*")[0];
  const leftSuffix = left.split("*").at(-1);
  const rightSuffix = right.split("*").at(-1);

  return (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix))
    && (leftSuffix.endsWith(rightSuffix) || rightSuffix.endsWith(leftSuffix));
}

function patternsOverlap(leftPattern, rightPattern) {
  const left = splitPattern(leftPattern);
  const right = splitPattern(rightPattern);
  const memo = new Map();

  function visit(leftIndex, rightIndex) {
    const key = `${leftIndex}:${rightIndex}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    if (leftIndex === left.length && rightIndex === right.length) {
      memo.set(key, true);
      return true;
    }

    if (leftIndex === left.length) {
      const result = right.slice(rightIndex).every((segment) => segment === "**");
      memo.set(key, result);
      return result;
    }

    if (rightIndex === right.length) {
      const result = left.slice(leftIndex).every((segment) => segment === "**");
      memo.set(key, result);
      return result;
    }

    const leftSegment = left[leftIndex];
    const rightSegment = right[rightIndex];

    let result = false;
    if (leftSegment === "**" && rightSegment === "**") {
      result = visit(leftIndex + 1, rightIndex)
        || visit(leftIndex, rightIndex + 1)
        || visit(leftIndex + 1, rightIndex + 1);
    } else if (leftSegment === "**") {
      result = visit(leftIndex + 1, rightIndex) || visit(leftIndex, rightIndex + 1);
    } else if (rightSegment === "**") {
      result = visit(leftIndex, rightIndex + 1) || visit(leftIndex + 1, rightIndex);
    } else if (segmentPatternOverlap(leftSegment, rightSegment)) {
      result = visit(leftIndex + 1, rightIndex + 1);
    }

    memo.set(key, result);
    return result;
  }

  return visit(0, 0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findPathOverlaps(mutablePaths, fixedPaths) {
  const overlaps = [];

  for (const mutablePath of mutablePaths) {
    for (const fixedPath of fixedPaths) {
      if (patternsOverlap(mutablePath, fixedPath)) {
        overlaps.push({ mutable_path: mutablePath, fixed_path: fixedPath });
      }
    }
  }

  return overlaps;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortKeysDeep(value[key])]),
    );
  }

  return value;
}

function ensureTrackedPackPath(repoRoot, packPath) {
  const trackedRoot = normalizePath(path.join(repoRoot, BENCHMARK_PACKS_DIR));
  const relative = path.relative(trackedRoot, packPath);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HarnessError(`Benchmark packs must stay under \`${BENCHMARK_PACKS_DIR}\`.`, {
      status: "action_required",
      details: {
        pack_path: packPath,
        tracked_root: trackedRoot,
      },
    });
  }
}

function relativePackPath(repoRoot, packPath) {
  return normalizeRepoRelativePath(path.relative(repoRoot, packPath), "pack_path");
}

function defaultBenchmarkPack({ repoRoot, packId, packPath }) {
  const trackedPackPath = relativePackPath(repoRoot, packPath);

  return {
    contract_version: "1",
    benchmark_id: packId,
    description: "Adapter-only benchmark shell for prompt-only Quest Agent theme-harness mutations.",
    target_surface: "quest-agent-theme-harness-prompts",
    mutable_paths: [...DEFAULT_MUTABLE_PATHS],
    fixed_paths: [...DEFAULT_FIXED_PATHS],
    run_command: `node scripts/theme-harness.mjs benchmark-run --pack ${trackedPackPath}`,
    verification_commands: [...DEFAULT_VERIFICATION_COMMANDS],
    primary_score: {
      metric_key: "benchmark_score",
      objective: "maximize",
      improvement_threshold: 0.05,
      target_value: 0.7,
    },
    secondary_metrics: [
      {
        metric_key: "latency_ms",
        objective: "minimize",
        improvement_threshold: 1.0,
      },
    ],
    budgets: {
      max_attempts: 3,
      max_no_improve_streak: 2,
      max_wall_clock_ms: 30000,
      max_kept_candidates: 1,
    },
    keep_policy: {
      allow_equal_primary_with_secondary_improvement: true,
    },
    retention_policy: {
      keep_last_n_runs: 3,
      keep_last_n_kept_candidates: 2,
      delete_unkept_patches_after_days: 7,
      delete_sandboxes_after_hours: 24,
      retain_failed_sandboxes: true,
    },
    extensions: {
      "quest-agent": {
        execution_capability: ADAPTER_EXECUTION_CAPABILITY,
        future_runtime_root: FUTURE_RUNTIME_ROOT,
        verification_profile: VERIFICATION_PROFILE,
      },
    },
  };
}

export function resolveBenchmarkPackPath(repoRoot, { packId = "", outPath = "" } = {}) {
  const normalizedPackId = ensureNonEmptyString(packId, "pack_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalizedPackId)) {
    throw new HarnessError("pack_id must use only letters, numbers, dots, underscores, or hyphens.", {
      status: "action_required",
      details: { pack_id: normalizedPackId },
    });
  }

  const trackedRoot = normalizePath(path.join(repoRoot, BENCHMARK_PACKS_DIR));
  const target = outPath
    ? normalizePath(path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath))
    : normalizePath(path.join(trackedRoot, `${normalizedPackId}.json`));

  ensureTrackedPackPath(repoRoot, target);
  if (path.extname(target).toLowerCase() !== ".json") {
    throw new HarnessError("Benchmark pack output must use a `.json` file path.", {
      status: "action_required",
      details: { pack_path: target },
    });
  }

  return target;
}

export function validateBenchmarkPack(value) {
  const pack = ensureObject(value, "pack");
  const missingKeys = REQUIRED_TOP_LEVEL_KEYS.filter((key) => !Object.hasOwn(pack, key));
  if (missingKeys.length) {
    throw new HarnessError("Benchmark pack is missing required top-level fields.", {
      status: "action_required",
      details: { missing_top_level_keys: missingKeys },
    });
  }

  const unknownKeys = Object.keys(pack).filter((key) => !REQUIRED_TOP_LEVEL_KEY_SET.has(key));
  if (unknownKeys.length) {
    throw new HarnessError("Benchmark pack includes unknown top-level fields.", {
      status: "action_required",
      details: { unknown_top_level_keys: unknownKeys },
    });
  }

  const normalized = {
    contract_version: ensureNonEmptyString(pack.contract_version, "contract_version"),
    benchmark_id: ensureNonEmptyString(pack.benchmark_id, "benchmark_id"),
    description: ensureNonEmptyString(pack.description, "description"),
    target_surface: ensureNonEmptyString(pack.target_surface, "target_surface"),
    mutable_paths: ensureStringArray(pack.mutable_paths, "mutable_paths", { normalizePaths: true }),
    fixed_paths: ensureStringArray(pack.fixed_paths, "fixed_paths", { normalizePaths: true }),
    run_command: ensureNonEmptyString(pack.run_command, "run_command"),
    verification_commands: ensureStringArray(pack.verification_commands, "verification_commands"),
    primary_score: ensureMetric(pack.primary_score, "primary_score"),
    secondary_metrics: ensureMetricArray(pack.secondary_metrics, "secondary_metrics"),
    budgets: ensureBudgets(pack.budgets),
    keep_policy: ensureObject(pack.keep_policy, "keep_policy"),
    retention_policy: ensureRetentionPolicy(pack.retention_policy),
    extensions: ensureObject(pack.extensions, "extensions"),
  };

  if (normalized.contract_version !== "1") {
    throw new HarnessError("contract_version must be `1`.", {
      status: "action_required",
      details: { contract_version: normalized.contract_version },
    });
  }

  normalized.keep_policy.allow_equal_primary_with_secondary_improvement = ensureBoolean(
    normalized.keep_policy.allow_equal_primary_with_secondary_improvement,
    "keep_policy.allow_equal_primary_with_secondary_improvement",
  );
  normalized.extensions = {
    ...normalized.extensions,
    "quest-agent": ensureQuestAgentExtension(normalized.extensions["quest-agent"]),
  };

  const overlaps = findPathOverlaps(normalized.mutable_paths, normalized.fixed_paths);
  if (overlaps.length) {
    throw new HarnessError("mutable_paths and fixed_paths must not overlap.", {
      status: "action_required",
      details: { overlaps },
    });
  }

  return normalized;
}

export function canonicalizeBenchmarkPack(value) {
  return JSON.stringify(sortKeysDeep(value));
}

export function benchmarkPackHash(value) {
  return hashContent(canonicalizeBenchmarkPack(value));
}

export function loadValidatedBenchmarkPack(packPath) {
  const targetPackPath = normalizePath(packPath);
  if (!existsSync(targetPackPath)) {
    throw new HarnessError("Benchmark pack not found.", {
      status: "action_required",
      details: { pack_path: targetPackPath },
    });
  }

  let parsed;
  try {
    parsed = readJson(targetPackPath);
  } catch (error) {
    throw new HarnessError("Benchmark pack must be valid JSON.", {
      status: "action_required",
      details: {
        pack_path: targetPackPath,
        parse_error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const normalizedPack = validateBenchmarkPack(parsed);
  return {
    packPath: targetPackPath,
    normalizedPack,
    packHash: benchmarkPackHash(normalizedPack),
  };
}

export function scaffoldBenchmarkPack({
  repoRoot,
  packId = "",
  outPath = "",
  force = false,
} = {}) {
  const normalizedPackId = ensureNonEmptyString(packId, "pack_id");
  const packPath = resolveBenchmarkPackPath(repoRoot, { packId: normalizedPackId, outPath });
  const existed = existsSync(packPath);

  if (existed && !force) {
    throw new HarnessError("Benchmark pack already exists. Use `--force` to overwrite it.", {
      status: "action_required",
      details: { pack_path: packPath },
    });
  }

  ensureDir(path.dirname(packPath));
  const normalizedPack = validateBenchmarkPack(defaultBenchmarkPack({ repoRoot, packId: normalizedPackId, packPath }));
  writeJson(packPath, normalizedPack);

  return actionPayload({
    status: "pass",
    message: existed ? "Benchmark pack overwritten." : "Benchmark pack scaffolded.",
    details: {
      benchmark_id: normalizedPack.benchmark_id,
      pack_path: packPath,
      pack_hash: benchmarkPackHash(normalizedPack),
      created: !existed,
      overwritten: existed,
    },
  });
}

export function validateBenchmarkPackCommand({ packPath } = {}) {
  const targetPackPath = ensureNonEmptyString(packPath, "pack_path");
  const { packPath: resolvedPackPath, normalizedPack, packHash } = loadValidatedBenchmarkPack(targetPackPath);

  return actionPayload({
    status: "pass",
    message: "Benchmark pack validated.",
    details: {
      benchmark_id: normalizedPack.benchmark_id,
      pack_path: resolvedPackPath,
      pack_hash: packHash,
      normalized_pack: normalizedPack,
    },
  });
}

export function benchmarkRunStub({ packPath } = {}) {
  const targetPackPath = ensureNonEmptyString(packPath, "pack_path");
  const { packPath: resolvedPackPath, normalizedPack, packHash } = loadValidatedBenchmarkPack(targetPackPath);

  throw new HarnessError(
    "Quest Agent exposes only an adapter shell for benchmarks; runnable execution is not available in this repo.",
    {
      status: "action_required",
      details: {
        execution_capability: ADAPTER_EXECUTION_CAPABILITY,
        benchmark_id: normalizedPack.benchmark_id,
        pack_path: resolvedPackPath,
        pack_hash: packHash,
        next_action: "Treat this pack as tracked adapter metadata only. Runnable mutation lanes remain out of scope for this delivery.",
      },
    },
  );
}
