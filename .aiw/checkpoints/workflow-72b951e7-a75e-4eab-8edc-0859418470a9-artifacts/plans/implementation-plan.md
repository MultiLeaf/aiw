# End-to-end idea to merge-ready PR implementation

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Version: 1 (draft)
- Date: 2026-11-27

## Linked Requirements

- REQ-001: PR stage with merge-ready gate (specification §REQ-001)
- REQ-002: PRD as an optional stage (§REQ-002)
- REQ-003: QA test matrix wired into plan and verification (§REQ-003)
- REQ-004: ADR enforcement in technical-design (§REQ-004)
- REQ-005: PR-readiness completion report (§REQ-005)

## Tasks

- [ ] TASK-001: Stage model and artifact paths
  - Requirement: REQ-001, REQ-002 (foundations)
  - Code: src/types.ts (HUMAN_APPROVAL_STAGES += product-requirements, pr; PROCESSES.feature extended), src/human-approval.ts (STAGE_DEFINITIONS entries, both optional + requiresQualityGate), src/artifact-paths.ts (LEGACY_STAGE_PATHS entries)
  - Tests: src/types.test.ts / src/human-approval.test.ts stage-order and optionality checks; feature process walkthrough updated; bugfix/idea-assessment unchanged
  - Validation: `npx vitest run src/human-approval.test.ts src/artifact-paths.test.ts` → exit 0
  - Regression: existing process tests keep passing (bugfix/idea-assessment stage lists untouched)
  - Evidence: Record test output and changed files

- [ ] TASK-002: PRD stage — command, template, gate
  - Requirement: REQ-002
  - Code: src/workflow.ts (`aiw prd` command, brainstorm-pattern), resources/templates/product-requirements.md, src/quality-gates.ts (five-section gate for product-requirements)
  - Tests: prd scaffolding + gate pass/fail; skip mechanics work; specification proceeds when skipped
  - Validation: `npx vitest run src/cli.test.ts` → exit 0
  - Regression: brainstorm/spec commands unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-003: QA test matrix in plan and verification gates
  - Requirement: REQ-003
  - Code: src/quality-gates.ts (plan gate: TC-### cases each linked to REQ-###; verification gate: executed-case evidence with result + command), resources/templates/implementation-plan.md (Test Plan section), src/workflow.ts (trace: collect TC-### into tests arrays)
  - Tests: plan gate fails on missing/unlinked TC; verification gate fails on unexecuted/failing cases; trace graph includes TC entries
  - Validation: `npx vitest run src/quality-gates.test.ts src/cli.test.ts` → exit 0
  - Regression: plans without a Test Plan section — decide: legacy plans accepted unchanged (ratchet, like paired-verification) — covered by an explicit legacy-plan test
  - Evidence: Record test output and changed files

- [ ] TASK-004: ADR enforcement in technical-design gate
  - Requirement: REQ-004
  - Code: src/quality-gates.ts (Consequential Decisions section; each entry's ADR path must match .context/adrs/ADR-*.md and exist; explicit None passes), resources/templates/technical-design.md (section added)
  - Tests: gate fails on missing section, missing ADR file; passes with valid links and with None
  - Validation: `npx vitest run src/quality-gates.test.ts` → exit 0
  - Regression: existing technical-design reports without the section accepted (ratchet) — explicit test
  - Evidence: Record test output and changed files

- [ ] TASK-005: PR stage — command, template, gate
  - Requirement: REQ-001
  - Code: src/workflow.ts (`aiw pr` command scaffolding pr-readiness.md + printing host-side gh instructions), resources/templates/pr-readiness.md, src/quality-gates.ts (pr gate: sections + CI passed line, unresolved comments = 0, conflict check clean; auto-consume orchestration merge forecast when a checkpoint exists)
  - Tests: pr scaffolding; gate positive/negative for each criterion; forecast auto-consumption; workflow complete blocked until pr approved or human-skipped
  - Validation: `npx vitest run src/workflow-pr.test.ts src/cli.test.ts` → exit 0
  - Regression: workflow complete for processes without pr (bugfix) unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-006: PR-readiness completion report and skills guidance
  - Requirement: REQ-005
  - Code: src/completion-report.ts (optional PR block from approved pr-readiness.md; explicit no-PR line when skipped), resources/skills/pr-submission.md (new host guidance incl. triage of review comments), edits to resources/skills/implementation-planning.md, verification.md, technical-design.md
  - Tests: completion report with/without PR block; command-evidence parity for `aiw pr`/`aiw prd` mentions
  - Validation: `npx vitest run src/completion-report.test.ts src/command-evidence.test.ts` → exit 0
  - Regression: existing completion reports unchanged
  - Evidence: Record test output and changed files

## Validation Commands

- npm run check

## Risks and Dependencies

- Dependencies: TASK-001 first (stage model underpins all others); TASK-003 and TASK-004 can proceed in parallel after; TASK-005 after TASK-001; TASK-006 last (consumes pr-readiness.md).
- Risks:
  - Stage-list change can strand in-flight workflows — mitigation: ledger stores its process; only new workflows get the new list; doctor/repair covers drift; CHANGELOG entry.
  - New gate strictness breaks legacy artifacts — mitigation: ratchet pattern (legacy plans/designs without new sections pass) already proven by paired-verification.
  - Command-evidence parity test may flag new `aiw pr`/`aiw prd` mentions in skills — mitigation: add execution coverage in the same task (TASK-006).

## Completion Evidence

- TASK-001..006: fill in per task (commands run, output, changed files) after implementation.
