import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

export const PORTFOLIO_SHARED_CONTRACT_REF = "quest-agent:portfolio-coordination/v1";
export const PORTFOLIO_ID = "quest-agent-theme-portfolio";
export const PORTFOLIO_VERSION = "1";
export const PORTFOLIO_COORDINATION_SECTION = "Portfolio Coordination Envelope";

export const PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED = "not_evaluated";
export const PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE = "parallel_safe";
export const PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE = "shared_foundation_candidate";
export const PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE = "merge_candidate";
export const PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW = "conflict_review";

export const PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED = "portfolio_refresh_required";
export const PORTFOLIO_STATUS_REASON_NO_RELATED_ACTIVE_PLANS = "no_related_active_plans";
export const PORTFOLIO_STATUS_REASON_PATH_OVERLAP_SAME_ARTIFACT_CLASS = "path_overlap_same_artifact_class";
export const PORTFOLIO_STATUS_REASON_PATH_OVERLAP_MIXED_ARTIFACT_CLASS = "path_overlap_mixed_artifact_class";
export const PORTFOLIO_STATUS_REASON_SHARED_FOUNDATION = "shared_foundation_prerequisite";

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
const PLAN_REF_NAMESPACES = new Set(["plan", "theme", "state"]);
const SURFACE_NAMESPACES = new Set(["api", "contract", "path", "prompt", "route", "state", "surface", "workflow"]);
const ARTIFACT_NAMESPACES = new Set(["artifact"]);
const PREREQUISITE_NAMESPACES = new Set(["artifact", "contract", "decision", "dependency", "foundation"]);
const RESOURCE_NAMESPACES = new Set(["env", "resource", "service", "team"]);
const SURFACE_CONFIDENCE_VALUES = new Set(["confidence:high", "confidence:medium", "confidence:low"]);
const TERMINAL_WORKFLOW_STATUSES = new Set(["approved", "rejected"]);

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
      { field: label, namespace, value: value },
    );
  }

  return `${namespace}:${normalizeTokenBody(namespace, body)}`;
}

function analyzeNamespacedToken(value, label, allowedNamespaces) {
  try {
    return {
      token: normalizeNamespacedToken(value, label, allowedNamespaces),
      advisory_notes: [],
    };
  } catch (error) {
    if (error?.code === PORTFOLIO_REVIEW_FINDING_RAW_TOKEN) {
      return {
        token: "",
        advisory_notes: [`Ignored raw ${label} token: \`${normalizeOptionalString(value)}\`.`],
      };
    }
    if (error?.code === PORTFOLIO_REVIEW_FINDING_INVALID_NAMESPACE) {
      return {
        token: "",
        advisory_notes: [`Ignored unsupported ${label} namespace: \`${normalizeOptionalString(value)}\`.`],
      };
    }
    throw error;
  }
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
  )))]
    .sort();
}

function analyzeTokenList(values, label, allowedNamespaces) {
  const advisoryNotes = [];
  const tokens = [];
  if (!Array.isArray(values)) {
    return {
      tokens,
      advisory_notes: advisoryNotes,
      had_field: false,
    };
  }

  for (const [index, value] of values.entries()) {
    const analyzed = analyzeNamespacedToken(value, `${label}[${index}]`, allowedNamespaces);
    if (analyzed.token) {
      tokens.push(analyzed.token);
    }
    advisoryNotes.push(...analyzed.advisory_notes);
  }

  return {
    tokens: [...new Set(tokens)].sort(),
    advisory_notes: [...new Set(advisoryNotes)].sort(),
    had_field: true,
  };
}

function ensureEnvelopeShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    plan_ref: normalizeOptionalString(value.plan_ref),
    plan_id: normalizeOptionalString(value.plan_id),
    plan_version: normalizeOptionalString(value.plan_version),
    parent_goal: normalizeOptionalString(value.parent_goal),
    affected_surfaces: normalizeStringList(value.affected_surfaces),
    surface_confidence: normalizeOptionalString(value.surface_confidence).toLowerCase(),
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
    portfolio_id: normalizeOptionalString(summary.portfolio_id),
    portfolio_version: normalizeOptionalString(summary.portfolio_version),
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
    portfolio_id: "",
    portfolio_version: "",
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
  portfolioId = "",
  portfolioVersion = "",
  lastRefreshedAt = "",
  sharedContractRef = PORTFOLIO_SHARED_CONTRACT_REF,
} = {}) {
  const normalized = ensureSummaryShape(summary);
  return initialInvalidPortfolioSummary({
    portfolio_id: portfolioId,
    portfolio_version: portfolioVersion,
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

  const surfaceConfidence = normalizeNamespacedToken(
    value.surface_confidence,
    "surface_confidence",
    new Set(["confidence"]),
  );
  if (!SURFACE_CONFIDENCE_VALUES.has(surfaceConfidence)) {
    throw contractError(
      PORTFOLIO_REVIEW_FINDING_INVALID_VALUE,
      "surface_confidence must be one of confidence:high|medium|low.",
      { field: "surface_confidence", value: surfaceConfidence },
    );
  }

  return {
    plan_ref: normalizeNamespacedToken(value.plan_ref, "plan_ref", PLAN_REF_NAMESPACES),
    plan_id: normalizeRequiredString(value.plan_id, "plan_id"),
    plan_version: normalizeRequiredString(value.plan_version, "plan_version"),
    parent_goal: normalizeRequiredString(value.parent_goal, "parent_goal"),
    affected_surfaces: normalizeStrictTokenList(value.affected_surfaces, "affected_surfaces", SURFACE_NAMESPACES),
    surface_confidence: surfaceConfidence,
    expected_artifacts: normalizeStrictTokenList(value.expected_artifacts, "expected_artifacts", ARTIFACT_NAMESPACES),
    prerequisites: normalizeStrictTokenList(value.prerequisites, "prerequisites", PREREQUISITE_NAMESPACES),
    required_resources: Array.isArray(value.required_resources)
      ? normalizeStrictTokenList(value.required_resources, "required_resources", RESOURCE_NAMESPACES)
      : [],
  };
}

export function analyzePortfolioCoordinationEnvelope(value) {
  const rawEnvelope = ensureEnvelopeShape(value);
  if (!rawEnvelope) {
    return {
      envelope: null,
      advisory_notes: [],
      errors: ["Envelope must be an object."],
    };
  }

  const errors = [];
  let planRef = "";
  let surfaceConfidence = "";

  try {
    planRef = normalizeNamespacedToken(rawEnvelope.plan_ref, "plan_ref", PLAN_REF_NAMESPACES);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    surfaceConfidence = normalizeNamespacedToken(rawEnvelope.surface_confidence, "surface_confidence", new Set(["confidence"]));
    if (!SURFACE_CONFIDENCE_VALUES.has(surfaceConfidence)) {
      throw contractError(PORTFOLIO_REVIEW_FINDING_INVALID_VALUE, "surface_confidence must be confidence:high|medium|low.");
    }
  } catch (error) {
    errors.push(error.message);
  }

  const affectedSurfaces = analyzeTokenList(rawEnvelope.affected_surfaces, "affected_surfaces", SURFACE_NAMESPACES);
  const expectedArtifacts = analyzeTokenList(rawEnvelope.expected_artifacts, "expected_artifacts", ARTIFACT_NAMESPACES);
  const prerequisites = analyzeTokenList(rawEnvelope.prerequisites, "prerequisites", PREREQUISITE_NAMESPACES);
  const requiredResources = analyzeTokenList(rawEnvelope.required_resources, "required_resources", RESOURCE_NAMESPACES);

  if (!rawEnvelope.plan_id) {
    errors.push("plan_id must be present.");
  }
  if (!rawEnvelope.plan_version) {
    errors.push("plan_version must be present.");
  }
  if (!rawEnvelope.parent_goal) {
    errors.push("parent_goal must be present.");
  }
  if (!affectedSurfaces.had_field) {
    errors.push("affected_surfaces must be present.");
  }
  if (!expectedArtifacts.had_field) {
    errors.push("expected_artifacts must be present.");
  }
  if (!prerequisites.had_field) {
    errors.push("prerequisites must be present.");
  }

  const advisoryNotes = [
    ...affectedSurfaces.advisory_notes,
    ...expectedArtifacts.advisory_notes,
    ...prerequisites.advisory_notes,
    ...requiredResources.advisory_notes,
  ];

  if (errors.length) {
    return {
      envelope: null,
      advisory_notes: [...new Set(advisoryNotes)].sort(),
      errors,
    };
  }

  return {
    envelope: {
      plan_ref: planRef,
      plan_id: rawEnvelope.plan_id,
      plan_version: rawEnvelope.plan_version,
      parent_goal: rawEnvelope.parent_goal,
      affected_surfaces: affectedSurfaces.tokens,
      surface_confidence: surfaceConfidence,
      expected_artifacts: expectedArtifacts.tokens,
      prerequisites: prerequisites.tokens,
      required_resources: requiredResources.tokens,
    },
    advisory_notes: [...new Set(advisoryNotes)].sort(),
    errors: [],
  };
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

export function portfolioRelationPriority(status) {
  return PORTFOLIO_STATUS_PRIORITY.get(String(status || "")) ?? 0;
}

export function portfolioRelationConfidence(status) {
  if (status === PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW || status === PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE) {
    return "high";
  }
  if (status === PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE) {
    return "medium";
  }
  return "low";
}

function tokenBody(token) {
  const match = TOKEN_PATTERN.exec(String(token || "").toLowerCase());
  return match ? normalizeTokenBody(match[1], match[2]) : "";
}

export function artifactClassesForEnvelope(envelope) {
  return normalizeStringList(envelope?.expected_artifacts).map((token) => tokenBody(token));
}

export function foundationPrerequisitesForEnvelope(envelope) {
  return normalizeStringList(envelope?.prerequisites)
    .filter((token) => String(token).toLowerCase().startsWith("foundation:"));
}

function pathPrefixSegments(token) {
  const body = tokenBody(token);
  const segments = body.split("/").filter(Boolean);
  const prefix = [];
  for (const segment of segments) {
    if (segment.includes("*")) {
      break;
    }
    prefix.push(segment);
  }
  return prefix;
}

function segmentPrefixMatch(left, right) {
  return left.length <= right.length && left.every((segment, index) => segment === right[index]);
}

export function surfacesOverlap(leftToken, rightToken) {
  if (!String(leftToken).startsWith("path:") || !String(rightToken).startsWith("path:")) {
    return false;
  }

  const leftPrefix = pathPrefixSegments(leftToken);
  const rightPrefix = pathPrefixSegments(rightToken);
  if (!leftPrefix.length || !rightPrefix.length) {
    return false;
  }
  return segmentPrefixMatch(leftPrefix, rightPrefix) || segmentPrefixMatch(rightPrefix, leftPrefix);
}

function overlapDiscriminator(leftSurface, rightSurface) {
  return [leftSurface, rightSurface].sort().join("|");
}

function buildRelationKeyMaterial(relationType, planPair, discriminator) {
  return {
    relation_type: relationType,
    normalized_plan_pair: [...planPair].sort(),
    normalized_discriminator: String(discriminator || "").trim().toLowerCase(),
  };
}

export function buildPortfolioRelationKey(relationType, planPair, discriminator) {
  return `relation:${relationType}:${stableHash(buildRelationKeyMaterial(relationType, planPair, discriminator))}`;
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

export function buildPairwisePortfolioRelations(leftPlan, rightPlan) {
  const leftEnvelope = leftPlan.envelope;
  const rightEnvelope = rightPlan.envelope;
  const planPair = [leftEnvelope.plan_id, rightEnvelope.plan_id].sort();
  const overlapDiscriminators = [];

  for (const leftSurface of leftEnvelope.affected_surfaces) {
    for (const rightSurface of rightEnvelope.affected_surfaces) {
      if (surfacesOverlap(leftSurface, rightSurface)) {
        overlapDiscriminators.push(overlapDiscriminator(leftSurface, rightSurface));
      }
    }
  }

  const sharedArtifactClasses = artifactClassesForEnvelope(leftEnvelope)
    .filter((artifactClass) => artifactClassesForEnvelope(rightEnvelope).includes(artifactClass));

  if (overlapDiscriminators.length) {
    const relationType = sharedArtifactClasses.length
      ? PORTFOLIO_COORDINATION_STATUS_MERGE_CANDIDATE
      : PORTFOLIO_COORDINATION_STATUS_CONFLICT_REVIEW;
    return [...new Set(overlapDiscriminators)].sort().map((discriminator) => ({
      relation_key: buildPortfolioRelationKey(relationType, planPair, discriminator),
      relation_type: relationType,
      relation_confidence: portfolioRelationConfidence(relationType),
      status_reason: portfolioStatusReasonForRelation(relationType),
      plan_ids: planPair,
      plan_refs: [leftEnvelope.plan_ref, rightEnvelope.plan_ref].sort(),
      discriminator,
      overlap_basis: discriminator.split("|"),
      shared_foundations: [],
      shared_artifact_classes: [...new Set(sharedArtifactClasses)].sort(),
    }));
  }

  const sharedFoundations = foundationPrerequisitesForEnvelope(leftEnvelope)
    .filter((token) => foundationPrerequisitesForEnvelope(rightEnvelope).includes(token));
  if (sharedFoundations.length) {
    return [...new Set(sharedFoundations)].sort().map((discriminator) => ({
      relation_key: buildPortfolioRelationKey(
        PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE,
        planPair,
        discriminator,
      ),
      relation_type: PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE,
      relation_confidence: portfolioRelationConfidence(PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE),
      status_reason: portfolioStatusReasonForRelation(PORTFOLIO_COORDINATION_STATUS_SHARED_FOUNDATION_CANDIDATE),
      plan_ids: planPair,
      plan_refs: [leftEnvelope.plan_ref, rightEnvelope.plan_ref].sort(),
      discriminator,
      overlap_basis: [],
      shared_foundations: [discriminator],
      shared_artifact_classes: [],
    }));
  }

  const discriminator = "disjoint_surfaces";
  return [{
    relation_key: buildPortfolioRelationKey(PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE, planPair, discriminator),
    relation_type: PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE,
    relation_confidence: portfolioRelationConfidence(PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE),
    status_reason: portfolioStatusReasonForRelation(PORTFOLIO_COORDINATION_STATUS_PARALLEL_SAFE),
    plan_ids: planPair,
    plan_refs: [leftEnvelope.plan_ref, rightEnvelope.plan_ref].sort(),
    discriminator,
    overlap_basis: [],
    shared_foundations: [],
    shared_artifact_classes: [],
  }];
}

export function computePortfolioSummaryBasisFingerprint({
  envelopeFingerprint = "",
  coordinationStatus = PORTFOLIO_COORDINATION_STATUS_NOT_EVALUATED,
  statusReason = PORTFOLIO_STATUS_REASON_REFRESH_REQUIRED,
  primaryRelationKey = "",
  triggeringRelationKeys = [],
  relatedPlanRefs = [],
  portfolioId = "",
  portfolioVersion = "",
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
    portfolio_id: portfolioId,
    portfolio_version: portfolioVersion,
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
  portfolioId = PORTFOLIO_ID,
  portfolioVersion = PORTFOLIO_VERSION,
  lastRefreshedAt = "",
  sharedContractRef = PORTFOLIO_SHARED_CONTRACT_REF,
  advisoryNotes = [],
  artifactPath = "",
  artifactPresent = true,
  eligible = true,
} = {}) {
  return {
    coordination_status: coordinationStatus,
    status_reason: statusReason,
    primary_relation_key: primaryRelationKey,
    triggering_relation_keys: normalizeStringList(triggeringRelationKeys),
    related_plan_refs: normalizeStringList(relatedPlanRefs),
    portfolio_id: portfolioId,
    portfolio_version: portfolioVersion,
    last_refreshed_at: lastRefreshedAt,
    summary_valid: true,
    envelope_fingerprint: envelopeFingerprint,
    summary_basis_fingerprint: computePortfolioSummaryBasisFingerprint({
      envelopeFingerprint,
      coordinationStatus,
      statusReason,
      primaryRelationKey,
      triggeringRelationKeys,
      relatedPlanRefs,
      portfolioId,
      portfolioVersion,
      lastRefreshedAt,
      sharedContractRef,
      artifactPath,
      artifactPresent,
      eligible,
    }),
    shared_contract_ref: sharedContractRef,
    advisory_notes: normalizeStringList(advisoryNotes),
  };
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
    portfolioId: summary.portfolio_id,
    portfolioVersion: summary.portfolio_version,
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
    || summary.envelope_fingerprint !== envelopeFingerprint
    || summaryDrift;

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
