# Policy path rules implementation

- Workflow ID: abbfcf16-6bfe-457d-a2d1-5841278fe202
- Version: 1 (draft)
- Date: 2026-11-27

## Linked Requirements

- REQ-001: Path rules in the organization policy (specification §REQ-001)
- REQ-002: policy-check resolves changed paths through the resolver (§REQ-002)
- REQ-003: Recorded human approval for strict paths (§REQ-003)
- REQ-004: Automated results are capped by the resolver (§REQ-004)

## Tasks

- [ ] TASK-001: Policy rules schema and validation
  - Requirement: REQ-001
  - Code: src/organization-policy.ts (PolicyRuleRecord type, rules block parse via yaml slice, validation, serialization round-trip)
  - Tests: src/organization-policy.test.ts extended (valid round-trip; invalid decision; duplicate id; >64 rules; empty paths; flat policy unchanged)
  - Validation: `npx vitest run src/organization-policy.test.ts` → exit 0
  - Regression: existing flat-policy tests and `aiw organization-policy --file=` unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-002: changedPaths and shared pattern matcher
  - Requirement: REQ-002 (foundations)
  - Code: src/policy-gate.ts (changedPaths with git fallback chain; shared pathPatternMatches extracted from ruleMatchesPath)
  - Tests: src/policy-gate.test.ts / new src/policy-paths.test.ts (git fixture: committed + uncommitted + untracked; non-git undefined; pattern matcher prefix/*)
  - Validation: `npx vitest run src/policy-paths.test.ts` → exit 0
  - Regression: resolvePolicy behavior unchanged (existing policy-conflicts tests)
  - Evidence: Record test output and changed files

- [ ] TASK-003: policy-check path enforcement
  - Requirement: REQ-002
  - Code: src/workflow.ts (policy-check branch: rules evaluation, deny block, require-approval/always-require-human approval gating, advisory summary counts, no-rules/no-paths regressions)
  - Tests: src/policy-check-rules.test.ts (deny blocks with actionable output; strict passes after approval; no-rules byte-identical; non-git fallback via package lists; no-paths advisory)
  - Validation: `npx vitest run src/policy-check-rules.test.ts` → exit 0
  - Regression: existing policy-check tests unchanged
  - Evidence: Record test output and changed files

- [ ] TASK-004: Scoped approval command and records
  - Requirement: REQ-003
  - Code: src/policy-approvals.ts (new: record parse/serialize, fingerprint, coverage), src/workflow.ts (`aiw policy approve --paths=`)
  - Tests: src/policy-approvals.test.ts + CLI coverage in src/policy-check-rules.test.ts (scoped approval does not leak across patterns; fingerprint invalidation on tree change; deny never satisfiable; cap 50)
  - Validation: `npx vitest run src/policy-approvals.test.ts src/policy-check-rules.test.ts` → exit 0
  - Regression: none (new command/file)
  - Evidence: Record test output and changed files

- [ ] TASK-005: Advisory automated results and docs
  - Requirement: REQ-004
  - Code: src/workflow.ts (`policy-check --advisory=<decision>`: applyAutomatedResult per path, delta report, verdict unchanged), CHANGELOG.md, docs/trust-boundaries.md
  - Tests: advisory delta report in src/policy-check-rules.test.ts (allow lowers require-approval; never-override of always-require-human/deny; verdict unchanged)
  - Validation: `npx vitest run src/policy-check-rules.test.ts` → exit 0
  - Regression: policy-check without --advisory unchanged
  - Evidence: Record test output and changed files

## Validation Commands

- npm run check

## Risks and Dependencies

- Dependencies: TASK-001 and TASK-002 first (schema + paths feed enforcement); TASK-003 after both; TASK-004 before TASK-005 (approvals gate the strict paths the advisory reports on); TASK-005 last (docs + resolver consumption).
- Risks: merge-base heuristics on fresh clones (fallback chain + advisory, per design); fingerprint churn (conservative, documented); git fixture tests need hermetic repos (mkdtemp + git init, same pattern as workflow-pr tests).

## Completion Evidence

- TASK-001..005: fill in per task (commands run, output, changed files) after implementation.
