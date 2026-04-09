import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

export const PORTFOLIO_SHARED_CONTRACT_REF = [
  "C:/Users/oatyu/デスクトップ/codex-autonomy-mothership/docs/runbooks/portfolio-orchestration-contract.md",
  "C:/Users/oatyu/デスクトップ/codex-autonomy-mothership/docs/runbooks/portfolio-orchestration-v1-stability.md",
  "C:/Users/oatyu/デスクトップ/codex-autonomy-mothership/docs/context/decisions/2026-04-09-portfolio-orchestration-v1-stabilization.md",
].join(" | ");

export const PORTFOLIO_PLAN_ID_PREFIX = "portfolio-coordination";
export const PORTFOLIO_PLAN_VERSION = 1;
export const PORTFOLIO_COORDINATION_SECTION = "Portfolio Coordination Envelope";

export const PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED = "not_evaluated";
export const PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE = "parallel_safe";
export const PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE = "shared_foundation_candidate";
export const PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE = "merge_candidate";
export const PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW = "conflict_review";

export const PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED = "portfolio_refresh_required";
export const PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS = "No higher-priority shared relation applies, so this plan stays independently executable.";
export const PORTFOLIO_STATUS_REASON_PATH_OVERLAP_SAME_ARTIFACT_CLASS = "This plan shares a guaranteed surface overlap and an exact artifact token with another plan, so a combined re-cut review may reduce coordination cost.";
export const PORTFOLIO_STATUS_REASON_PATH_OVERLAP_MIXED_ARTIFACT_CLASS = "This plan shares a guaranteed surface overlap without an exact artifact match, so it should stay in review before independent execution proceeds.";
export const PORTFOLIO_STATUS_REASON_SHARED_FOUNDATION = "This plan shares a normalized foundation prerequisite with another plan and may need foundation-first sequencing.";

export const PORTFOLIO_EXECUTION_LANE_REVIEW_HOLD = "review_hold";
export const PORTFOLIO_EXECUTION_LANE_MERGE_REVIEW = "merge_review";
export const PORTFOLIO_EXECUTION_LANE_FOUNDATION_FIRST = "foundation_first";
export const PORTFOLIO_EXECUTION_LANE_EXECUTION = "execution";
export const PORTFOLIO_EXECUTION_LANES = [
  PORTFOLIO_EXECUTION_LANE_REVIEW_HOLD,
  PORTFOLIO_EXECUTION_LANE_MERGE_REVIEW,
  PORTFOLIO_EXECUTION_LANE_FOUNDATION_FIRST,
  PORTFOLIO_EXECUTION_LANE_EXECUTION,
];

export const PORTFOLIO_REVIEW_FINDING_MISSING_ENVELOPE = "missing_portfolio_coordination_envelope";
export const PORTFOLIO_REVIEW_FINDING_INVALID_JSON = "portfolio_coordination_invalid_json";
export const PORTFOLIO_REVIEW_FINDING_MISSING_REQUIRED_FIELD = "portfolio_coordination_missing_required_field";
export const PORTFOLIO_REVIEW_FINDING_RAW_TOKEN = "portfolio_coordination_raw_token";
export const PORTFOLIO_REVIEW_FINDING_INVALID_NAMESPACE = "portfolio_coordination_invalid_namespace";
export const PORTFOLIO_REVIEW_FINDING_INVALID_VALUE = "portfolio_coordination_invalid_value";

const TOKEN_PATTERN = /^([a-z][a-z0-9_-]*):(.*)$/u;
const SURFACE_NAMESPACES = new Set(["api", "contract", "path", "report", "schema", "ui", "workflow"]);
const ARTIFACT_NAMESPACES = new Set(["code", "config", "context", "doc", "handoff", "report", "test"]);
const PREREQUISITE_NAMESPACES = new Set(["approval", "artifact", "contract", "decision", "foundation"]);
const RESOURCE_NAMESPACES = new Set(["env", "human", "repo", "service", "tool", "workspace"]);
const TERMINAL_WORKFLOW_STATUSES = new Set(["approved", "rejected"]);
const RELATIONLESS_STATUSES = new Set([
  PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED,
  PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE,
]);

