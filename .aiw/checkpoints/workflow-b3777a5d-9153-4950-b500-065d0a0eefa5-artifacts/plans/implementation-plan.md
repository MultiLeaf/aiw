# Implementation Plan: Decision Model — Findings Triage and Lane Scope-Watch

> Ticket: OPP-007
> Requirements: `.aiw/generated/specs/b3777a5d-9153-4950-b500-065d0a0eefa5/specification.md` (REQ-001 … REQ-005)

## Ordered Tasks

### TASK-001: Findings model + deterministic shape check

- Requirement: REQ-001
- Code: `src/decision.ts` — `ReviewFinding` type, `parseReviewFindings(text)` (fail-closed: unparseable entries become shape failures), `checkFindingShapes(findings)`.
- Tests: `src/decision.test.ts` — well-formed findings pass; missing severity / empty evidence fail; unparseable input fails closed without throwing.
- Validation: npx vitest run src/decision.test.ts → exit 0
- Evidence: test names covering pass/fail/fail-closed shape outcomes

### TASK-002: Batched triage + scope-watch request builders

- Requirement: REQ-002, REQ-004
- Code: `src/decision.ts` — `buildFindingsTriageRequest(findings)` (one choice question per severe finding id), `buildLaneScopeWatchRequest(changeSummary)`.
- Tests: `src/decision.test.ts` — request contains exactly the severe findings; non-severe excluded; scope-watch request shape.
- Validation: npx vitest run src/decision.test.ts → exit 0
- Evidence: assertions on question ids and batched single-request shape

### TASK-003: `aiw decision findings-triage` CLI

- Requirement: REQ-001, REQ-002
- Code: `src/workflow.ts` — new subcommand; shape check always printed; when `loadDecisionConfig` is enabled, one provider call (batched) via the existing Ollama provider with injected services for tests; advisory flags printed; provider failure degrades to shape-check-only.
- Tests: `src/cli.test.ts` — unconfigured run prints shape results only, exit 0, no network (fake provider asserts zero calls); enabled run prints `evidence_supported` flags from a fake provider and the refuter-owns note; provider error degrades silently.
- Validation: npx vitest run src/cli.test.ts → exit 0
- Evidence: assertions on advisory-only output and degradation

### TASK-004: Lane mismatch + scope-watch advisories

- Requirement: REQ-003, REQ-004
- Code: `src/workflow.ts` — light-lane `task start` appends the high-tier mismatch advisory; light-lane `workflow complete` appends the deterministic mismatch note and, when enabled, one scope-watch advisory line.
- Tests: `src/cli.test.ts` — start with high tier prints the note; complete unconfigured is byte-identical to prior output shape; complete enabled adds exactly one advisory line (fake provider).
- Validation: npx vitest run src/cli.test.ts → exit 0
- Evidence: advisory-line assertions plus byte-stability check

### TASK-005: Routing categories + docs

- Requirement: REQ-005
- Code: `src/model-routing.ts` — `review.findings-triage`, `workflow.lane-watch` rules with evidence links or `unevidenced-rule`; `docs/decision-model-evaluation.md` section.
- Validation: npm run check → exit 0
- Evidence: routing tests cover the new categories; docs mention both flows and the batched constraint

## Regression

- Unconfigured decision model → all new outputs byte-identical/absent; full `npm run check` green.
