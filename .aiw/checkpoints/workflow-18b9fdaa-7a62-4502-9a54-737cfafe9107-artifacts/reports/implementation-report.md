# Implementation Report: Doctor drift rule and CHANGELOG

- Workflow ID: 18b9fdaa-7a62-4502-9a54-737cfafe9107
- Ticket: AIW-001
- Date: 2026-11-27
- Source: Implementation plan v1 (approved), TASK-001..TASK-003

## Changed Files

- src/human-approval.ts — TASK-001: `detectStageListDrift` (generic prerequisite-drift detection), `parseApprovalLedgerLenient` (options-based lenient load; strict default unchanged); TASK-002: `recordDriftSkip` (skip-record insertion that refuses to overwrite existing records).
- src/workflow.ts — TASK-001/002: doctor branch gains the workflow-state drift check (diagnosis with stage names + repair command, exit 1) and `aiw doctor [--fix]` (repairs optional prerequisites with recorded skips, re-validates, refuses required stages, never overwrites records, never touches decided stages).
- src/doctor-drift.test.ts — new suite (5 tests: diagnosis, healthy regression, repair + strict re-load + status, required-stage refusal, usage guard).
- CHANGELOG.md — TASK-003: [Unreleased] Added (end-to-end PR flow, QA matrix, ADR enforcement, post-PR patterns, doctor drift rule) and Changed (feature stage list + drift guidance + completion requiring pr).
- docs/trust-boundaries.md — TASK-003: doctor --fix never invents approvals line.

## Tests

- TASK-001: doctor reports drift naming specification/product-requirements and prints the repair command, exit 1; healthy project output unchanged (NFR-002).
- TASK-002: doctor --fix records the product-requirements skip with the drift reason; the repaired ledger passes strict validation (doctor + status exit 0); decided stages untouched; required-prerequisite drift refuses with "cannot skip required stage"; unknown flags rejected.
- TASK-003: prettier format check on CHANGELOG.md and docs/trust-boundaries.md (part of npm run check).
- Regression: full suite 802 tests passing; strict `parseApprovalLedger` default unchanged (all existing ledger tests pass).

## Validation

- TASK-001: Validation: `npx vitest run src/doctor-drift.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/doctor-drift.test.ts` → exit 0
- TASK-003: Validation: `npx prettier --check CHANGELOG.md docs/trust-boundaries.md` → exit 0
- Full project quality: `npm run check` (format:check + lint + typecheck + build + vitest 802 + security:check) → exit 0.

## Deviations

None — the design was followed as approved; the lenient load is implemented as an options flag on `parseApprovalLedger` (exported wrapper `parseApprovalLedgerLenient`) rather than a separate reader, which is strictly simpler and reuses all validation.

## Requirements Implemented

- REQ-001: doctor diagnoses stage-list drift with actionable output and non-zero exit.
- REQ-002: doctor --fix repairs optional-prerequisite drift with recorded skips; required prerequisites refused; no invented approvals.
- REQ-003: CHANGELOG [Unreleased] entries covering the stage-list change and its migration path; trust-boundaries note.
