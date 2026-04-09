# Theme Loop Review Checklist

Checklist version: 4

Use this checklist through `node scripts/theme-harness.mjs review-plan --slug <slug>`.

## Deterministic Checks

- `scope_right_sized` | scope right-sized | `overscoped_v1_plan`
  - The plan keeps a bounded v1 surface and does not silently widen ownership.
- `out_of_scope_present` | out of scope present | -
  - `## Out Of Scope` exists and is not empty.
- `done_condition_is_testable` | done condition is testable | `missing_done_condition`
  - `## Summary` includes a concrete done condition.
- `approval_boundary_explicit` | approval boundary explicit | `missing_approval_boundary`
  - `## Approval Boundary` exists and is not empty.
- `no_unresolved_placeholder` | no unresolved placeholder | `unresolved_placeholder`
  - The generated plan does not keep any `<fill:...>`, `{{...}}`, or `TBD` placeholders.
- `hot_file_shared_core_risk_addressed` | hot file/shared-core risk addressed | `missing_shared_core_or_hot_file_risk`
  - `## Summary` includes `Shared-core / hot-file risk`.
- `merge_policy_explicit` | merge policy explicit | `missing_merge_policy`
  - `## Summary` includes `Merge Policy`.
- `rollback_class_explicit` | rollback class explicit | `missing_rollback_class`
  - `## Summary` includes `Rollback Class`.
- `publish_boundary_explicit` | publish / handoff boundary explicit | `missing_publish_boundary`
  - `## Summary` includes `Publish / handoff boundary`.
- `verification_command_concrete` | verification command concrete | `missing_verify_command`
  - `## Test Plan` includes at least one explicit verification command.
- `portfolio_coordination_envelope_valid` | portfolio coordination envelope valid | `missing_portfolio_coordination_envelope` / `portfolio_coordination_invalid_json` / `portfolio_coordination_missing_required_field` / `portfolio_coordination_raw_token` / `portfolio_coordination_invalid_namespace` / `portfolio_coordination_invalid_value`
  - `## Portfolio Coordination Envelope` exists as a single fenced `json` object and passes the mothership-aligned Layer 2 contract, including canonical namespaces and numeric `surface_confidence`.

## Machine Review Notes

- v1 review is a deterministic structure-and-evidence gate only.
- It checks required headings, required summary fields, placeholder leakage, and explicit verification commands.
- It does not score prose quality and does not run an LLM judge.
- The machine-readable checklist order is canonical for `checklist_results` and `finding_codes`.
