# Post-PR automation patterns implementation

- Workflow ID: 4f3eab42-53fd-40f0-8b70-53abab066342
- Version: 1 (draft)
- Date: 2026-11-27

## Linked Requirements

- REQ-001: Gate observe mode (specification §REQ-001)
- REQ-002: Bounded retry with escalation on gate rejections (§REQ-002)
- REQ-003: Rejection-reason persistence loop (§REQ-003)
- REQ-004: Finding triage classification (§REQ-004)
- REQ-005: Trust-boundary documentation (§REQ-005)
- REQ-006: Policy conflict semantics (§REQ-006)

## Tasks

- [ ] TASK-001: Gate observe mode
  - Requirement: REQ-001
  - Code: src/workflow.ts (gate handler: `--observe` option; additive `observeDecisions[]` checkpoint field, cap 20), src/cli.ts (flag), src/human-gates.test.ts / src/workflow-observe.test.ts
  - Tests: new observe-mode tests (pass & fail artifact cases; state/approvals untouched)
  - Validation: `npx vitest run src/workflow-observe.test.ts` → exit 0; `npm run check` → exit 0
  - Regression: existing `gate` behavior unchanged — covered by existing human-gates/quality-gates tests
  - Evidence: Record test output and changed files

- [ ] TASK-002: Bounded retry with escalation
  - Requirement: REQ-002
  - Code: src/workflow.ts (`rejectionCount` per stage, default 3/min 1, reset on approval), status/reject escalation notice, gate blocking until `approve` or `resolve --stage=`, src/cli.ts
  - Tests: src/workflow-escalation.test.ts (Nth rejection blocks gate; explicit action unblocks; count resets)
  - Validation: `npx vitest run src/workflow-escalation.test.ts` → exit 0; `npm run check` → exit 0
  - Regression: single-rejection flows behave as today (existing reject/approve tests)
  - Evidence: Record test output and changed files

- [ ] TASK-003: Rejection-reason persistence loop
  - Requirement: REQ-003
  - Code: new src/rules-candidates.ts (read/write `.aiw/generated/rules-candidates.yml`, normalized clustering, threshold ≥2), src/cli.ts (`rules-candidates` command, `--accept`/`--dismiss`), src/rules-candidates.test.ts
  - Tests: clustering, accept/dismiss lifecycle, no auto-activation
  - Validation: `npx vitest run src/rules-candidates.test.ts` → exit 0; `npm run check` → exit 0
  - Regression: none (additive command/file)
  - Evidence: Record test output and changed files

- [ ] TASK-004: Finding triage classification
  - Requirement: REQ-004
  - Code: review/verification skill templates (resources), report schema validation (optional `triage`, warn-level), src/adapter.ts guidance line, src/*.test.ts for the validator
  - Tests: warn-not-fail on missing triage; accepted values pass
  - Validation: `npx vitest run` (targeted validator tests) → exit 0; `npm run check` → exit 0
  - Regression: reports without `triage` still pass gates
  - Evidence: Record test output and changed files

- [ ] TASK-005: Trust-boundary documentation
  - Requirement: REQ-005
  - Code: docs/trust-boundaries.md; README + adapter guidance links; skill template reminder lines
  - Tests: none (docs); link check via docs lint if present
  - Validation: `npm run check` → exit 0
  - Regression: none
  - Evidence: Record changed files

- [ ] TASK-006: Policy conflict semantics
  - Requirement: REQ-006
  - Code: src/policy-gate.ts / src/organization-policy.ts (strictness ordering `deny > always-require-human > require-approval > allow`; optional `always-require-human` flag, never overridable), tests
  - Tests: ordering conflicts, tie-breaks stricter, always-require-human override attempts
  - Validation: `npx vitest run src/policy-gate.test.ts src/organization-policy.test.ts` → exit 0; `npm run check` → exit 0
  - Regression: rule files without the new flag evaluate exactly as before (existing policy tests)
  - Evidence: Record test output and changed files

## Validation Commands

- npm run check (format:check + lint + typecheck + build + test + security:check)

## Risks and Dependencies

- Dependencies: TASK-001 before TASK-002 (both touch src/workflow.ts gate/reject paths; observe branch lands first to minimize merge conflicts). Others independent.
- Risks:
  - Gate handler refactors could break existing gates → mitigate: run full human-gates/quality-gates suite after each task; additive-only state fields.
  - YAML for rules-candidates introduces a parser dependency → use existing YAML dependency already in the project if present, else minimal writer/parser consistent with other generated files.
  - Schema warnings could spam users → warn once per report, gated on field presence.

## Completion Evidence

- TASK-001..006: fill in per task (commands run, output, changed files) after implementation.
