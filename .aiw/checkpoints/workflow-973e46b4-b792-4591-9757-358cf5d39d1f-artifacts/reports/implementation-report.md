# Implementation Report

## Changed Files

- `src/semantic.ts` — `buildCoveringTestQuery` (path-semantics), `semanticCoveringEvidence` (undefined floor / degraded fail-safe), `renderJudgeContext` (diff-first budget, aid labels)
- `src/risk-assess.ts` — retrieval-aided `untested_regression`: only retrieval-covered paths drop the reason (tier recomputes rule-based); `covering: semantic-retrieval` audit line; `covering_evidence` in `--json`; injectable embedding provider
- `src/workflow.ts` — `aiw semantic judge-context --paths=<csv> [--budget=N]` (advisory errors when disabled/index-missing/model-unavailable, fail-safe note)
- `resources/skills/review-judge-a.md`, `review-judge-b.md`, `review-refuter.md` — optional retrieval-aid note
- `src/semantic.test.ts`, `src/cli.test.ts` — unit + CLI coverage for all four requirements
- `docs/semantic-mapping.md` — OPP-008 implemented-integration section

## Tests

- `src/semantic.test.ts` — query terms; covering hit/miss/degraded/undefined; judge-context ordering/budget/labels
- `src/cli.test.ts` — risk assess baseline byte-identical then retrieval-aided (reason removed, tier/reasons stable, json evidence); judge-context output and unavailable advisory

## Validation

- Validation: npx vitest run src/semantic.test.ts → exit 0 (25 passed)
- Validation: npx vitest run src/cli.test.ts → exit 0 (186 passed)
- Validation: npm run check → exit 0 (90 files, 758 tests)

## Deviations

None.
