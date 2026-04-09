import { parseMarkdownSections } from "./theme-harness-lib.mjs";
import { PORTFOLIO_COORDINATION_SECTION, extractPortfolioEnvelopeJson } from "./theme-portfolio-contract.mjs";

export const WORKFLOW_STATE_BRIDGE_SHARED_CONTRACT_REF = "quest-agent:workflow-state-bridge/v1";

const CONSUMER_MODE = "read_only";
const CONSUMER_SCOPE = "current_plan_only";
const HUMAN_STATUS_REASONS = {
  blocked: "workflow_blocked",
  approved: "workflow_approved",
  rejected: "workflow_rejected",
};
const CONTINUE_REASON_BY_STATUS = {
  plan_drafted: "review_or_revision_completion_required",
  plan_reviewed: "implementation_start_required",
  implementing: "implementation_in_progress",
  verified: "aftercare_explain_scaffold_closeout_required",
};

function normalizeString(value) {
  return String(value || "").trim();
}

function uniqueEntries(values) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function stateSourceRef(field) {
  return `state:${field}`;
}

function helperSourceRef(name) {
  return `helper:${name}`;
}

function artifactSourceRef(targetPath, fragment = "") {
  const normalizedPath = normalizeString(targetPath);
  if (!normalizedPath) {
    return "";
  }

  return `artifact:${normalizedPath}${fragment ? `#${fragment}` : ""}`;
}

function normalizeArtifact(artifact = {}) {
  return {
    path: normalizeString(artifact.path),
    exists: Boolean(artifact.exists),
    text: String(artifact.text || ""),
  };
}

function extractPlanIdFromArtifact(planArtifact) {
  if (!planArtifact.exists || !normalizeString(planArtifact.text)) {
    return "";
  }

  try {
    const sections = parseMarkdownSections(planArtifact.text);
    const rawEnvelope = extractPortfolioEnvelopeJson(sections[PORTFOLIO_COORDINATION_SECTION] || "");
    return normalizeString(rawEnvelope?.plan_id);
  } catch {
    return "";
  }
}

function resolveCurrentPlanRef({ slug, portfolioEnvelopePlanId, planArtifact }) {
  const envelopePlanId = normalizeString(portfolioEnvelopePlanId);
  if (envelopePlanId) {
    return {
      ref: envelopePlanId,
      sourceRef: stateSourceRef("portfolio_coordination.envelope.plan_id"),
    };
  }

  const planArtifactId = extractPlanIdFromArtifact(planArtifact);
  if (planArtifactId) {
    return {
      ref: planArtifactId,
      sourceRef: artifactSourceRef(planArtifact.path, "Portfolio Coordination Envelope.plan_id"),
    };
  }

  return {
    ref: normalizeString(slug) || "unknown-theme",
    sourceRef: stateSourceRef("slug"),
  };
}

function advisoryContext(portfolioSummary) {
  if (!portfolioSummary || typeof portfolioSummary !== "object") {
    return {
      advisoryInputsUsed: [],
      advisorySourceRefs: [],
    };
  }

  return {
    advisoryInputsUsed: ["portfolio_coordination.summary"],
    advisorySourceRefs: [stateSourceRef("portfolio_coordination.summary")],
  };
}

function baseDecision({
  enabled,
  disableReason,
  decision,
  decisionReason,
  selectedWorkKind,
  selectedWorkRef,
  blockingRefs = [],
  requiresHuman,
  decisionSourceRefs = [],
  advisoryInputsUsed = [],
}) {
  return {
    enabled,
    disable_reason: disableReason,
    consumer_mode: CONSUMER_MODE,
    consumer_scope: CONSUMER_SCOPE,
    shared_contract_ref: WORKFLOW_STATE_BRIDGE_SHARED_CONTRACT_REF,
    decision,
    decision_reason: decisionReason,
    selected_work_kind: selectedWorkKind,
    selected_work_ref: selectedWorkRef,
    blocking_refs: uniqueEntries(blockingRefs),
    requires_human: Boolean(requiresHuman),
    decision_source_refs: uniqueEntries(decisionSourceRefs),
    advisory_inputs_used: uniqueEntries(advisoryInputsUsed),
  };
}

function disabledDecision({
  disableReason,
  decisionReason,
  decisionSourceRefs,
  advisoryInputsUsed,
}) {
  return baseDecision({
    enabled: false,
    disableReason,
    decision: "disabled",
    decisionReason,
    selectedWorkKind: "none",
    selectedWorkRef: "none",
    blockingRefs: [],
    requiresHuman: false,
    decisionSourceRefs,
    advisoryInputsUsed,
  });
}

