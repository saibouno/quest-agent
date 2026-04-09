import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  HarnessError,
  actionPayload,
  assertRootOwnedCwd,
  getRepoRootFromImport,
  loadState,
  nowIso,
  outputDir,
  printJson,
  readJson,
  saveState,
  writeJson,
} from "./theme-harness-lib.mjs";
import {
  PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE,
  PORTFOLIO_EXECUTION_LANES,
  PORTFOLIO_ID,
  PORTFOLIO_SHARED_CONTRACT_REF,
  PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS,
  PORTFOLIO_VERSION,
  analyzePortfolioCoordinationEnvelope,
  buildPairwisePortfolioRelations,
  buildPortfolioSummary,
  computePortfolioEnvelopeFingerprint,
  ensurePortfolioCoordinationShape,
  invalidatePortfolioSummary,
  laneForPortfolioStatus,
  portfolioArtifactPath,
  portfolioEligibility,
  portfolioRelationPriority,
} from "./theme-portfolio-contract.mjs";

const REPO_ROOT = getRepoRootFromImport(import.meta.url);

function isRawToken(value) {
  return !/^[a-z][a-z0-9_-]*:/u.test(String(value || "").trim().toLowerCase());
}

function themeStateSlugs(repoRoot) {
  const root = outputDir(repoRoot);
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.basename(entry.name, ".json"))
    .sort();
}

function summarizePlanRelations(plan, relations, generatedAt, artifactPath) {
  const ordered = [...relations].sort((left, right) => {
    const priorityDelta = portfolioRelationPriority(right.relation_type) - portfolioRelationPriority(left.relation_type);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.relation_key.localeCompare(right.relation_key);
  });

  const highestPriority = ordered.length
    ? portfolioRelationPriority(ordered[0].relation_type)
    : portfolioRelationPriority(PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE);
  const triggering = ordered.length
    ? ordered.filter((entry) => portfolioRelationPriority(entry.relation_type) === highestPriority)
    : [];
  const coordinationStatus = triggering[0]?.relation_type || PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE;
  const statusReason = triggering[0]?.status_reason || PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS;
  const primaryRelationKey = triggering[0]?.relation_key || "";
  const triggeringRelationKeys = triggering.map((entry) => entry.relation_key);
  const relatedPlanRefs = [...new Set(triggering.flatMap((entry) => entry.plan_refs.filter((ref) => ref !== plan.envelope.plan_ref)))].sort();

  return buildPortfolioSummary({
    envelopeFingerprint: plan.envelope_fingerprint,
    coordinationStatus,
    statusReason,
    primaryRelationKey,
    triggeringRelationKeys,
    relatedPlanRefs,
    portfolioId: PORTFOLIO_ID,
    portfolioVersion: PORTFOLIO_VERSION,
    lastRefreshedAt: generatedAt,
    sharedContractRef: PORTFOLIO_SHARED_CONTRACT_REF,
    advisoryNotes: plan.advisory_notes,
    artifactPath,
    artifactPresent: true,
    eligible: true,
  });
}

