# Code Review: Doctor drift rule and CHANGELOG

- Workflow ID: 18b9fdaa-7a62-4502-9a54-737cfafe9107
- Ticket: AIW-001
- Date: 2026-11-27

## Scope

The TASK-001..TASK-003 diff: `detectStageListDrift`/`parseApprovalLedgerLenient`/`recordDriftSkip` in src/human-approval.ts, the doctor branch (diagnosis + `--fix`) in src/workflow.ts, src/doctor-drift.test.ts, CHANGELOG.md, docs/trust-boundaries.md.

## Findings

- F-1 (minor, robustness): `doctor --fix` uses `new Date().toISOString()` per repaired stage, so multiple repairs in the same millisecond carry identical timestamps — harmless (records are distinct stages), but a single timestamp for the whole repair would read cleaner in audits. triage: auto-fixable
- F-2 (info, behavior): the drift check only runs for active workflows; a completed-but-unarchived drifted ledger is not flagged. Consistent with doctor's scope (health of active state). triage: judgment-required
- F-3 (info, docs): the CHANGELOG "Added" entry is dense (one long bullet per capability); readable but long — style follows existing entries (0.17.0 has comparable density). triage: judgment-required

## Checks

- Full suite: 802 tests pass, including the 5 new doctor-drift tests and all pre-existing ledger/doctor suites.
- `npm run check` (format, eslint, tsc, build, vitest, security) → exit 0.
- Safety review: the fix path calls `recordDriftSkip`, which throws on existing records; decided stages are never written; required prerequisites are refused; no approval-shaped record is ever produced (skip + reason only).
- Validation review: `parseApprovalLedger` keeps the strict default; lenient order-check skip is opt-in only from the doctor path; serialize re-validates strictly, so a post-fix ledger must be genuinely valid.
- Genericity: no hard-coded stage names anywhere in the new code; the optional/required distinction uses `stageDefinition`.
- Regression: doctor output for healthy projects byte-identical (test-asserted); `aiw repair` untouched.

## Residual Risks

- None blocking. F-1 is cosmetic; F-2/F-3 are informational.

## Decision

Accept — the safety-critical behaviors (no invented approvals, no overwrites, required-stage refusal, strict re-validation) are all test-covered; findings are cosmetic/informational.
