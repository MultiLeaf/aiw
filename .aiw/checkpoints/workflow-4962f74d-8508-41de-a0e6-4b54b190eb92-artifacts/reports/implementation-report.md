# Implementation Report

## Changed Files

- `src/update.ts` (new) — `computeUpdatePlan` (ownership-checksum drift oracle; updated/new/unchanged/conflict; `--add` validation failing closed with available ids), `refreshOwnershipChecksums`
- `src/workflow.ts` — `runBundledUpdate`: flag-less `aiw update` (no `--package`) with `--dry-run`/`--add`; drift-safe apply (replaces only checksum-clean files, refreshes ownership), additive `--add` rendering with ownership + recommendations selection, `update_conflict` typed block; usage/help updated. Fixed a latent `return`-vs-`return await` escape in the update branch
- `src/blocking-reasons.ts` + `docs/continuation-inventory.md` — new `update_conflict` reason with continuation (parity test green)
- `src/cli.test.ts` — full lifecycle test (older-version replacement, dry-run no-write, idempotence, manual-drift conflict preservation with exit 1, `--add=skills/research` additive install + selection record, unknown id fails closed)
- `src/update.test.ts` (new) — classification matrix, add validation, determinism, checksum refresh
- `README.md`, `docs/backlog.md` — update documented; UPD-001 backlog entry
- ADR stamp hardening (monotonic unix-time guard) — fixes the flaky same-millisecond collision exposed by the new suite

## Tests

- See above; unit + CLI coverage per acceptance criterion.

## Validation

- Validation: npx vitest run src/update.test.ts → exit 0 (5 passed)
- Validation: npx vitest run src/blocking-reasons.test.ts → exit 0 (20 passed)
- Validation: npx vitest run src/cli.test.ts → exit 0 (188 passed)
- Validation: npm run check → exit 0 (91 files, 766 tests)

## Deviations

None.
