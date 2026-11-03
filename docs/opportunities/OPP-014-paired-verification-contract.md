# OPP-014: Paired Verification Contract — expected vs observed, mechanically compared

- Status: Implemented (2026-11-01): plan declares command → expected, reports record command → observed, implementation/verification gates compare pairs
- Priority: P2
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Trend signal: HDAE's gate structure pairs **Verification plan** (`command → expected result`) with **Evidence** (`command → observed result`) as first-class fields; Gentle-AI's field report showed the failure mode this prevents — agents declaring success without observed proof. AI Workflow's plan template already carries `Validation:` lines and its quality gates verify section _presence_; this contract makes the proof **mechanically comparable**.

## Problem

"Checkoffs require observed proof" is today an instruction, not a mechanism:

- the plan declares validation commands (`Validation: npm test`), but the gate cannot tell whether the recorded evidence actually ran _that_ command;
- expected outcomes are implicit ("tests pass") — nothing records what result was _expected_ before the run, so a wrong expectation passes as easily as a right one;
- evidence sections are free text — a gate can verify presence, never correspondence.

A gate that cannot compare declared vs observed is checking paperwork, not proof.

## Proposal

1. **Plan side (declaration)**: each task in the implementation plan declares its verification pair, machine-parseable:
   - `Validation: <command> → <expected>` where expected is a minimal assertion (exit code plus optional output pattern), e.g. `npm test → exit 0`, `aiw trace --requirement=REQ-001 → contains REQ-001`.
2. **Evidence side (observation)**: implementation/verification artifacts record the same command with its observed result: `<command> → <observed>` (exit code and the claimed observable, e.g. `132 passed`).
3. **Gate comparison** (deterministic, parse-only): the verification and implementation gates check, per declared pair: the command appears verbatim in evidence, the observed section is non-empty, and expected/observed exit codes agree. Mismatch, absence, or a evidence command that was never declared → typed gate failure naming the task and pair (`verification_pair_mismatch`, `verification_pair_missing` — new reason codes, inventory updated).
4. **Light lane**: one pair per task is the whole evidence contract (the compact checkpoint already records command and result — formalize the same shape).
5. **No execution**: the gate compares declarations; it does not run project commands (preserving `verify`'s contract and keeping gates fast and side-effect-free). Execution evidence must come from a recorded run.

## Affected areas

- `resources/templates/` (plan task format gains the pair; implementation/verification report templates gain the observed side)
- `src/quality-gates.ts` (pair parser + comparator validators; new gate failures)
- `src/blocking-reasons.ts` (`verification_pair_mismatch`, `verification_pair_missing` + inventory rows)
- `src/workflow.ts` (gate wiring), `docs/architecture.md`, `docs/quality.md` (contract statement)

## Acceptance criteria

- Given a plan declaring `npm test → exit 0`, when evidence records `npm test → exit 0 (132 passed)`, then the gate passes.
- Given evidence recording a different command than declared, when the gate runs, then it fails with `verification_pair_mismatch` naming the task.
- Given a declared pair with no matching observed record, when the gate runs, then it fails with `verification_pair_missing`.
- Given artifacts authored before this contract (no pairs), when gates run, then the legacy validation format remains accepted with an advisory notice (backward-compatible parsing, no forced migration).
- Given a light-lane evidence entry, when completion runs, then the pair shape is the compact checkpoint's command/result fields.
- Given any pair failure, when `--json` is used, then the typed reason code and the failing task id are machine-readable.

## Non-goals

- The gate never executes project commands (side-effect-free gates; execution evidence comes from recorded runs).
- No expected/observed semantic comparison beyond exit codes and declared patterns (no model judgment in gates).
- No retroactive migration of existing artifacts (ratchet: new plans use pairs; legacy format accepted with notice).

## Open questions

- Expected-result grammar: exit code only, or `exit N` + substring/regex pattern? (Recommendation: exit code required, pattern optional.)
- Should `verify` (REQ→evidence coverage) surface pairs per requirement in the verification report?
- Do orchestration-delegated tasks (OPP-010) inherit pairs via their task prompt or their own declaration?