const PORTFOLIO_STATUS_PRIORITY = new Map([
  [PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW, 4],
  [PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE, 3],
  [PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE, 2],
  [PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE, 1],
  [PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED, 0],
]);

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  return value;
}

export function stableHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
}

function normalizeOptionalString(value) {
  return String(value || "").trim();
}

function normalizeRequiredString(value, label) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_MISSING_REQUIRED_FIELD,
      `${label} must be a non-empty string.`,
      { field: label },
    );
  }
  return normalized;
}

function normalizeOptionalInteger(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

function normalizeRequiredInteger(value, label) {
  const numeric = normalizeOptionalInteger(value);
  if (numeric === null) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_VALUE,
      `${label} must be a positive integer.`,
      { field: label, value },
    );
  }
  return numeric;
}

function normalizeOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return Number.NaN;
  }

  return typeof value === "number" ? value : Number(String(value).trim());
}

function normalizeRequiredConfidence(value, label = "surface_confidence") {
  const numeric = normalizeOptionalNumber(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_VALUE,
      `${label} must be a numeric float between 0.0 and 1.0.`,
      { field: label, value },
    );
  }

  return Number(numeric);
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeOptionalString(value))
    .filter(Boolean))]
    .sort();
}

function normalizePathTokenBody(value) {
  let normalized = normalizeRequiredString(value, "path token body")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+/u, "")
    .toLowerCase();

  if (!normalized.endsWith("/**")) {
    normalized = normalized.replace(/\/+$/u, "");
  }

  return normalized || ".";
}

function normalizeTokenBody(namespace, value) {
  if (namespace === "path") {
    return normalizePathTokenBody(value);
  }

  return normalizeRequiredString(value, `${namespace} token body`)
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function splitToken(value, label) {
  const normalized = normalizeRequiredString(value, label).toLowerCase();
  const match = TOKEN_PATTERN.exec(normalized);
  if (!match) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_RAW_TOKEN,
      `${label} must use namespaced vocabulary.`,
      { field: label, value: normalized },
    );
  }
  return {
    namespace: match[1],
    body: match[2],
  };
}

function normalizeNamespacedToken(value, label, allowedNamespaces) {
  const { namespace, body } = splitToken(value, label);
  if (!allowedNamespaces.has(namespace)) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_NAMESPACE,
      `${label} uses an unsupported namespace.`,
      { field: label, namespace, value },
    );
  }

  return `${namespace}:${normalizeTokenBody(namespace, body)}`;
}

function normalizeStrictTokenList(values, label, allowedNamespaces) {
  if (!Array.isArray(values)) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_MISSING_REQUIRED_FIELD,
      `${label} must be an array.`,
      { field: label },
    );
  }

  return [...new Set(values.map((value, index) => normalizeNamespacedToken(
    value,
    `${label}[${index}]`,
    allowedNamespaces,
  )))].sort();
}

function ensureEnvelopeShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    plan_ref: normalizeOptionalString(value.plan_ref),
    plan_id: normalizeOptionalString(value.plan_id),
    plan_version: value.plan_version,
    plan_title: normalizeOptionalString(value.plan_title),
    summary: normalizeOptionalString(value.summary),
    affected_surfaces: normalizeStringList(value.affected_surfaces),
    surface_confidence: value.surface_confidence,
    expected_artifacts: normalizeStringList(value.expected_artifacts),
    prerequisites: normalizeStringList(value.prerequisites),
    required_resources: normalizeStringList(value.required_resources),
  };
}

