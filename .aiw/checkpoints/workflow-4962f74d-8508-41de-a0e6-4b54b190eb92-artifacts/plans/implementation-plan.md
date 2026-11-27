# Implementation Plan: Resource Update Command

> Ticket: UPD-001
> Requirements: `.aiw/generated/specs/4962f74d-8508-41de-a0e6-4b54b190eb92/specification.md` (REQ-001 … REQ-004)

## Ordered Tasks

### TASK-001: Update plan module

- Requirement: REQ-001, REQ-002
- Code: new `src/update.ts` — `computeUpdatePlan(fs, root, aiw, target, add)` reading ownership metadata + catalog, classifying updated/new/unchanged/conflict, validating `--add` ids against the catalog (unknown → error with available ids).
- Tests: new `src/update.test.ts` — classification matrix (updated when bytes differ and no drift; conflict when checksum drift; unchanged when identical; new for uninstalled catalog ids), `--add` validation, plan determinism.
- Validation: npx vitest run src/update.test.ts → exit 0
- Evidence: test names covering each classification branch and add validation

### TASK-002: `update_conflict` blocking reason

- Requirement: REQ-002
- Code: `src/blocking-reasons.ts` — new code `update_conflict` with description, detail naming preserved paths, and a `Next:` continuation (manual resolution then re-run).
- Tests: `src/blocking-reasons.test.ts` — reason round-trip, continuation inventory completeness.
- Validation: npx vitest run src/blocking-reasons.test.ts → exit 0
- Evidence: reason-code registry and continuation assertions

### TASK-003: `aiw update` CLI wiring

- Requirement: REQ-001, REQ-002, REQ-003, REQ-004
- Code: `src/workflow.ts` — flag-less `update` (no `--package`) runs the plan; `--dry-run` prints only; apply replaces `updated` atomically and refreshes ownership checksums; `--add` appends the selection and renders new resources; conflicts exit 1 via `update_conflict`; usage/help updated.
- Tests: `src/cli.test.ts` — lifecycle: install → mutate fixture bundle → update replaces; manual edit → conflict exit 1, file untouched, typed reason; dry-run writes nothing; second run `unchanged` exit 0; `--add=research` installs additively leaving prior resources intact; unknown add id fails listing ids.
- Validation: npx vitest run src/cli.test.ts → exit 0
- Evidence: CLI assertions per acceptance criterion including idempotence and additivity

### TASK-004: Docs

- Requirement: REQ-001, REQ-003
- Code: README upgrade steps use `aiw update`; `docs/backlog.md` UPD-001 entry.
- Validation: npm run check → exit 0
- Evidence: full pipeline green; docs mention update

## Regression

- `update --package=` flow unchanged; sync/recommend/install suites untouched; full `npm run check` passes.
