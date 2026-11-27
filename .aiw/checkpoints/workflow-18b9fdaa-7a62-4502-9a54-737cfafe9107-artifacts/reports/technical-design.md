# Technical Design: Doctor rule for stage-list drift and CHANGELOG entry

- Workflow ID: 18b9fdaa-7a62-4502-9a54-737cfafe9107
- Ticket: AIW-001
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Specification v1 (approved)

## Context

`aiw doctor` (src/workflow.ts) checks required files, legacy state, leaked worktrees, and config parsing, then exits 0 with "health check passed". Ledger drift appears only when `readActiveWorkflow`/`parseApprovalLedger` throws "out-of-order decision" during normal commands, with no repair path. `validateLedger` (src/human-approval.ts:629-643) contains the exact drift condition: a decided stage (pending-human/approved/rejected/skipped) whose `getUnresolvedPrerequisites` is non-empty. CHANGELOG has an `[Unreleased]` section in Keep a Changelog format.

## Proposed Design

### 1. Drift detection in doctor (REQ-001)

- New pure helper in `src/human-approval.ts`: `detectStageListDrift(ledger): { stage, unresolvedPrerequisites }[]` — for each stage in `processStages(ledger)` with a decision, collect unresolved prerequisites. Generic over any future `PROCESSES` change (no hard-coded stage names).
- Doctor gains a workflow-state check (after the config checks, before success): if `workflow.yml` is active, parse the ledger **leniently** — `parseApprovalLedger` throws on drift, so doctor wraps it: on the out-of-order error, or when the ledger parses but `detectStageListDrift` returns entries, doctor reports each drifted stage with its unresolved prerequisites and prints the exact repair (`aiw doctor --fix`), returning exit code 1 with a `state_mismatch`-style blocking message.
- Implementation note: `parseApprovalLedger`'s strict validation is the drift signal itself; doctor catches the thrown message and, to name stages precisely, re-derives them by parsing the YAML stages without the order validation (a small lenient reader in the doctor branch, reusing `getUnresolvedPrerequisites` + `processStages`).

### 2. Repair via `aiw doctor --fix` (REQ-002)

- `doctor --fix` (new flag, allowed alongside nothing else): loads the ledger leniently, computes drift entries, and for each unresolved prerequisite that blocks a decided stage **and has no record of its own**, writes a `skipped` record (`status: skipped`, `qualityGate: not-applicable`, `reason: "Stage introduced after this stage was decided (process list drift); recorded by aiw doctor --fix"`, `updatedAt` timestamp) using `skipOptionalStage` semantics via `withStage`.
- Safety (NFR-001): prerequisites that already carry any record are never overwritten; decided stages are never modified; the fix only inserts new skip records. If a drifted prerequisite is a *required* stage in the current process (not optional), the fix refuses with an explanation (a required new stage cannot be auto-skipped; the human must run it) — generic, not hard-coded.
- After the fix, the ledger is re-serialized with `serializeApprovalLedger` and doctor re-runs the check to confirm health, exiting 0 on success.

### 3. CHANGELOG entry (REQ-003)

- Add to `[Unreleased]` under **Added**: end-to-end PR flow summary (new `product-requirements` and `pr` feature-process stages, `aiw prd`/`aiw pr`, QA test matrix gates, ADR enforcement, PR-readiness gate and completion blocking, pr-submission skill, completion-report PR section) and under **Changed**: feature-process stage list changed — in-flight feature workflows may hit stage-list drift; run `aiw doctor` (diagnosis) and `aiw doctor --fix` (recorded-skip repair); `workflow complete` now requires the `pr` stage to resolve. Also summarize the post-PR automation patterns from the prior session (observe mode, rejection escalation, rules-candidates, triage, trust boundaries, policy conflict semantics) per the existing entry style.

## Alternatives

- Auto-repair inside `parseApprovalLedger` (silently skipping new prerequisites) — rejected: parse must stay strict; silent mutation of approval state violates the trust model and NFR-001.
- A dedicated `aiw ledger-repair` command — rejected: `doctor` is the established health/repair entry point (`aiw repair` exists for directories); a flag keeps the surface small.
- Hard-coded handling for `product-requirements`/`pr` only — rejected: generic prerequisite-drift detection covers all future `PROCESSES` changes (constraint).
- Treating required new prerequisites as auto-skippable — rejected: a required stage genuinely needs to run; refusing is the safe behavior.

## Interfaces

- **CLI (additive):** `aiw doctor [--fix]`; usage error on unknown flags combined with `--fix`.
- **Module exports (additive):** `detectStageListDrift(ledger)` in `src/human-approval.ts`; a `lenientLedgerStages` reader (internal or exported for tests).
- **Ledger schema:** unchanged — the repair writes standard skip records.
- **Docs:** CHANGELOG `[Unreleased]` entries; `docs/continuation-inventory.md` unchanged (reuses `state_mismatch`); trust-boundaries doc gains one line about the doctor repair never inventing approvals.

## Risks

- The lenient reader could diverge from strict parsing — mitigation: it reuses `parseStageRecord` per stage and only skips the cross-stage order check; tests cover both the throwing and non-throwing drift shapes.
- `--fix` on a required new prerequisite refuses — this is intentional but must produce an actionable message naming the stage to run.
- Doctor's exit-code contract: new failure mode may surprise scripts that only expect missing-file errors — acceptable; doctor's contract is "exit 0 only when healthy".

## Validation

- Unit tests (`src/human-approval` drift helper): drift detected for decided stage + unresolved prerequisite; no drift for clean ledgers; skipped prerequisite not re-reported.
- CLI tests (`src/doctor-drift.test.ts`): doctor reports drift with stage names and exits 1; `doctor --fix` inserts skip records and doctor then passes; decided stages untouched; a record on the prerequisite is never overwritten; a required new prerequisite refuses with an actionable message; doctor without drift behaves exactly as today (regression, NFR-002).
- CHANGELOG: format check via prettier; content asserted in a light test or reviewed manually (entry presence).
- Project quality: `npm run check` exit 0; full suite green.
- Acceptance mapping: REQ-001 → doctor diagnosis tests; REQ-002 → fix tests; REQ-003 → CHANGELOG entry.

## Traceability

- REQ-001 → §1 | REQ-002 → §2 | REQ-003 → §3 | NFR-001 → §2 safety rules | NFR-002 → §1 (flag-less doctor unchanged), Validation regression tests.
