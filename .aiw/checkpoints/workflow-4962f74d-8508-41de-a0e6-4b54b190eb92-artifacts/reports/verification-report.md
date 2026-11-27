# Verification Report

## Requirements Checked

- REQ-001 (diff), REQ-002 (drift-safe), REQ-003 (additive --add), REQ-004 (non-interactive/idempotent)

## Checks Passed

- Validation: npx vitest run src/update.test.ts → exit 0 (5 passed)
- Validation: npx vitest run src/blocking-reasons.test.ts → exit 0 (20 passed)
- Validation: npx vitest run src/cli.test.ts → exit 0 (188 passed)
- Validation: npm run check → exit 0 (91 files, 766 tests)
- `aiw verify` → Verification passed

Requirement → evidence:
- REQ-001: CLI test — dry-run lists `updated: 1` with the path and `new available:` without writing; unit tests cover the classification matrix and determinism.
- REQ-002: CLI test — checksum-clean older version replaced byte-exactly with the catalog content; manual edit → file untouched, exit 1, `update_conflict` reason naming the path; ownership checksums refreshed after apply.
- REQ-003: CLI test — `--add=skills/research` installs the skill (content asserted), prior resources byte-identical, selection recorded in `recommendations.yml`; unknown id → exit 1 with available ids; unit test covers fail-closed validation.
- REQ-004: CLI test — second run reports `updated: 0` exit 0 (idempotent); no prompts anywhere in the flow; unit determinism test.

## Missing Evidence

None.

## Residual Risks

- Catalog personalization drift edge (profile-dependent bytes) is exercised through the same personalization path as sync; byte comparisons remain apples-to-apples.

## Decision

Complete.
