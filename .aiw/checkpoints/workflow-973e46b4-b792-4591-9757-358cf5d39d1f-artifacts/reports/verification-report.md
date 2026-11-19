# Verification Report

## Requirements Checked

- REQ-001 (covering-test retrieval), REQ-002 (no tier lowering), REQ-003 (judge context), REQ-004 (runtime degradation)

## Checks Passed

- Validation: npx vitest run src/semantic.test.ts → exit 0 (25 passed)
- Validation: npx vitest run src/cli.test.ts → exit 0 (186 passed)
- Validation: npm run check → exit 0 (90 files, 758 tests)
- `aiw verify` → Verification passed

Requirement → evidence:
- REQ-001: CLI test — index + differently-named covering test (`tests/integration.spec.ts`) removes `untested_regression`, prints `covering: semantic-retrieval (src/auth/token.ts)`, `covering_evidence` in JSON; baseline run (no config) is byte-identical with the flag standing.
- REQ-002: same test asserts `risk: high` and the `security` reason remain after retrieval-aided coverage.
- REQ-003: CLI test asserts `## Changed paths` + labeled `src/caller.ts` chunk within budget and the "never confirmed facts" note; unit test asserts budget ordering (over-budget chunk excluded).
- REQ-004: unit test — provider throw → empty covering set with `degraded: true` (flag stands); CLI test — unavailable model → exit 1 advisory with fail-safe note, zero embed calls.

## Missing Evidence

None.

## Residual Risks

None identified; all retrieval paths are advisory and fail safe.

## Decision

Complete.
