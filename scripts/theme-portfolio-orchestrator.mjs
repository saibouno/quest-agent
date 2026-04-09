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
  PORTFOLIO_EXECUTION_LANE_FOUNDATION_FIRST,
  PORTFOLIO_EXECUTION_LANE_MERGE_REVIEW,
  PORTFOLIO_EXECUTION_LANE_REVIEW_HOLD,
  PORTFOLIO_EXECUTION_LANES,
  PORTFOLIO_PLAN_VERSION,
  PORTFOLIO_SHARED_CONTRACT_REF,
  PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS,
  analyzePortfolioCoordinationEnvelope,
  buildPairwisePortfolioRelations,
  buildPortfolioPlanId,
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

const LANE_ORDER = new Map(PORTFOLIO_EXECUTION_LANES.map((lane, index) => [lane, index]));

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

function planSort(left, right) {
  return left.envelope.plan_id.localeCompare(right.envelope.plan_id)
    || left.envelope.plan_ref.localeCompare(right.envelope.plan_ref)
    || left.state.slug.localeCompare(right.state.slug);
}

function registeredPlanArtifactSort(left, right) {
  return left.plan_id.localeCompare(right.plan_id)
    || left.plan_ref.localeCompare(right.plan_ref);
}

function relationSort(left, right) {
  return left.relation_key.localeCompare(right.relation_key);
}

function laneMemberSort(left, right) {
  return left.plan.envelope.plan_id.localeCompare(right.plan.envelope.plan_id)
    || left.plan.envelope.plan_ref.localeCompare(right.plan.envelope.plan_ref);
}

function laneSort(left, right) {
  const laneTypeDelta = (LANE_ORDER.get(left.lane_type) ?? Number.MAX_SAFE_INTEGER)
    - (LANE_ORDER.get(right.lane_type) ?? Number.MAX_SAFE_INTEGER);
  if (laneTypeDelta !== 0) {
    return laneTypeDelta;
  }

  const leftKey = left.plan_refs.join("|");
  const rightKey = right.plan_refs.join("|");
  return leftKey.localeCompare(rightKey) || left.lane_id.localeCompare(right.lane_id);
}

function summarizePlanRelations(plan, relations, generatedAt, artifactPath, portfolioPlanId, planIdByRef) {
  const orderedRelations = [...relations].sort((left, right) => {
    const priorityDelta = portfolioRelationPriority(right.primary_relation_type)
      - portfolioRelationPriority(left.primary_relation_type);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.relation_key.localeCompare(right.relation_key);
  });

  const primaryRelation = orderedRelations[0] || null;
  const coordinationStatus = primaryRelation?.primary_relation_type || PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE;
  const statusReason = primaryRelation?.reason || PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS;
  const relatedPlanRefs = [...new Set(
    orderedRelations.flatMap((entry) => entry.plan_refs.filter((ref) => ref !== plan.envelope.plan_ref)),
  )].sort((left, right) => {
    const leftPlanId = planIdByRef.get(left) || "";
    const rightPlanId = planIdByRef.get(right) || "";
    return leftPlanId.localeCompare(rightPlanId) || left.localeCompare(right);
  });
  const triggeringRelationKeys = orderedRelations.map((entry) => entry.relation_key);

  return buildPortfolioSummary({
    envelopeFingerprint: plan.envelope_fingerprint,
    coordinationStatus,
    statusReason,
    primaryRelationKey: primaryRelation?.relation_key || "",
    triggeringRelationKeys,
    relatedPlanRefs,
    portfolioPlanId,
    portfolioPlanVersion: PORTFOLIO_PLAN_VERSION,
    lastRefreshedAt: generatedAt,
    sharedContractRef: PORTFOLIO_SHARED_CONTRACT_REF,
    advisoryNotes: [],
    artifactPath,
    artifactPresent: true,
    eligible: true,
  });
}

