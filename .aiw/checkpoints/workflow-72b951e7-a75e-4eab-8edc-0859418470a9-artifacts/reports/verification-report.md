# Verification Report: End-to-end idea to merge-ready PR

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Date: 2026-11-27

## Requirements Checked

- REQ-001: PR stage with merge-ready gate (`aiw pr`, gate criteria, forecast auto-consumption, completion blocking).
- REQ-002: PRD as an optional stage (`aiw prd`, template, gate, skip mechanics).
- REQ-003: QA test matrix wired into plan and verification gates; TC links in traceability.
- REQ-004: ADR enforcement in the technical-design gate.
- REQ-005: PR-readiness completion report section.
- NFR-001..004: portability, backwards compatibility, human gates, trust boundaries.

## Checks Passed

- `npx vitest run` (full suite): 96+ files, 797 tests passed, 0 failures.
- `npm run check` (format:check + eslint + tsc + build + vitest + security:check) → exit 0.
- `aiw verify` → "Verification passed: requirements have acceptance criteria and validation coverage."
- REQ-001 acceptance: workflow-pr.test.ts proves the `aiw pr` scaffold prints host-side instructions the CLI never executes; the gate fails on placeholder/incomplete reports (missing PR reference, failing CI, unresolved comments, conflicts, unchecked checklist) and passes ready reports; the orchestration forecast is auto-consumed and blocks on a real conflicting git branch; `workflow complete` is blocked until the pr stage is approved or skipped.
- REQ-002 acceptance: quality-gates.test.ts proves the five-section PRD gate (positive/negative); cli.test.ts full-stage-run gates and approves the PRD stage; skip mechanics work (used across every test that skips it); specification proceeds identically when skipped (all legacy walkthroughs skip it and pass).
- REQ-003 acceptance: quality-gates.test.ts proves plan gate failures (missing TC cases, unlinked cases) and verification failures (failing/unrecorded cases), plus ratchet cases for legacy artifacts; the trace graph collects TC-### entries into requirement `tests` arrays (traceability change + passing trace tests).
- REQ-004 acceptance: adr-gate.test.ts proves the gate blocks when a linked ADR file does not exist and passes after creating it with `aiw adr`; quality-gates.test.ts covers the `None` pass and missing-link failure; legacy designs without the section pass (ratchet).
- REQ-005 acceptance: completion-report.test.ts proves the PR readiness section appears with extracted evidence when the pr stage is approved, a status line when skipped, and is absent for workflows without a pr stage.
- NFR-001: no forge code in the CLI — the `aiw pr` output explicitly marks host-side steps; verified by test assertion.
- NFR-002: bugfix/idea-assessment stage lists untouched (human-approval.test.ts); all pre-existing suites pass (updated only where the feature stage order legitimately changed).
- NFR-003: both new stages require human approval (STAGE_DEFINITIONS) and the pr skill states the merge decision stays human.
- NFR-004: no new network/subprocess surface in the CLI (forecast re-use is local git, wrapped in try/catch fallback).

## Missing Evidence

None.

## Residual Risks

- Forecast auto-consumption reads the first orchestration checkpoint with a matching `orchestration.yml`; multi-plan repositories should confirm the plan matches the PR branch (documented deviation).
- PR-report evidence (CI result, unresolved count) is host-recorded; the human verifies against the forge at merge — consistent with trust boundaries.
- Legacy artifacts pass via ratchet; new strictness applies only to artifacts that declare the new sections.

## Decision

Complete.

## Validation

- TASK-001: Validation: `npx vitest run src/human-approval.test.ts src/artifact-paths.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/cli.test.ts` → exit 0
- TASK-003: Validation: `npx vitest run src/quality-gates.test.ts src/cli.test.ts` → exit 0
- TASK-004: Validation: `npx vitest run src/quality-gates.test.ts` → exit 0
- TASK-005: Validation: `npx vitest run src/workflow-pr.test.ts src/cli.test.ts` → exit 0
- TASK-006: Validation: `npx vitest run src/completion-report.test.ts src/command-evidence.test.ts` → exit 0

## Test Results

- TC-001: gate content checks pass (REQ-001) — `npx vitest run src/workflow-pr.test.ts` pass
- TC-002: merge-ready gate and completion blocking pass (REQ-001) — `npx vitest run src/workflow-pr.test.ts` pass
- TC-003: forecast auto-consumption blocks conflicts pass (REQ-001) — `npx vitest run src/workflow-pr.test.ts` pass
- TC-004: PRD gate pass (REQ-002) — `npx vitest run src/quality-gates.test.ts` pass
- TC-005: QA matrix plan/verification gates pass (REQ-003) — `npx vitest run src/quality-gates.test.ts` pass
- TC-006: ADR enforcement pass (REQ-004) — `npx vitest run src/adr-gate.test.ts` pass
- TC-007: completion PR section pass (REQ-005) — `npx vitest run src/completion-report.test.ts` pass
- TC-008: full regression pass (REQ-001..005) — `npx vitest run` pass
