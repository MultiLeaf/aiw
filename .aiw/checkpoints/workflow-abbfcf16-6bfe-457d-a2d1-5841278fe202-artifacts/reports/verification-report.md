# Verification Report: Policy path rules with strictest-wins enforcement

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Date: 2026-11-27

## Requirements Checked

- REQ-001: Path rules in the organization policy.
- REQ-002: policy-check resolves changed paths through the resolver.
- REQ-003: Recorded human approval for strict paths.
- REQ-004: Automated results are capped by the resolver.
- NFR-001 (additive schema), NFR-002 (trust boundaries), NFR-003 (determinism).

## Checks Passed

- `npx vitest run` (full suite): 821 tests passed, 0 failures.
- `npm run check` (format:check + eslint + tsc + build + vitest + security:check) → exit 0.
- `aiw verify` → "Verification passed: requirements have acceptance criteria and validation coverage."
- REQ-001 acceptance: rules with all four decisions parse and round-trip; `always-require-human: true` normalizes; invalid decision, duplicate id, empty paths, >64 rules, and non-block rules produce actionable errors; a policy without rules parses and enforces exactly as today (test-asserted byte-identical output).
- REQ-002 acceptance: every changed path resolves through `resolvePolicy` — the deny path fails naming the path, matched rules, and "deny is not satisfiable by approval"; require-approval/always-require-human fail with the exact `aiw policy approve --paths=` continuation; equal-strictness and strictest-match determinism covered by the resolver suite; non-git fallback evaluates package manifest paths (blocked strict path `skills/base.md`); no-paths case passes with the explicit advisory; no-runs regression identical.
- REQ-003 acceptance: approving `src/auth/*` does not satisfy `src/billing/*`; a subsequent change (new path) invalidates the fingerprint and re-blocks; `deny` remains blocked even with a recorded approval; coverage requires both pattern match and exact fingerprint.
- REQ-004 acceptance: `--advisory=allow` on an approved strict path reports `require-approval → allow` with "verdict unchanged"; the advisory cannot make an unapproved check pass; `--advisory=deny` never produces `→ deny` (capped); invalid advisory values rejected — `applyAutomatedResult` is now consumed on a real enforcement path.
- NFR-001: flat fields untouched; both shapes validate wherever `parseOrganizationPolicy` is used (existing suites pass).
- NFR-002: the approval is a deliberate human command writing only checkpoint state; the advisory never alters the verdict; deny is structurally unsatisfiable (the deny branch never consults approvals) — trust-boundaries doc updated.
- NFR-003: `changeFingerprint` is order-independent and path-set sensitive; identical policy + change yields the identical verdict (pure resolution over sorted paths).

## Missing Evidence

None.

## Residual Risks

- `.aiw/` exclusion from changed paths means a policy rule targeting `.aiw/*` never matches — documented, semantically intended (workflow state is not project surface).
- Fresh clones without origin refs degrade to uncommitted+untracked evaluation — conservative (fewer paths evaluated), documented in the deviation.

## Decision

Complete.

## Test Results

- TC-001: rules schema validation pass (REQ-001) — `npx vitest run src/organization-policy.test.ts` pass
- TC-002: changedPaths collection pass (REQ-002) — `npx vitest run src/policy-paths.test.ts` pass
- TC-003: deny blocks unconditionally pass (REQ-002) — `npx vitest run src/policy-check-rules.test.ts` pass
- TC-004: scoped approvals + fingerprint invalidation pass (REQ-003) — `npx vitest run src/policy-approvals.test.ts src/policy-check-rules.test.ts` pass
- TC-005: advisory caps and verdict invariance pass (REQ-004) — `npx vitest run src/policy-check-rules.test.ts` pass
- TC-006: flat policy regression pass (NFR-001) — `npx vitest run src/policy-check-rules.test.ts` pass

## Validation

- TASK-001: Validation: `npx vitest run src/organization-policy.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/policy-paths.test.ts` → exit 0
- TASK-003: Validation: `npx vitest run src/policy-check-rules.test.ts` → exit 0
- TASK-004: Validation: `npx vitest run src/policy-approvals.test.ts src/policy-check-rules.test.ts` → exit 0
- TASK-005: Validation: `npx vitest run src/policy-check-rules.test.ts` → exit 0
