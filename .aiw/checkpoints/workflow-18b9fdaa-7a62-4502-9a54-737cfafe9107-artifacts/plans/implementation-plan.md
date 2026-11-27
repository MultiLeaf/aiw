# Doctor drift rule and CHANGELOG implementation

- Workflow ID: 18b9fdaa-7a62-4502-9a54-737cfafe9107
- Ticket: AIW-001
- Version: 1 (draft)
- Date: 2026-11-27

## Linked Requirements

- REQ-001: Doctor detects stage-list drift (specification §REQ-001)
- REQ-002: Doctor applies the recorded-skip repair on request (§REQ-002)
- REQ-003: CHANGELOG entry for the stage-list change (§REQ-003)

## Tasks

- [ ] TASK-001: Drift detection helper and doctor diagnosis
  - Requirement: REQ-001
  - Code: src/human-approval.ts (export `detectStageListDrift` + lenient stage reader), src/workflow.ts (doctor branch: workflow-state check, drift report with stage names and repair command, exit 1)
  - Tests: src/doctor-drift.test.ts (doctor reports drift, exit 1; no false positives on clean ledgers; doctor without drift unchanged — NFR-002 regression)
  - Validation: `npx vitest run src/doctor-drift.test.ts` → exit 0
  - Regression: doctor passing-state output identical for healthy projects (existing doctor tests)
  - Evidence: Record test output and changed files

- [ ] TASK-002: Doctor --fix repair
  - Requirement: REQ-002
  - Code: src/workflow.ts (`doctor --fix`: lenient load, insert skip records for unresolved prerequisites of decided stages, re-check, serialize; refuse required prerequisites with actionable message), src/human-approval.ts (skip-record insertion helper reusing withStage semantics)
  - Tests: src/doctor-drift.test.ts (fix inserts skips and doctor passes afterwards; decided stages untouched; existing prerequisite records never overwritten; required new prerequisite refuses)
  - Validation: `npx vitest run src/doctor-drift.test.ts` → exit 0
  - Regression: `aiw repair` command unchanged; skip semantics reused, no schema change
  - Evidence: Record test output and changed files

- [ ] TASK-003: CHANGELOG entry and trust-boundaries note
  - Requirement: REQ-003
  - Code: CHANGELOG.md ([Unreleased] Added/Changed entries), docs/trust-boundaries.md (one line: doctor --fix never invents approvals)
  - Tests: none (docs); prettier format check
  - Validation: `npx prettier --check CHANGELOG.md docs/trust-boundaries.md` → exit 0
  - Regression: none
  - Evidence: Record changed files

## Validation Commands

- npm run check

## Risks and Dependencies

- Dependencies: TASK-001 before TASK-002 (detection feeds the fix); TASK-003 independent.
- Risks: lenient reader divergence (mitigated by reusing parseStageRecord per stage); doctor exit-code strictness may affect scripts (documented in design; contract is "exit 0 only when healthy").

## Completion Evidence

- TASK-001..003: fill in per task (commands run, output, changed files) after implementation.
