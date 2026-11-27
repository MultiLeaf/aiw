# Hardening follow-ups implementation

- Workflow ID: a5748466-09dc-40fd-8014-5b8158298375
- Ticket: AIW-002
- Version: 1 (draft)
- Date: 2026-11-27

## Linked Requirements

- REQ-001: PR gate consumes the matching orchestration plan (specification §REQ-001)
- REQ-002: Plan gate accepts REQ links on wrapped TC lines (§REQ-002)
- REQ-003: PR-readiness section extraction tolerates code fences (§REQ-003)
- REQ-004: Observe log uses YAML like sibling checkpoints (§REQ-004)
- REQ-005: Rules-candidates rescan preserves manual entries (§REQ-005)

## Tasks

- [ ] TASK-001: Forecast targeting in the pr gate
  - Requirement: REQ-001
  - Code: src/workflow.ts (pr-gate branch: read the report's Branch section, match plan id from checkpoint filename against the declared branch prefix, iterate checkpoints/plans, skip on no match)
  - Tests: src/workflow-pr.test.ts extended (multi-plan: matching consumed, non-matching skipped; single-plan regression; no-match fallback)
  - Validation: `npx vitest run src/workflow-pr.test.ts` → exit 0
  - Regression: the existing conflict auto-consumption test still passes
  - Evidence: Record test output and changed files

- [ ] TASK-002: Wrapped-line TC linkage
  - Requirement: REQ-002
  - Code: src/quality-gates.ts (plan branch: case entry = TC line + indented following lines; regex over the entry)
  - Tests: src/quality-gates.test.ts extended (wrapped REQ passes; unlinked still fails; same-line unchanged)
  - Validation: `npx vitest run src/quality-gates.test.ts` → exit 0
  - Regression: existing TC matrix tests unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-003: Fence-tolerant section extraction
  - Requirement: REQ-003
  - Code: src/completion-report.ts (fence-aware line scanner in prReadinessSection's extract)
  - Tests: src/completion-report.test.ts extended (fenced ## included; fence-free identical)
  - Validation: `npx vitest run src/completion-report.test.ts` → exit 0
  - Regression: existing PR section tests unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-004: Observe log as YAML
  - Requirement: REQ-004
  - Code: src/workflow.ts (recordObserveDecision: YAML write to .yml, legacy .json migration, cap unchanged)
  - Tests: src/workflow-observe.test.ts updated (YAML path asserted; legacy JSON migrated losslessly and removed; cap)
  - Validation: `npx vitest run src/workflow-observe.test.ts` → exit 0
  - Regression: observe behavior (no state changes) unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-005: Rules-candidates manual-entry preservation
  - Requirement: REQ-005
  - Code: src/workflow.ts (scan branch merges prior non-clustered entries), src/rules-candidates.test.ts extended
  - Tests: manual entry survives rescan; dismissed status survives cluster reappearance
  - Validation: `npx vitest run src/rules-candidates.test.ts` → exit 0
  - Regression: clustering/status-preservation tests unchanged
  - Evidence: Record test output and changed files

## Validation Commands

- npm run check

## Risks and Dependencies

- Dependencies: all five tasks are independent; implement in numerical order for review convenience.
- Risks: branch-prefix heuristics (fallback is evidence, never a false block); wrapped-line over-merge (indented-continuation requirement); corrupt legacy JSON (falls back to empty as today).

## Completion Evidence

- TASK-001..005: fill in per task (commands run, output, changed files) after implementation.
