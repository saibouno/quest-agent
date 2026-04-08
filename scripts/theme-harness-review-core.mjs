import { parseMarkdownSections, readSummaryField } from "./theme-harness-lib.mjs";
import {
  PORTFOLIO_COORDINATION_SECTION,
  validatePortfolioEnvelopeSection,
} from "./theme-portfolio-contract.mjs";

export const CHECKLIST_VERSION = 4;

function readPublishBoundary(summarySection) {
  return readSummaryField(summarySection, "Publish / handoff boundary")
    || readSummaryField(summarySection, "Publish boundary")
    || readSummaryField(summarySection, "Handoff boundary");
}

const CHECKS = [
  {
    item_id: "scope_right_sized",
    label: "scope right-sized",
    finding_code: "overscoped_v1_plan",
    passes(sections) {
      return !looksOverscopedV1Plan(sections);
    },
    failure: "Plan appears overscoped for a bounded v1 theme.",
  },
  {
    item_id: "out_of_scope_present",
    label: "out of scope present",
    finding_code: "",
    passes(sections) {
      return Boolean(String(sections["Out Of Scope"] || "").trim());
    },
    failure: "`## Out Of Scope` is missing or empty.",
  },
  {
    item_id: "done_condition_is_testable",
    label: "done condition is testable",
    finding_code: "missing_done_condition",
    passes(sections) {
      return Boolean(readSummaryField(sections.Summary || "", "Done condition"));
    },
    failure: "Summary is missing a concrete done condition.",
  },
  {
    item_id: "approval_boundary_explicit",
    label: "approval boundary explicit",
    finding_code: "missing_approval_boundary",
    passes(sections) {
      return Boolean(String(sections["Approval Boundary"] || "").trim());
    },
    failure: "`## Approval Boundary` is missing or empty.",
  },
  {
    item_id: "no_unresolved_placeholder",
    label: "no unresolved placeholder",
    finding_code: "unresolved_placeholder",
    passes(sections, markdown) {
      return !/(<fill:[^>]+>|\{\{[^}]+\}\}|TBD)/i.test(markdown);
    },
    failure: "Plan still contains unresolved placeholders.",
  },
  {
    item_id: "hot_file_shared_core_risk_addressed",
    label: "hot file/shared-core risk addressed",
    finding_code: "missing_shared_core_or_hot_file_risk",
    passes(sections) {
      return Boolean(readSummaryField(sections.Summary || "", "Shared-core / hot-file risk"));
    },
    failure: "Summary is missing the shared-core / hot-file risk line.",
  },
  {
    item_id: "merge_policy_explicit",
    label: "merge policy explicit",
    finding_code: "missing_merge_policy",
    passes(sections) {
      return Boolean(readSummaryField(sections.Summary || "", "Merge Policy"));
    },
    failure: "Summary is missing a concrete merge policy.",
  },
  {
    item_id: "rollback_class_explicit",
    label: "rollback class explicit",
    finding_code: "missing_rollback_class",
    passes(sections) {
      return Boolean(readSummaryField(sections.Summary || "", "Rollback Class"));
    },
    failure: "Summary is missing a concrete rollback class.",
  },
  {
    item_id: "publish_boundary_explicit",
    label: "publish / handoff boundary explicit",
    finding_code: "missing_publish_boundary",
    passes(sections) {
      return Boolean(readPublishBoundary(sections.Summary || ""));
    },
    failure: "Summary is missing a concrete publish / handoff boundary.",
  },
  {
    item_id: "verification_command_concrete",
    label: "verification command concrete",
    finding_code: "missing_verify_command",
    passes(sections) {
      const testPlan = String(sections["Test Plan"] || "");
      return /`[^`]+`/.test(testPlan) || /(npm\.cmd|node\s+scripts\/|pnpm\s|yarn\s)/i.test(testPlan);
    },
    failure: "Test plan does not contain an explicit verification command.",
  },
  {
    item_id: "portfolio_coordination_envelope_valid",
    label: "portfolio coordination envelope valid",
    finding_code: "",
    passes(sections) {
      const result = validatePortfolioEnvelopeSection(sections[PORTFOLIO_COORDINATION_SECTION] || "");
      return result.ok;
    },
    failure(sections) {
      const result = validatePortfolioEnvelopeSection(sections[PORTFOLIO_COORDINATION_SECTION] || "");
      return result.message || "Portfolio coordination envelope is invalid.";
    },
  },
];

export function looksOverscopedV1Plan(sections) {
  const haystack = [
    sections.Summary || "",
    sections["Key Changes"] || "",
    sections["Important Interfaces"] || "",
  ].join("\n").toLowerCase();

  const overscopeSignals = [
    "phase 2",
    "phase ii",
    "phase iii",
    "multiple repos",
    "cross-repo",
    "golden-set eval",
    "progress_surface",
    "event_log",
    "observability",
    "model_policy",
  ];

  const bulletCount = (sections["Key Changes"] || "").split("\n").filter((line) => /^-\s+/.test(line)).length;

  return overscopeSignals.some((signal) => haystack.includes(signal)) || bulletCount > 12;
}

export function evaluatePlanMarkdown(markdown) {
  const normalized = String(markdown || "");
  const sections = parseMarkdownSections(normalized);
  const findingCodes = [];
  const checklistResults = [];

  for (const item of CHECKS) {
    const passed = Boolean(item.passes(sections, normalized));
    if (!passed) {
      if (item.finding_code) {
        findingCodes.push(item.finding_code);
      } else if (item.item_id === "portfolio_coordination_envelope_valid") {
        const result = validatePortfolioEnvelopeSection(sections[PORTFOLIO_COORDINATION_SECTION] || "");
        if (result.finding_code) {
          findingCodes.push(result.finding_code);
        }
      }
    }
    checklistResults.push({
      item_id: item.item_id,
      label: item.label,
      result: passed ? "pass" : "fail",
      message: passed ? "" : typeof item.failure === "function" ? item.failure(sections, normalized) : item.failure,
    });
  }

  return {
    schema_version: CHECKLIST_VERSION,
    result: findingCodes.length ? "revise_required" : "pass",
    checklist_results: checklistResults,
    finding_codes: [...new Set(findingCodes.filter(Boolean))],
  };
}

export function evaluatePlanSections(sections) {
  const markdown = Object.entries(sections)
    .map(([heading, content]) => `## ${heading}\n\n${String(content || "").trim()}\n`)
    .join("\n");
  return evaluatePlanMarkdown(markdown);
}
