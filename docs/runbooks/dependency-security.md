# Dependency Security Runbook

## Goal

Keep Quest Agent on GitHub-native dependency monitoring so risky dependency changes are detected early, routed into review, and blocked from `main` when runtime severity is high enough to matter.

## Baseline Controls

- Repo settings should keep `Dependency graph`, `Dependabot alerts`, `Dependabot security updates`, and `Dependabot malware alerts` enabled.
- `.github/dependabot.yml` owns weekly Monday 09:00 JST update PR creation for npm dependencies and GitHub Actions.
- `.github/workflows/dependency-security.yml` runs on `main` pull requests, `main` pushes, and manual dispatch.
- `npm.cmd audit --omit=dev --audit-level=high` is the blocking runtime vulnerability gate.
- `scripts/dependency-guardrails.mjs` and `scripts/dependency-guardrails-allowlist.json` keep install-script packages on an explicit reviewed allowlist.

## Local Commands

- `npm.cmd run deps:guardrails:noprofile`
- `npm.cmd run audit:runtime:noprofile`
- `npm.cmd run security:verify:noprofile`

Use `npm.cmd ci` before these checks when you want a clean lockfile-faithful install.

## Alert Triage

1. Identify the alert source.
   - Separate vulnerable-package alerts, malware alerts, and regular Dependabot update PRs.
   - Separate npm packages from GitHub Actions updates.
2. Classify runtime impact.
   - Runtime `high` or `critical` findings are merge blockers and should stop promotion to `main`.
   - Dev-only findings are still triaged, but they do not block the runtime audit gate by default.
3. Contain first when the alert is severe.
   - For malware alerts or runtime `high` and `critical` alerts, pause merge work until the dependency is removed, patched, or explicitly rolled back.
4. Prefer the GitHub-managed remediation path.
   - Review the Dependabot security update PR when GitHub can generate one.
   - If GitHub cannot produce a safe patch automatically, open a manual fix PR that updates the manifest and lockfile together.
5. Review install-script changes explicitly.
   - If `package-lock.json` adds a new `hasInstallScript: true` package, or changes the version of a reviewed one, update `scripts/dependency-guardrails-allowlist.json` with the reviewed version and reason in the same PR.
   - Treat the allowlist diff as a human review checkpoint, not a routine regenerate step.
6. Re-run the repo checks before merge.
   - Run `npm.cmd run security:verify:noprofile` locally when possible.
   - Confirm the `Dependency Security` workflow is green on the PR.

## Repo Settings Checklist

If you do not have permission to change repository security settings directly, carry this checklist into the PR description or post-merge handoff:

- Enable `Dependency graph`
- Enable `Dependabot alerts`
- Enable `Dependabot security updates`
- Enable `Dependabot malware alerts`

## Operating Notes

- This repo is `private: true`, so npm publish hardening is intentionally out of scope for this baseline.
- `verify:noprofile` stays network-free and focused on lint, typecheck, and existing repo guardrails.
- The security lane intentionally uses GitHub for detection, notification, and update PR creation, while humans still own review and merge decisions.
