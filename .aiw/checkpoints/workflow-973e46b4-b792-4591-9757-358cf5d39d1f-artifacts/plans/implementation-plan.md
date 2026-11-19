# Implementation Plan: Embedding Covering-Test Detection and Judge Context Scoping

> Ticket: OPP-008
> Requirements: `.aiw/generated/specs/973e46b4-b792-4591-9757-358cf5d39d1f/specification.md` (REQ-001 … REQ-004)

## Ordered Tasks

### TASK-001: Semantic retrieval helpers

- Requirement: REQ-001, REQ-003, REQ-004
- Code: `src/semantic.ts` — `buildCoveringTestQuery`, `semanticCoveringEvidence` (injectable provider; undefined without config/index; degraded on provider failure), `renderJudgeContext`.
- Tests: `src/semantic.test.ts` — query terms from path semantics; covering hit via test-pattern chunk file; miss; degraded (provider throws → empty set, degraded flag); undefined without config; judge context ordering/budget/labels.
- Validation: npx vitest run src/semantic.test.ts → exit 0
- Evidence: test names covering hit/miss/degraded/undefined and budget-ordered rendering

### TASK-002: Retrieval-aided risk assess

- Requirement: REQ-001, REQ-002, REQ-004
- Code: `src/risk-assess.ts` — after the deterministic assessment, remove `untested_regression` only for retrieval-covered paths; print `covering: semantic-retrieval` audit line; add `covering_evidence` to `--json`; zero behavior change when the helper is undefined.
- Tests: `src/cli.test.ts` (risk assess suite) — with index + differently-named covering test the flag disappears and other reasons/tier unchanged; no-config run byte-identical.
- Validation: npx vitest run src/cli.test.ts → exit 0
- Evidence: assertions on reason sets, tier stability, audit line, and unchanged no-config output

### TASK-003: Judge-context CLI + skill notes

- Requirement: REQ-003
- Code: `src/workflow.ts` — `aiw semantic judge-context --paths=<csv> [--budget=N]`; `resources/skills/review-judge-a.md`, `review-judge-b.md`, `review-refuter.md` context-aid notes.
- Tests: `src/cli.test.ts` — bounded labeled output with index; unavailable → exit 1 advisory, no network.
- Validation: npx vitest run src/cli.test.ts → exit 0
- Evidence: output/label assertions and unavailable-advisory assertions

### TASK-004: Docs

- Requirement: REQ-001, REQ-003
- Code: `docs/semantic-mapping.md` sections; cross-links from OPP-002/OPP-003 docs.
- Validation: npm run check → exit 0
- Evidence: docs cover fail-safe rules and both flows; eval contracts on modified skills stay green

## Regression

- Unconfigured semantic mapping → both flows byte-identical; full `npm run check` green.
