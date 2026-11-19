# Implementation Plan: Bounded Research Skill

> Ticket: RES-001
> Requirements: `.aiw/generated/specs/f83c066d-0084-42fb-b501-02c78949f5bd/specification.md` (REQ-001 … REQ-005)

## Ordered Tasks

### TASK-001: `resources/skills/research.md` skill contract

- Requirement: REQ-001, REQ-002, REQ-003, REQ-004
- Code: new `resources/skills/research.md` — scope gate (single question + explicit sources, human confirmation when vague), step/turn budget with stop conditions and escalation, evidence-first citation rules (file:line / log line with timestamp / URL + consultation date; fact/hypothesis/unverified states; uncited → open question), secret-redaction before external queries or persistence, artifact assembly at `.aiw/generated/reports/<workflowId>/research.md`, light-lane recording via `aiw task evidence`, workflow-less runs instructed to start a light-lane task first.
- Tests: extend `src/adapter-contract.test.ts` (or the generated-skill eval suite) — the skill is present, English, contract-valid; contract invariants (scope gate, budget, citation, redaction sections) checked by the eval contract for packaged skills.
- Validation: npx vitest run src/adapter-contract.test.ts → exit 0
- Evidence: assertions on packaged presence, language, and the required contract sections

### TASK-002: Recommendation engine entry

- Requirement: REQ-005
- Code: `src/recommendations.ts` — new capability `bounded-research` (universal, advisory) offering `skills/research`; rationale names the evidence-first contract; matches on project signals like existing workflow capabilities.
- Tests: extend `src/recommendations.test.ts` — capability appears with `skills/research`; selection installs the skill resource (covered by existing sync paths).
- Validation: npx vitest run src/recommendations.test.ts → exit 0
- Evidence: recommendation assertions and resource reference

### TASK-003: Docs + backlog

- Requirement: REQ-005
- Code: `README.md` skills list line; `docs/backlog.md` RES-001 entry.
- Validation: npm run check → exit 0
- Evidence: docs mention the research skill; full pipeline green

## Regression

- No CLI/settings changes; packaged-resources validation and eval suites stay green; full `npm run check` passes.
