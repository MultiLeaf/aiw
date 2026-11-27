# Verification Report: Doctor drift rule and CHANGELOG

- Workflow ID: 18b9fdaa-7a62-4502-9a54-737cfafe9107
- Ticket: AIW-001
- Date: 2026-11-27

## Requirements Checked

- REQ-001: Doctor detects stage-list drift.
- REQ-002: Doctor applies the recorded-skip repair on request.
- REQ-003: CHANGELOG entry for the stage-list change.
- NFR-001 (safety: never invent approvals), NFR-002 (doctor without flags unchanged).

## Checks Passed

- `npx vitest run` (full suite): 802 tests passed, 0 failures.
- `npm run check` (format:check + eslint + tsc + build + vitest + security:check) → exit 0.
- `aiw verify` → "Verification passed: requirements have acceptance criteria and validation coverage."
- REQ-001 acceptance: doctor reports the drifted stage ("specification is decided but its prerequisites are unresolved: product-requirements") with the repair command and exits 1 — proven by src/doctor-drift.test.ts on a ledger that predates the stage-list change.
- REQ-002 acceptance: doctor --fix records the skip with the drift reason; the repaired ledger passes strict validation and `aiw status` works (no out-of-order error); decided stages are untouched; an existing record is never overwritten (`recordDriftSkip` throws); a required unresolved prerequisite refuses with "cannot skip required stage" naming the stage.
- REQ-003 acceptance: CHANGELOG [Unreleased] states the two new feature-process stages, the drift migration path (aiw doctor / doctor --fix), and that workflow complete now requires the pr stage; trust-boundaries documents the repair's safety; prettier format check passes on both files.
- NFR-001: the fix path only inserts skip records via recordDriftSkip, which refuses existing records; decided stages are never written — asserted by test and by code path inspection.
- NFR-002: doctor without flags on a healthy project prints "AI Workflow health check passed" exactly as before; strict parseApprovalLedger default unchanged (all pre-existing ledger tests pass).
- Genericity constraint: detection derives drift from processStages + getUnresolvedPrerequisites with no hard-coded stage names; the required/optional distinction uses stageDefinition — future PROCESSES changes are covered by the same rule.

## Missing Evidence

None.

## Residual Risks

- Doctor's workflow-state check runs only when workflow.yml exists and is active — abandoned workflows with drifted ledgers are not flagged (acceptable: they are inert).
- The repair records skips only; a drifted ledger whose new prerequisite is required needs the stage to actually run (by design).

## Decision

Complete.

## Test Results

- TC-001: drift diagnosis pass (REQ-001) — `npx vitest run src/doctor-drift.test.ts` pass
- TC-002: healthy regression pass (NFR-002) — `npx vitest run src/doctor-drift.test.ts` pass
- TC-003: repair + strict reload pass (REQ-002) — `npx vitest run src/doctor-drift.test.ts` pass
- TC-004: required-stage refusal pass (REQ-002) — `npx vitest run src/doctor-drift.test.ts` pass
- TC-005: docs format pass (REQ-003) — `npx prettier --check CHANGELOG.md docs/trust-boundaries.md` pass

## Validation

- TASK-001: Validation: `npx vitest run src/doctor-drift.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/doctor-drift.test.ts` → exit 0
- TASK-003: Validation: `npx prettier --check CHANGELOG.md docs/trust-boundaries.md` → exit 0