function laneReason(laneType) {
  if (laneType === PORTFOLIO_EXECUTION_LANE_REVIEW_HOLD) {
    return "These plans share the same primary conflict relation and should be reviewed together before implementation proceeds.";
  }
  if (laneType === PORTFOLIO_EXECUTION_LANE_MERGE_REVIEW) {
    return "These plans share the same primary merge-candidate relation and should be reviewed together for a smaller combined cut.";
  }
  if (laneType === PORTFOLIO_EXECUTION_LANE_FOUNDATION_FIRST) {
    return "These plans share the same primary foundation relation and should be reviewed together before dependent execution proceeds.";
  }
  return "No higher-priority shared relation applies, so this plan stays in an execution lane.";
}

function laneIdFor(laneType, members) {
  const memberKey = members.map((entry) => entry.plan.envelope.plan_id).join("--");
  return `lane-${laneType.replace(/_/g, "-")}-${memberKey}`;
}

function buildLane(members, planSummariesById, relationsByKey) {
  const orderedMembers = [...members].sort(laneMemberSort);
  const summary = planSummariesById.get(orderedMembers[0].plan.envelope.plan_id);
  const laneType = laneForPortfolioStatus(summary.coordination_status);
  const derivedRelationKeys = summary.coordination_status === PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE
    ? []
    : [summary.primary_relation_key];
  const relationConfidences = derivedRelationKeys
    .map((key) => relationsByKey.get(key)?.confidence)
    .filter((value) => typeof value === "number");
  const confidence = Math.min(
    ...orderedMembers.map((entry) => entry.plan.envelope.surface_confidence),
    ...(relationConfidences.length ? relationConfidences : [1]),
  );

  return {
    lane_id: laneIdFor(laneType, orderedMembers),
    lane_type: laneType,
    plan_refs: orderedMembers.map((entry) => entry.plan.envelope.plan_ref),
    reason: laneReason(laneType),
    confidence,
    derived_from_relation_keys: derivedRelationKeys,
    created_from_envelope_refs: orderedMembers.map((entry) => entry.plan.envelope.plan_ref),
  };
}

function buildGlobalExecutionLanes(registeredPlans, planSummariesById, relationsByKey) {
  const unassigned = new Set(registeredPlans.map((entry) => entry.envelope.plan_id));
  const sortedPlans = [...registeredPlans].sort((left, right) => {
    const leftSummary = planSummariesById.get(left.envelope.plan_id);
    const rightSummary = planSummariesById.get(right.envelope.plan_id);
    const priorityDelta = portfolioRelationPriority(rightSummary?.coordination_status)
      - portfolioRelationPriority(leftSummary?.coordination_status);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const confidenceDelta = left.envelope.surface_confidence - right.envelope.surface_confidence;
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return left.envelope.plan_ref.localeCompare(right.envelope.plan_ref);
  });

  const lanes = [];
  for (const plan of sortedPlans) {
    if (!unassigned.has(plan.envelope.plan_id)) {
      continue;
    }

    const summary = planSummariesById.get(plan.envelope.plan_id);
    let members;
    if (summary?.coordination_status === PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE) {
      members = [{ plan }];
    } else {
      members = sortedPlans
        .filter((entry) => unassigned.has(entry.envelope.plan_id))
        .filter((entry) => planSummariesById.get(entry.envelope.plan_id)?.primary_relation_key === summary.primary_relation_key)
        .map((entry) => ({ plan: entry }));
    }

    for (const member of members) {
      unassigned.delete(member.plan.envelope.plan_id);
    }
    lanes.push(buildLane(members, planSummariesById, relationsByKey));
  }

  return lanes.sort(laneSort);
}