export function refreshPortfolio({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-portfolio-orchestrator.mjs refresh");

  const generatedAt = nowIso();
  const artifactPath = portfolioArtifactPath(repoRoot);
  const diagnostics = {
    refreshed_at: generatedAt,
    evaluated_theme_count: 0,
    registered_plan_count: 0,
    relation_count: 0,
    skipped_themes: [],
    duplicate_plan_ids: [],
    advisory_notes: [],
  };

  const candidatePlans = [];
  const skippedStates = [];
  const states = themeStateSlugs(repoRoot).map((slug) => loadState(repoRoot, slug));

  for (const state of states) {
    diagnostics.evaluated_theme_count += 1;
    const coordination = ensurePortfolioCoordinationShape(state.portfolio_coordination);
    if (!coordination.envelope) {
      continue;
    }

    const analysis = analyzePortfolioCoordinationEnvelope(coordination.envelope);
    const envelopeFingerprint = analysis.envelope
      ? computePortfolioEnvelopeFingerprint(analysis.envelope)
      : "";

    if (!analysis.envelope) {
      diagnostics.skipped_themes.push({
        slug: state.slug,
        reason: "invalid_envelope",
      });
      state.portfolio_coordination.summary = invalidatePortfolioSummary(
        state.portfolio_coordination.summary,
        {
          envelopeFingerprint,
          portfolioId: PORTFOLIO_ID,
          portfolioVersion: PORTFOLIO_VERSION,
          lastRefreshedAt: generatedAt,
        },
      );
      skippedStates.push(state);
      continue;
    }

    const eligibleState = {
      ...state,
      portfolio_coordination: {
        envelope: analysis.envelope,
        summary: coordination.summary,
      },
    };
    if (!portfolioEligibility(eligibleState)) {
      diagnostics.skipped_themes.push({
        slug: state.slug,
        reason: "terminal_or_ineligible",
      });
      state.portfolio_coordination.envelope = analysis.envelope;
      state.portfolio_coordination.summary = invalidatePortfolioSummary(
        state.portfolio_coordination.summary,
        {
          envelopeFingerprint,
          portfolioId: PORTFOLIO_ID,
          portfolioVersion: PORTFOLIO_VERSION,
          lastRefreshedAt: generatedAt,
        },
      );
      skippedStates.push(state);
      continue;
    }

    candidatePlans.push({
      state,
      envelope: analysis.envelope,
      envelope_fingerprint: envelopeFingerprint,
      advisory_notes: [...analysis.advisory_notes],
      raw_prerequisites: (coordination.envelope?.prerequisites || []).filter((token) => isRawToken(token)),
    });
  }

  candidatePlans.sort((left, right) => left.envelope.plan_id.localeCompare(right.envelope.plan_id) || left.state.slug.localeCompare(right.state.slug));
  const seenPlanIds = new Set();
  const registeredPlans = [];
  for (const plan of candidatePlans) {
    if (seenPlanIds.has(plan.envelope.plan_id)) {
      diagnostics.duplicate_plan_ids.push(plan.envelope.plan_id);
      diagnostics.skipped_themes.push({
        slug: plan.state.slug,
        reason: "duplicate_plan_id",
      });
      plan.state.portfolio_coordination.summary = invalidatePortfolioSummary(
        plan.state.portfolio_coordination.summary,
        {
          envelopeFingerprint: plan.envelope_fingerprint,
          portfolioId: PORTFOLIO_ID,
          portfolioVersion: PORTFOLIO_VERSION,
          lastRefreshedAt: generatedAt,
        },
      );
      skippedStates.push(plan.state);
      continue;
    }
    seenPlanIds.add(plan.envelope.plan_id);
    registeredPlans.push(plan);
  }

  const relations = [];
  const planRelations = new Map(registeredPlans.map((plan) => [plan.envelope.plan_id, []]));

  for (let index = 0; index < registeredPlans.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < registeredPlans.length; compareIndex += 1) {
      const left = registeredPlans[index];
      const right = registeredPlans[compareIndex];
      const sharedRawPrerequisites = [...new Set(left.raw_prerequisites.filter((token) => right.raw_prerequisites.includes(token)))].sort();
      for (const rawPrerequisite of sharedRawPrerequisites) {
        const note = `Shared raw prerequisite token \`${rawPrerequisite}\` stayed advisory-only; no automatic relation was assigned.`;
        left.advisory_notes.push(note);
        right.advisory_notes.push(note);
        diagnostics.advisory_notes.push(`${left.state.slug}<->${right.state.slug}: ${note}`);
      }

      const pairRelations = buildPairwisePortfolioRelations(left, right);
      relations.push(...pairRelations);
      for (const relation of pairRelations) {
        planRelations.get(left.envelope.plan_id)?.push(relation);
        planRelations.get(right.envelope.plan_id)?.push(relation);
      }
    }
  }

  diagnostics.registered_plan_count = registeredPlans.length;
  diagnostics.relation_count = relations.length;
  diagnostics.duplicate_plan_ids = [...new Set(diagnostics.duplicate_plan_ids)].sort();
  diagnostics.advisory_notes = [...new Set(diagnostics.advisory_notes)].sort();

  const registeredPlanArtifacts = [];
  for (const plan of registeredPlans) {
    plan.advisory_notes = [...new Set(plan.advisory_notes)].sort();
    const summary = summarizePlanRelations(
      plan,
      planRelations.get(plan.envelope.plan_id) || [],
      generatedAt,
      artifactPath,
    );

    plan.state.portfolio_coordination.envelope = plan.envelope;
    plan.state.portfolio_coordination.summary = summary;
    saveState(repoRoot, plan.state);

    registeredPlanArtifacts.push({
      slug: plan.state.slug,
      plan_id: plan.envelope.plan_id,
      plan_ref: plan.envelope.plan_ref,
      plan_version: plan.envelope.plan_version,
      parent_goal: plan.envelope.parent_goal,
      affected_surfaces: plan.envelope.affected_surfaces,
      surface_confidence: plan.envelope.surface_confidence,
      expected_artifacts: plan.envelope.expected_artifacts,
      prerequisites: plan.envelope.prerequisites,
      required_resources: plan.envelope.required_resources,
      envelope_fingerprint: plan.envelope_fingerprint,
      coordination_status: summary.coordination_status,
      status_reason: summary.status_reason,
      primary_relation_key: summary.primary_relation_key,
      triggering_relation_keys: summary.triggering_relation_keys,
      related_plan_refs: summary.related_plan_refs,
      advisory_notes: summary.advisory_notes,
    });
  }

  for (const skippedState of skippedStates) {
    saveState(repoRoot, skippedState);
  }

  const laneBuckets = new Map(PORTFOLIO_EXECUTION_LANES.map((lane) => [lane, { lane, plan_ids: [], plan_refs: [] }]));
  for (const plan of registeredPlanArtifacts.sort((left, right) => left.plan_id.localeCompare(right.plan_id))) {
    const lane = laneForPortfolioStatus(plan.coordination_status);
    laneBuckets.get(lane)?.plan_ids.push(plan.plan_id);
    laneBuckets.get(lane)?.plan_refs.push(plan.plan_ref);
  }

  const artifact = {
    schema_version: 1,
    artifact_type: "portfolio_coordination_plan",
    portfolio_id: PORTFOLIO_ID,
    portfolio_version: PORTFOLIO_VERSION,
    generated_at: generatedAt,
    shared_contract_ref: PORTFOLIO_SHARED_CONTRACT_REF,
    registered_plans: registeredPlanArtifacts,
    relations: relations.sort((left, right) => left.relation_key.localeCompare(right.relation_key)),
    global_execution_lanes: PORTFOLIO_EXECUTION_LANES.map((lane) => laneBuckets.get(lane)),
    extensions: {
      "quest-agent": {
        refresh_diagnostics: diagnostics,
      },
    },
  };

  writeJson(artifactPath, artifact);

  return actionPayload({
    status: "pass",
    message: "Portfolio coordination artifact refreshed.",
    details: {
      artifact_path: artifactPath,
      portfolio_id: PORTFOLIO_ID,
      portfolio_version: PORTFOLIO_VERSION,
      refreshed_at: generatedAt,
      registered_plan_count: registeredPlanArtifacts.length,
      relation_count: relations.length,
      global_execution_lanes: artifact.global_execution_lanes,
      refresh_diagnostics: diagnostics,
    },
  });
}