function enabledDecision({
  decision,
  decisionReason,
  selectedWorkKind,
  selectedWorkRef,
  blockingRefs = [],
  requiresHuman = false,
  decisionSourceRefs = [],
  advisoryInputsUsed = [],
}) {
  return baseDecision({
    enabled: true,
    disableReason: "",
    decision,
    decisionReason,
    selectedWorkKind,
    selectedWorkRef,
    blockingRefs,
    requiresHuman,
    decisionSourceRefs,
    advisoryInputsUsed,
  });
}

function workflowMismatch({
  workflowStatus,
  reviewResult,
  planArtifact,
  reviewArtifact,
  closeoutArtifact,
  closeoutReady,
}) {
  if (workflowStatus === "plan_drafted") {
    if (!planArtifact.exists) {
      return {
        reason: "missing_plan_artifact",
        blockingRefs: [artifactSourceRef(planArtifact.path)],
      };
    }

    if (reviewResult === "pass" || (reviewArtifact.exists && !reviewResult)) {
      return {
        reason: "plan_drafted_review_state_inconsistent",
        blockingRefs: [
          artifactSourceRef(reviewArtifact.path),
          stateSourceRef("harness.review_results.result"),
        ],
      };
    }

    return null;
  }

  if (workflowStatus === "plan_reviewed" || workflowStatus === "implementing" || workflowStatus === "verified") {
    if (!planArtifact.exists) {
      return {
        reason: "missing_plan_artifact",
        blockingRefs: [artifactSourceRef(planArtifact.path)],
      };
    }

    if (!reviewArtifact.exists) {
      return {
        reason: "missing_review_artifact",
        blockingRefs: [artifactSourceRef(reviewArtifact.path)],
      };
    }

    if (reviewResult !== "pass") {
      return {
        reason: "review_result_inconsistent",
        blockingRefs: [stateSourceRef("harness.review_results.result")],
      };
    }

    return null;
  }

  if (workflowStatus === "closeout_ready" && !closeoutReady) {
    if (!closeoutArtifact.exists) {
      return {
        reason: "missing_closeout_artifact",
        blockingRefs: [
          artifactSourceRef(closeoutArtifact.path),
          helperSourceRef("closeoutIsReady"),
        ],
      };
    }

    return {
      reason: "closeout_readiness_unsatisfied",
      blockingRefs: [helperSourceRef("closeoutIsReady")],
    };
  }

  if (workflowStatus && !CONTINUE_REASON_BY_STATUS[workflowStatus] && workflowStatus !== "closeout_ready" && !HUMAN_STATUS_REASONS[workflowStatus]) {
    return {
      reason: "workflow_status_unrecognized",
      blockingRefs: [stateSourceRef("harness.workflow_status")],
    };
  }

  return null;
}