function ensureSummaryShape(value) {
  const summary = value && typeof value === "object" ? value : {};
  return {
    coordination_status: normalizeOptionalString(summary.coordination_status) || PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED,
    status_reason: normalizeOptionalString(summary.status_reason) || PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED,
    primary_relation_key: normalizeOptionalString(summary.primary_relation_key),
    triggering_relation_keys: normalizeStringList(summary.triggering_relation_keys),
    related_plan_refs: normalizeStringList(summary.related_plan_refs),
    portfolio_plan_id: normalizeOptionalString(summary.portfolio_plan_id),
    portfolio_plan_version: normalizeOptionalInteger(summary.portfolio_plan_version),
    last_refreshed_at: normalizeOptionalString(summary.last_refreshed_at),
    summary_valid: Boolean(summary.summary_valid),
    envelope_fingerprint: normalizeOptionalString(summary.envelope_fingerprint),
    summary_basis_fingerprint: normalizeOptionalString(summary.summary_basis_fingerprint),
    shared_contract_ref: normalizeOptionalString(summary.shared_contract_ref) || PORTFOLIO_SHARED_CONTRACT_REF,
    advisory_notes: normalizeStringList(summary.advisory_notes),
  };
}

export function initialInvalidPortfolioSummary(overrides = {}) {
  return {
    coordination_status: PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED,
    status_reason: PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED,
    primary_relation_key: "",
    triggering_relation_keys: [],
    related_plan_refs: [],
    portfolio_plan_id: "",
    portfolio_plan_version: null,
    last_refreshed_at: "",
    summary_valid: false,
    envelope_fingerprint: "",
    summary_basis_fingerprint: "",
    shared_contract_ref: PORTFOLIO_SHARED_CONTRACT_REF,
    advisory_notes: [],
    ...overrides,
  };
}

export function invalidatePortfolioSummary(summary = {}, {
  envelopeFingerprint = "",
  portfolioPlanId = "",
  portfolioPlanVersion = null,
  lastRefreshedAt = "",
  sharedContractRef = PORTFOLIO_SHARED_CONTRACT_REF,
} = {}) {
  const normalized = ensureSummaryShape(summary);
  return initialInvalidPortfolioSummary({
    portfolio_plan_id: portfolioPlanId,
    portfolio_plan_version: portfolioPlanVersion,
    last_refreshed_at: lastRefreshedAt,
    envelope_fingerprint: envelopeFingerprint || normalized.envelope_fingerprint,
    shared_contract_ref: sharedContractRef || normalized.shared_contract_ref || PORTFOLIO_SHARED_CONTRACT_REF,
  });
}

export function ensurePortfolioCoordinationShape(value) {
  const coordination = value && typeof value === "object" ? value : {};
  return {
    envelope: ensureEnvelopeShape(coordination.envelope),
    summary: ensureSummaryShape(coordination.summary),
  };
}

export function normalizePortfolioCoordinationEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_JSON,
      "Portfolio coordination envelope must be a JSON object.",
    );
  }

  const normalized = {
    plan_ref: normalizeRequiredString(value.plan_ref, "plan_ref"),
    plan_id: normalizeRequiredString(value.plan_id, "plan_id"),
    plan_version: normalizeRequiredInteger(value.plan_version, "plan_version"),
    affected_surfaces: normalizeStrictTokenList(value.affected_surfaces, "affected_surfaces", SURFACE_NAMESPACES),
    surface_confidence: normalizeRequiredConfidence(value.surface_confidence, "surface_confidence"),
    expected_artifacts: normalizeStrictTokenList(value.expected_artifacts, "expected_artifacts", ARTIFACT_NAMESPACES),
    prerequisites: normalizeStrictTokenList(value.prerequisites, "prerequisites", PREREQUISITE_NAMESPACES),
    required_resources: Array.isArray(value.required_resources)
      ? normalizeStrictTokenList(value.required_resources, "required_resources", RESOURCE_NAMESPACES)
      : [],
  };

  const planTitle = normalizeOptionalString(value.plan_title);
  if (planTitle) {
    normalized.plan_title = planTitle;
  }

  const summary = normalizeOptionalString(value.summary);
  if (summary) {
    normalized.summary = summary;
  }

  return normalized;
}

