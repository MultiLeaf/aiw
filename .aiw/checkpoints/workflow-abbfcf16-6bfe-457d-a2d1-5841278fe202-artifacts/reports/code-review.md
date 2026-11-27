# Code Review: Policy path rules with strictest-wins enforcement

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Date: 2026-11-27

## Scope

The TASK-001..TASK-005 diff: rules schema (src/organization-policy.ts), changedPaths/pattern matcher (src/policy-gate.ts), policy approvals module (src/policy-approvals.ts, new), policy-check enforcement + policy approve + advisory (src/workflow.ts), four test suites, CHANGELOG, docs/trust-boundaries.md.

## Findings

- F-1 (minor, behavior): the rules block parser slices the file at the first `^rules:` line and hands the remainder to the YAML parser — a trailing unrelated block after `rules:` would be absorbed silently. Bounded: the serializer never writes such a file, and `organization-policy --file=` is the validated entry point. triage: judgment-required
- F-2 (minor, robustness): `changedPaths` runs three git commands on every policy-check; on very large repos with many untracked files the untracked list can be long. Not a correctness issue; path count is reported in the summary. triage: auto-fixable
- F-3 (info, semantics): a rule targeting `.aiw/*` can never match because changedPaths excludes `.aiw/` state. Intentional (documented deviation); a policy author could be surprised — worth a doc line in a follow-up. triage: judgment-required
- F-4 (info): approval records accumulate up to 50 with oldest dropped; there is no way to list or revoke approvals. Follow-up candidate (`aiw policy approvals` list/revoke). triage: judgment-required

## Checks

- Full suite: 821 tests pass, including 16 new tests across four suites.
- `npm run check` (format, eslint, tsc, build, vitest, security) → exit 0.
- Safety review: the deny branch never consults approvals (structurally unsatisfiable); approvals are scoped by pattern + fingerprint and are pure checkpoint state (the policy file is never written by the CLI); the advisory path applies `applyAutomatedResult` and cannot alter the verdict; automated signals can never raise above require-approval.
- Determinism review: fingerprints are order-independent; resolution is pure over sorted paths; identical inputs yield identical verdicts.
- Resolver reuse: strictness semantics come entirely from the exported, pre-tested resolver — no reimplementation.
- Regression: flat policies enforce exactly as before (byte-identical output test); existing policy/lock/organization suites pass.

## Residual Risks

- None blocking. F-1 is serializer-bounded; F-2 is performance-only; F-3/F-4 are documented follow-up candidates.

## Decision

Accept — the safety-critical properties (deny unsatisfiable, approvals scoped and fingerprinted, advisory verdict-invariant, resolver reused) are all test-covered; findings are informational.