export function refreshPortfolio({
  repoRoot = REPO_ROOT,
  cwd = process.cwd(),
} = {}) {
  assertRootOwnedCwd(repoRoot, cwd, "node scripts/theme-portfolio-orchestrator.mjs refresh");

  const generatedAt = nowIso();
  const portfolioPlanId = buildPortfolioPlanId(generatedAt);
  const artifactPath = portfolioArtifactPath(repoRoot);
  const diagnostics = {
    refreshed_at: generatedAt,
    evaluated_theme_count: 0,
    registered_plan_count: 0,
    relation_count: 0,
    skipped_themes: [],
    duplicate_plan_ids: [],
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
          portfolioPlanId,
          portfolioPlanVersion: PORTFOLIO_PLAN_VERSION,
          lastRefreshedAt: generatedAt,
          sharedContractRef: PORTFOLIO_SHARED_CONTRACT_REF,
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
          portfolioPlanId,
          portfolioPlanVersion: PORTFOLIO_PLAN_VERSION,
          lastRefreshedAt: generatedAt,
          sharedContractRef: PORTFOLIO_SHARED_CONTRACT_REF,
        },
      );
      skippedStates.push(state);
      continue;
    }

    candidatePlans.push({
      state,
      envelope: analysis.envelope,
      envelope_fingerprint: envelopeFingerprint,
    });
  }

  candidatePlans.sort(planSort);
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
          portfolioPlanId,
          portfolioPlanVersion: PORTFOLIO_PLAN_VERSION,
          lastRefreshedAt: generatedAt,
          sharedContractRef: PORTFOLIO_SHARED_CONTRACT_REF,
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
      const pairRelations = buildPairwisePortfolioRelations(registeredPlans[index], registeredPlans[compareIndex]);
      relations.push(...pairRelations);
      for (const relation of pairRelations) {
        const planIds = relation.plan_refs.map((planRef) => registeredPlans.find((entry) => entry.envelope.plan_ref === planRef)?.envelope.plan_id)
          .filter(Boolean);
        for (const planId of planIds) {
          planRelations.get(planId)?.push(relation);
        }
      }
    }
  }

  const relationsByKey = new Map(relations.map((relation) => [relation.relation_key, relation]));
  const planIdByRef = new Map(registeredPlans.map((plan) => [plan.envelope.plan_ref, plan.envelope.plan_id]));
  const planSummariesById = new Map();
  const registeredPlanArtifacts = [];

  for (const plan of registeredPlans) {
    const summary = summarizePlanRelations(
      plan,
      planRelations.get(plan.envelope.plan_id) || [],
      generatedAt,
      artifactPath,
      portfolioPlanId,
      planIdByRef,
    );

    plan.state.portfolio_coordination.envelope = plan.envelope;
    plan.state.portfolio_coordination.summary = summary;
    saveState(repoRoot, plan.state);

    planSummariesById.set(plan.envelope.plan_id, summary);

    const registeredPlanArtifact = {
      plan_ref: plan.envelope.plan_ref,
      plan_id: plan.envelope.plan_id,
      plan_version: plan.envelope.plan_version,
      surface_confidence: plan.envelope.surface_confidence,
      coordination_status: summary.coordination_status,
      status_reason: summary.status_reason,
      related_plan_refs: summary.related_plan_refs,
      triggering_relation_keys: summary.triggering_relation_keys,
    };
    if (summary.primary_relation_key) {
      registeredPlanArtifact.primary_relation_key = summary.primary_relation_key;
    }
    registeredPlanArtifacts.push(registeredPlanArtifact);
  }

  for (const skippedState of skippedStates) {
    saveState(repoRoot, skippedState);
  }

  registeredPlanArtifacts.sort(registeredPlanArtifactSort);
  const globalExecutionLanes = buildGlobalExecutionLanes(registeredPlans, planSummariesById, relationsByKey);

  diagnostics.registered_plan_count = registeredPlanArtifacts.length;
  diagnostics.relation_count = relations.length;
  diagnostics.duplicate_plan_ids = [...new Set(diagnostics.duplicate_plan_ids)].sort();

  const artifact = {
    portfolio_plan_id: portfolioPlanId,
    portfolio_plan_version: PORTFOLIO_PLAN_VERSION,
    generated_at: generatedAt,
    registered_plans: registeredPlanArtifacts,
    relations: [...relations].sort(relationSort),
    global_execution_lanes: globalExecutionLanes,
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
      portfolio_plan_id: portfolioPlanId,
      portfolio_plan_version: PORTFOLIO_PLAN_VERSION,
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
        portfolio_plan_id: "",
        portfolio_plan_version: PORTFOLIO_PLAN_VERSION,
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
      portfolio_plan_id: artifact.portfolio_plan_id || "",
      portfolio_plan_version: artifact.portfolio_plan_version || PORTFOLIO_PLAN_VERSION,
      generated_at: artifact.generated_at || "",
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
      process.exitCode = 1;
      return;
    }

    printJson(actionPayload({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
}