export function analyzePortfolioCoordinationEnvelope(value) {
  try {
    return {
      envelope: normalizePortfolioCoordinationEnvelope(value),
      advisory_notes: [],
      errors: [],
    };
  } catch (error) {
    return {
      envelope: null,
      advisory_notes: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function extractPortfolioEnvelopeJson(sectionText) {
  const trimmed = String(sectionText || "").trim();
  if (!trimmed) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_MISSING_ENVELOPE,
      "Portfolio coordination envelope section is required.",
    );
  }

  const match = /^```json\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (!match) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_JSON,
      "Portfolio coordination envelope must be a single fenced json block.",
    );
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Envelope must parse to an object.");
    }
    return parsed;
  } catch (error) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_JSON,
      `Portfolio coordination envelope JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function validatePortfolioEnvelopeSection(sectionText) {
  try {
    const envelope = normalizePortfolioCoordinationEnvelope(extractPortfolioEnvelopeJson(sectionText));
    return {
      ok: true,
      envelope,
      finding_code: "",
      message: "",
    };
  } catch (error) {
    return {
      ok: false,
      envelope: null,
      finding_code: error?.code || PORTFOLIO_REVIEW_FINDING_INVALID_VALUE,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function computePortfolioEnvelopeFingerprint(envelope) {
  return stableHash(normalizePortfolioCoordinationEnvelope(envelope));
}

export function portfolioArtifactPath(repoRoot) {
  return path.join(repoRoot, "output", "theme_ops", "portfolio", "latest.json");
}

export function buildPortfolioPlanId(generatedAt) {
  const datePortion = normalizeRequiredString(generatedAt, "generated_at").slice(0, 10);
  return `${PORTFOLIO_PLAN_ID_PREFIX}-${datePortion}`;
}

export function portfolioRelationPriority(status) {
  return PORTFOLIO_STATUS_PRIORITY.get(String(status || "")) ?? 0;
}

function tokenBody(token) {
  const match = TOKEN_PATTERN.exec(String(token || "").toLowerCase());
  return match ? normalizeTokenBody(match[1], match[2]) : "";
}

function pathPrefixSegments(token) {
  const body = tokenBody(token);
  const normalized = body.endsWith("/**") ? body.slice(0, -3) : body;
  return normalized.split("/").filter(Boolean);
}

function segmentPrefixMatch(left, right) {
  return left.length <= right.length && left.every((segment, index) => segment === right[index]);
}

function guaranteedOverlapBasis(leftToken, rightToken) {
  const left = String(leftToken || "").toLowerCase();
  const right = String(rightToken || "").toLowerCase();
  if (left === right) {
    return left;
  }

  if (!left.startsWith("path:") || !right.startsWith("path:")) {
    return "";
  }

  const leftPrefix = pathPrefixSegments(left);
  const rightPrefix = pathPrefixSegments(right);
  if (!leftPrefix.length || !rightPrefix.length) {
    return "";
  }

  if (segmentPrefixMatch(leftPrefix, rightPrefix) || segmentPrefixMatch(rightPrefix, leftPrefix)) {
    return [left, right].sort()[0];
  }

  return "";
}

export function surfacesOverlap(leftToken, rightToken) {
  return Boolean(guaranteedOverlapBasis(leftToken, rightToken));
}

function relationReason(relationType, discriminator, sharedExpectedArtifacts = []) {
  if (relationType === PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE) {
    return `Both plans share the normalized surface \`${discriminator}\` and the exact artifact token(s) ${sharedExpectedArtifacts.join(", ")}.`;
  }

  if (relationType === PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW) {
    return `Both plans share the normalized surface \`${discriminator}\` without an exact shared artifact token, so they should stay in review before independent execution proceeds.`;
  }

  return `Both plans depend on the normalized prerequisite \`${discriminator}\`.`;
}

function relationReviewPoints(relationType) {
  if (relationType === PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE) {
    return [
      "Can the combined review surface be made smaller before any shared re-cut is attempted?",
    ];
  }

  if (relationType === PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW) {
    return [
      "Should one plan wait until the overlap is reviewed or reduced before implementation continues?",
    ];
  }

  return [
    "Should the shared foundation land once before either dependent plan continues independently?",
  ];
}

export function buildPortfolioRelationKey(relationType, planPair, discriminator) {
  const normalizedPair = [...planPair].sort();
  const normalizedDiscriminator = normalizeRequiredString(discriminator, "normalized_discriminator").toLowerCase();
  return `${relationType}:${normalizedPair.join("|")}:${normalizedDiscriminator}`;
}

export function portfolioStatusReasonForRelation(relationType) {
  if (relationType === PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW) {
    return PORTFOLIO_STATUS_REASON_PATH_OVERLAP_MIXED_ARTIFACT_CLASS;
  }
  if (relationType === PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE) {
    return PORTFOLIO_STATUS_REASON_PATH_OVERLAP_SAME_ARTIFACT_CLASS;
  }
  if (relationType === PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE) {
    return PORTFOLIO_STATUS_REASON_SHARED_FOUNDATION;
  }
  return PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS;
}

export function laneForPortfolioStatus(status) {
  if (status === PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW) {
    return PORTFOLIO_EXECUTION_LANE_REVIEW_HOLD;
  }
  if (status === PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE) {
    return PORTFOLIO_EXECUTION_LANE_MERGE_REVIEW;
  }
  if (status === PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE) {
    return PORTFOLIO_EXECUTION_LANE_FOUNDATION_FIRST;
  }
  return PORTFOLIO_EXECUTION_LANE_EXECUTION;
}

function orderEnvelopesByPlanId(leftEnvelope, rightEnvelope) {
  return leftEnvelope.plan_id.localeCompare(rightEnvelope.plan_id)
    || leftEnvelope.plan_ref.localeCompare(rightEnvelope.plan_ref);
}

function exactTokenIntersection(leftTokens, rightTokens) {
  return [...new Set(normalizeStringList(leftTokens).filter((token) => normalizeStringList(rightTokens).includes(token)))].sort();
}

export function buildPairwisePortfolioRelations(leftPlan, rightPlan) {
  const orderedEnvelopes = [leftPlan.envelope, rightPlan.envelope].sort(orderEnvelopesByPlanId);
  const [firstEnvelope, secondEnvelope] = orderedEnvelopes;
  const planIds = orderedEnvelopes.map((entry) => entry.plan_id);
  const planRefs = orderedEnvelopes.map((entry) => entry.plan_ref);
  const relationConfidence = Math.min(firstEnvelope.surface_confidence, secondEnvelope.surface_confidence);

  const overlapBases = [];
  for (const leftSurface of firstEnvelope.affected_surfaces) {
    for (const rightSurface of secondEnvelope.affected_surfaces) {
      const basis = guaranteedOverlapBasis(leftSurface, rightSurface);
      if (basis) {
        overlapBases.push(basis);
      }
    }
  }

  const sharedExpectedArtifacts = exactTokenIntersection(firstEnvelope.expected_artifacts, secondEnvelope.expected_artifacts);
  const sharedFoundations = exactTokenIntersection(
    firstEnvelope.prerequisites.filter((token) => token.startsWith("foundation:")),
    secondEnvelope.prerequisites.filter((token) => token.startsWith("foundation:")),
  );

  const relations = [];
  const createdFromEnvelopeRefs = [...planRefs];

  if (overlapBases.length) {
    const discriminator = [...new Set(overlapBases)].sort()[0];
    const relationType = sharedExpectedArtifacts.length
      ? PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE
      : PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW;

    relations.push({
      relation_key: buildPortfolioRelationKey(relationType, planIds, discriminator),
      plan_refs: planRefs,
      primary_relation_type: relationType,
      reason: relationReason(relationType, discriminator, sharedExpectedArtifacts),
      review_points: relationReviewPoints(relationType),
      confidence: relationConfidence,
      created_from_envelope_refs: createdFromEnvelopeRefs,
    });
  }

  for (const sharedFoundation of sharedFoundations) {
    relations.push({
      relation_key: buildPortfolioRelationKey(
        PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE,
        planIds,
        sharedFoundation,
      ),
      plan_refs: planRefs,
      primary_relation_type: PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE,
      reason: relationReason(PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE, sharedFoundation),
      review_points: relationReviewPoints(PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE),
      confidence: relationConfidence,
      created_from_envelope_refs: createdFromEnvelopeRefs,
    });
  }

  return relations.sort((left, right) => left.relation_key.localeCompare(right.relation_key));
}

export function computePortfolioSummaryBasisFingerprint({
  envelopeFingerprint = "",
  coordinationStatus = PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED,
  statusReason = PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED,
  primaryRelationKey = "",
  triggeringRelationKeys = [],
  relatedPlanRefs = [],
  portfolioPlanId = "",
  portfolioPlanVersion = null,
  lastRefreshedAt = "",
  sharedContractRef = PORTFOLIO_SHARED_CONTRACT_REF,
  artifactPath = "",
  artifactPresent = false,
  eligible = false,
} = {}) {
  return stableHash({
    envelope_fingerprint: envelopeFingerprint,
    coordination_status: coordinationStatus,
    status_reason: statusReason,
    primary_relation_key: primaryRelationKey,
    triggering_relation_keys: normalizeStringList(triggeringRelationKeys),
    related_plan_refs: normalizeStringList(relatedPlanRefs),
    portfolio_plan_id: portfolioPlanId,
    portfolio_plan_version: portfolioPlanVersion,
    last_refreshed_at: lastRefreshedAt,
    shared_contract_ref: sharedContractRef,
    artifact_path: artifactPath,
    artifact_present: Boolean(artifactPresent),
    eligible: Boolean(eligible),
  });
}

export function buildPortfolioSummary({
  envelopeFingerprint = "",
  coordinationStatus = PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE,
  statusReason = PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS,
  primaryRelationKey = "",
  triggeringRelationKeys = [],
  relatedPlanRefs = [],
  portfolioPlanId = "",
  portfolioPlanVersion = PORTFOLIO_PLAN_VERSION,
  lastRefreshedAt = "",
  sharedContractRef = PORTFOLIO_SHARED_CONTRACT_REF,
  advisoryNotes = [],
  artifactPath = "",
  artifactPresent = true,
  eligible = true,
} = {}) {
  const normalizedStatus = String(coordinationStatus || PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE);
  const relationless = RELATIONLESS_STATUSES.has(normalizedStatus);
  const normalizedPrimaryRelationKey = relationless ? "" : normalizeOptionalString(primaryRelationKey);
  const normalizedTriggeringRelationKeys = relationless ? [] : normalizeStringList(triggeringRelationKeys);
  const normalizedRelatedPlanRefs = relationless ? [] : normalizeStringList(relatedPlanRefs);

  return {
    coordination_status: normalizedStatus,
    status_reason: normalizeOptionalString(statusReason) || PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS,
    primary_relation_key: normalizedPrimaryRelationKey,
    triggering_relation_keys: normalizedTriggeringRelationKeys,
    related_plan_refs: normalizedRelatedPlanRefs,
    portfolio_plan_id: normalizeOptionalString(portfolioPlanId),
    portfolio_plan_version: normalizeOptionalInteger(portfolioPlanVersion),
    last_refreshed_at: normalizeOptionalString(lastRefreshedAt),
    summary_valid: true,
    envelope_fingerprint: normalizeOptionalString(envelopeFingerprint),
    summary_basis_fingerprint: computePortfolioSummaryBasisFingerprint({
      envelopeFingerprint,
      coordinationStatus: normalizedStatus,
      statusReason,
      primaryRelationKey: normalizedPrimaryRelationKey,
      triggeringRelationKeys: normalizedTriggeringRelationKeys,
      relatedPlanRefs: normalizedRelatedPlanRefs,
      portfolioPlanId,
      portfolioPlanVersion,
      lastRefreshedAt,
      sharedContractRef,
      artifactPath,
      artifactPresent,
      eligible,
    }),
    shared_contract_ref: normalizeOptionalString(sharedContractRef) || PORTFOLIO_SHARED_CONTRACT_REF,
    advisory_notes: normalizeStringList(advisoryNotes),
  };
}

function summaryRelationFieldsAreInvalid(summary) {
  const hasRelationFields = Boolean(summary.primary_relation_key)
    || summary.triggering_relation_keys.length > 0
    || summary.related_plan_refs.length > 0;

  if (RELATIONLESS_STATUSES.has(summary.coordination_status)) {
    return hasRelationFields;
  }

  return !summary.primary_relation_key;
}

export function portfolioSummaryDisplay(state, repoRoot) {
  const coordination = ensurePortfolioCoordinationShape(state?.portfolio_coordination);
  const envelopeAnalysis = analyzePortfolioCoordinationEnvelope(coordination.envelope);
  const envelope = envelopeAnalysis.envelope;
  const summary = coordination.summary;
  const artifactPath = portfolioArtifactPath(repoRoot);
  const artifactPresent = existsSync(artifactPath);
  const eligible = Boolean(envelope) && !TERMINAL_WORKFLOW_STATUSES.has(String(state?.harness?.workflow_status || ""));
  const envelopeFingerprint = envelope ? computePortfolioEnvelopeFingerprint(envelope) : "";
  const basisFingerprint = computePortfolioSummaryBasisFingerprint({
    envelopeFingerprint,
    coordinationStatus: summary.coordination_status,
    statusReason: summary.status_reason,
    primaryRelationKey: summary.primary_relation_key,
    triggeringRelationKeys: summary.triggering_relation_keys,
    relatedPlanRefs: summary.related_plan_refs,
    portfolioPlanId: summary.portfolio_plan_id,
    portfolioPlanVersion: summary.portfolio_plan_version,
    lastRefreshedAt: summary.last_refreshed_at,
    sharedContractRef: summary.shared_contract_ref,
    artifactPath,
    artifactPresent,
    eligible,
  });

  const summaryDrift = Boolean(summary.summary_basis_fingerprint)
    && summary.summary_basis_fingerprint !== basisFingerprint;
  const displayInvalid = !summary.summary_valid
    || !artifactPresent
    || !eligible
    || !envelope
    || !summary.summary_basis_fingerprint
    || summary.envelope_fingerprint !== envelopeFingerprint
    || summaryDrift
    || summaryRelationFieldsAreInvalid(summary);

  if (displayInvalid) {
    return {
      portfolio_coordination_status: PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED,
      portfolio_status_reason: PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED,
      portfolio_primary_relation_key: "",
      portfolio_related_plan_refs: [],
      portfolio_last_refreshed_at: summary.last_refreshed_at,
      portfolio_summary_valid: false,
      portfolio_artifact_path: artifactPath,
      portfolio_shared_contract_ref: summary.shared_contract_ref || PORTFOLIO_SHARED_CONTRACT_REF,
    };
  }

  return {
    portfolio_coordination_status: summary.coordination_status,
    portfolio_status_reason: summary.status_reason,
    portfolio_primary_relation_key: summary.primary_relation_key,
    portfolio_related_plan_refs: summary.related_plan_refs,
    portfolio_last_refreshed_at: summary.last_refreshed_at,
    portfolio_summary_valid: summary.summary_valid,
    portfolio_artifact_path: artifactPath,
    portfolio_shared_contract_ref: summary.shared_contract_ref,
  };
}

export function portfolioEligibility(state) {
  return Boolean(ensurePortfolioCoordinationShape(state?.portfolio_coordination).envelope)
    && !TERMINAL_WORKFLOW_STATUSES.has(String(state?.harness?.workflow_status || ""));
}
