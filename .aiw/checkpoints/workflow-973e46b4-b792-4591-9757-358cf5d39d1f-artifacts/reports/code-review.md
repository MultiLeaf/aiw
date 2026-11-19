# Code Review

## Scope

OPP-008 diff: `src/semantic.ts` (retrieval helpers), `src/risk-assess.ts` (retrieval-aided probe), `src/workflow.ts` (judge-context subcommand), three judge/refuter skill docs, tests, `docs/semantic-mapping.md`.

## Findings

None blocking. Advisory notes:
1. `semanticCoveringEvidence` issues one embedding call per uncovered high-risk path — bounded by the untested set only; acceptable per the design's latency note (counting fake provider in tests verifies call scope implicitly via behavior).
2. `runRiskAssess` recomputes the assessment via a second `assessRisk` call with the wrapped probe instead of mutating reasons — keeps tier logic single-sourced (rule-based) rather than duplicating tier computation.
3. The skills' retrieval-aid note is identical across the three files — deliberate (independence contract unchanged).

## Checks

- Diff reviewed against the approved design (helpers, risk-assess wiring, CLI, skills, docs).
- Fail-safe invariants verified: undefined evidence → byte-identical floor; degraded → empty coverage; retrieval only removes `untested_regression`; tiers rule-based.
- No new settings sections or providers; the `semantic` gate and scan-owned freshness are respected.
- Judge-context output labeled as aids; budget enforced in render and asserted in tests.

## Residual Risks

None beyond the advisory notes.

## Decision

Accept.
