# Implementation Report

## Changed Files

- `resources/skills/research.md` (new) — the bounded research contract: scope gate, budget/stop conditions/escalation, evidence rules (fact/hypothesis/unverified, uncited → open question), host-side external research with redaction + provenance, artifact template, light-lane recording
- `resources/package.yaml` — packaged `research` skill entry
- `src/recommendations.ts` — `bounded-research` capability (universal, advisory, confidence 0.85) offering `skills/research`
- `src/recommendations.test.ts` — expected capability list updated
- `src/opp011-evals.test.ts` — research skill contract invariants (scope gate, budget, citations, redaction, artifact sections, commands)
- `README.md`, `docs/backlog.md` — research skill documented; RES-001 backlog entry

## Tests

- `src/opp011-evals.test.ts` — contract sections and emission commands asserted
- `src/recommendations.test.ts` — capability recommended with workflow-evidence
- OPP-011 generic skill evals cover `research.md` automatically (directory iteration)

## Validation

- Validation: npx vitest run src/adapter-contract.test.ts → exit 0 (3 passed)
- Validation: npx vitest run src/opp011-evals.test.ts → exit 0 (6 passed)
- Validation: npx vitest run src/recommendations.test.ts → exit 0 (14 passed)
- Validation: npm run check → exit 0 (90 files, 760 tests)

## Deviations

None.
