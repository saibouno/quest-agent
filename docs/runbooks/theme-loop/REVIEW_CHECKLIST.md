# Theme Loop Review Checklist

Checklist version: 1

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
- `verification_command_concrete` | verification command concrete | `missing_verify_command`
  - `## Test Plan` includes at least one explicit verification command.

## Machine Review Notes

- v1 review is a deterministic structure-and-evidence gate only.
- It checks required headings, required summary fields, placeholder leakage, and explicit verification commands.
- It does not score prose quality and does not run an LLM judge.
- The machine-readable checklist order is canonical for `checklist_results` and `finding_codes`.
