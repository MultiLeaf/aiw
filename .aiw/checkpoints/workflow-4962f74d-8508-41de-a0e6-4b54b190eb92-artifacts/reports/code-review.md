# Code Review

## Scope

UPD-001 diff: `src/update.ts` (new), `src/workflow.ts` (`runBundledUpdate` + update branch + ADR stamp hardening), `src/blocking-reasons.ts`, `docs/continuation-inventory.md`, tests, README, backlog.

## Findings

One issue found and fixed during review (self-review catch, pre-approval): `return runBundledUpdate(...)` inside the try block did not route promise rejections through the catch (`return` vs `return await` semantics) — blocking errors escaped as rejections. Fixed to `return await`; the conflict path now returns a typed result like every other blocking flow. A regression test (the conflict assertion) covers it.

Advisory notes:
1. `update --package` (local packages) and the new bundled form coexist by `--package` presence; the usage string documents both.
2. The ADR monotonic stamp is module-level state — acceptable for a CLI process (single command per process); parallel processes still get ms-precision ids with the same-slug bump loop.

## Checks

- Diff reviewed against the approved design (plan module, blocking reason, CLI wiring, docs).
- Drift oracle = ownership checksum; drifted files never written (asserted); supporting/legacy ownership entries skipped, never touched.
- `--add` additive: selection recorded via existing recommendations serializer; rendering reuses `renderResourcePath` and ownership creation.
- Continuation-inventory parity test green for the new reason code.

## Residual Risks

None beyond the advisory notes.

## Decision

Accept.