export function statusPortfolio({
  repoRoot = REPO_ROOT,
} = {}) {
  const artifactPath = portfolioArtifactPath(repoRoot);
  if (!existsSync(artifactPath)) {
    return actionPayload({
      status: "pass",
      message: "No portfolio coordination artifact has been generated yet.",
      details: {
        artifact_exists: false,
        artifact_path: artifactPath,
        portfolio_id: PORTFOLIO_ID,
        portfolio_version: PORTFOLIO_VERSION,
        refresh_diagnostics: null,
      },
    });
  }

  const artifact = readJson(artifactPath);
  return actionPayload({
    status: "pass",
    message: "Portfolio coordination artifact loaded.",
    details: {
      artifact_exists: true,
      artifact_path: artifactPath,
      portfolio_id: artifact.portfolio_id,
      portfolio_version: artifact.portfolio_version,
      generated_at: artifact.generated_at,
      registered_plan_count: Array.isArray(artifact.registered_plans) ? artifact.registered_plans.length : 0,
      relation_count: Array.isArray(artifact.relations) ? artifact.relations.length : 0,
      global_execution_lanes: Array.isArray(artifact.global_execution_lanes) ? artifact.global_execution_lanes : [],
      refresh_diagnostics: artifact.extensions?.["quest-agent"]?.refresh_diagnostics || null,
    },
  });
}

function parseCommandLine() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "refresh":
      parseArgs({ args: rest, options: {} });
      return { command, values: {} };
    case "status":
      parseArgs({ args: rest, options: {} });
      return { command, values: {} };
    default:
      throw new HarnessError("Unknown theme-portfolio-orchestrator command.", {
        status: "action_required",
        details: {
          command: command || "",
        },
      });
  }
}

export async function main() {
  const { command, values } = parseCommandLine();
  const payload = command === "refresh"
    ? refreshPortfolio(values)
    : statusPortfolio(values);
  printJson(payload);
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    if (error instanceof HarnessError) {
      printJson(actionPayload({ status: error.status, message: error.message, details: error.details }));
      process.exitCode = error.status === "error" ? 1 : 1;
      return;
    }

    printJson(actionPayload({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}