export function evaluateWorkflowStateBridgeDecision({
  slug = "",
  harness_policy: harnessPolicyInput = "",
  workflow_status: workflowStatusInput = "",
  review_result: reviewResultInput = "",
  plan_artifact: planArtifactInput = {},
  review_artifact: reviewArtifactInput = {},
  closeout_artifact: closeoutArtifactInput = {},
  closeout_ready: closeoutReady = false,
  portfolio_envelope_plan_id: portfolioEnvelopePlanId = "",
  portfolio_summary: portfolioSummary = null,
} = {}) {
  const harnessPolicy = normalizeString(harnessPolicyInput) || "legacy";
  const workflowStatus = normalizeString(workflowStatusInput);
  const reviewResult = normalizeString(reviewResultInput);
  const planArtifact = normalizeArtifact(planArtifactInput);
  const reviewArtifact = normalizeArtifact(reviewArtifactInput);
  const closeoutArtifact = normalizeArtifact(closeoutArtifactInput);
  const { advisoryInputsUsed, advisorySourceRefs } = advisoryContext(portfolioSummary);
  const currentPlan = resolveCurrentPlanRef({
    slug,
    portfolioEnvelopePlanId,
    planArtifact,
  });

  const commonSourceRefs = [
    stateSourceRef("harness_policy"),
    stateSourceRef("harness.workflow_status"),
  ];

  if (harnessPolicy === "exempt") {
    return disabledDecision({
      disableReason: "not_applicable",
      decisionReason: "harness_policy_exempt",
      decisionSourceRefs: [...commonSourceRefs, ...advisorySourceRefs],
      advisoryInputsUsed,
    });
  }

  if (harnessPolicy === "legacy") {
    return disabledDecision({
      disableReason: "not_applicable",
      decisionReason: "harness_policy_legacy",
      decisionSourceRefs: [...commonSourceRefs, ...advisorySourceRefs],
      advisoryInputsUsed,
    });
  }

  if (!workflowStatus) {
    return disabledDecision({
      disableReason: "not_started",
      decisionReason: "workflow_not_started",
      decisionSourceRefs: [...commonSourceRefs, ...advisorySourceRefs],
      advisoryInputsUsed,
    });
  }

  if (workflowStatus === "plan_drafted" && reviewResult && reviewResult !== "pass") {
    return enabledDecision({
      decision: "replan_current_plan",
      decisionReason: "plan_review_failed",
      selectedWorkKind: "current_plan",
      selectedWorkRef: currentPlan.ref,
      blockingRefs: [
        artifactSourceRef(reviewArtifact.path),
        stateSourceRef("harness.review_results.result"),
      ],
      decisionSourceRefs: [
        ...commonSourceRefs,
        artifactSourceRef(planArtifact.path),
        artifactSourceRef(reviewArtifact.path),
        stateSourceRef("harness.review_results.result"),
        currentPlan.sourceRef,
        ...advisorySourceRefs,
      ],
      advisoryInputsUsed,
    });
  }

  if (HUMAN_STATUS_REASONS[workflowStatus]) {
    return enabledDecision({
      decision: "pause_for_human",
      decisionReason: HUMAN_STATUS_REASONS[workflowStatus],
      selectedWorkKind: "current_plan",
      selectedWorkRef: currentPlan.ref,
      blockingRefs: [stateSourceRef("harness.workflow_status")],
      requiresHuman: true,
      decisionSourceRefs: [
        ...commonSourceRefs,
        currentPlan.sourceRef,
        ...advisorySourceRefs,
      ],
      advisoryInputsUsed,
    });
  }

  const mismatch = workflowMismatch({
    workflowStatus,
    reviewResult,
    planArtifact,
    reviewArtifact,
    closeoutArtifact,
    closeoutReady: Boolean(closeoutReady),
  });
  if (mismatch) {
    return enabledDecision({
      decision: "pause_for_human",
      decisionReason: mismatch.reason,
      selectedWorkKind: "current_plan",
      selectedWorkRef: currentPlan.ref,
      blockingRefs: mismatch.blockingRefs,
      requiresHuman: true,
      decisionSourceRefs: [
        ...commonSourceRefs,
        artifactSourceRef(planArtifact.path),
        artifactSourceRef(reviewArtifact.path),
        artifactSourceRef(closeoutArtifact.path),
        stateSourceRef("harness.review_results.result"),
        helperSourceRef("closeoutIsReady"),
        currentPlan.sourceRef,
        ...advisorySourceRefs,
      ],
      advisoryInputsUsed,
    });
  }

  if (CONTINUE_REASON_BY_STATUS[workflowStatus]) {
    return enabledDecision({
      decision: "continue_current_plan",
      decisionReason: CONTINUE_REASON_BY_STATUS[workflowStatus],
      selectedWorkKind: "current_plan",
      selectedWorkRef: currentPlan.ref,
      decisionSourceRefs: [
        ...commonSourceRefs,
        artifactSourceRef(planArtifact.path),
        artifactSourceRef(reviewArtifact.path),
        stateSourceRef("harness.review_results.result"),
        currentPlan.sourceRef,
        ...advisorySourceRefs,
      ],
      advisoryInputsUsed,
    });
  }

  if (workflowStatus === "closeout_ready" && closeoutReady) {
    return enabledDecision({
      decision: "complete",
      decisionReason: "closeout_ready",
      selectedWorkKind: "none",
      selectedWorkRef: "none",
      decisionSourceRefs: [
        ...commonSourceRefs,
        artifactSourceRef(closeoutArtifact.path),
        helperSourceRef("closeoutIsReady"),
        ...advisorySourceRefs,
      ],
      advisoryInputsUsed,
    });
  }

  return enabledDecision({
    decision: "pause_for_human",
    decisionReason: "workflow_status_unrecognized",
    selectedWorkKind: "current_plan",
    selectedWorkRef: currentPlan.ref,
    blockingRefs: [stateSourceRef("harness.workflow_status")],
    requiresHuman: true,
    decisionSourceRefs: [
      ...commonSourceRefs,
      currentPlan.sourceRef,
      ...advisorySourceRefs,
    ],
    advisoryInputsUsed,
  });
}
