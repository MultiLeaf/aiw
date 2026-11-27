# Code Review: Post-PR automation patterns

- Workflow ID: 4f3eab42-53fd-40f0-8b70-53abab066342
- Date: 2026-11-27
## Scope

The diff for TASK-001..TASK-006 — src/workflow.ts, src/human-approval.ts, src/quality-gates.ts, src/rules-candidates.ts (new), src/policy-gate.ts, src/blocking-reasons.ts, src/adapter.ts, five new test suites, docs/trust-boundaries.md (new), docs/continuation-inventory.md, README.md, and the code-review/verification skill and template resources.

## Findings

- F-1 (minor, correctness): `recordObserveDecision` writes JSON to `.aiw/checkpoints/workflow-<id>-observe.json` while every other checkpoint in that directory is YAML. Functionally correct and validated by tests; consistency-only concern. Evidence: src/workflow.ts `recordObserveDecision`; sibling files `workflow-*-approvals.yml`. triage: judgment-required
- F-2 (minor, robustness): the observe log read path swallows JSON parse errors and resets to an empty list (`catch { entries = []; }`), which could silently discard prior observe decisions if the file is corrupted. Bounded impact (decisions are advisory, capped, non-authoritative). Evidence: src/workflow.ts `recordObserveDecision`. triage: auto-fixable
- F-3 (minor, design): `rules-candidates` rescan rebuilds the candidates file from ledgers each run, so a manually edited or externally added candidate entry (not derived from rejections) would be dropped on the next scan. Prior statuses are preserved by id, as tested. Evidence: src/rules-candidates.ts `clusterRejections` + CLI scan branch. triage: judgment-required
- F-4 (info): REQ-006 resolver (`resolvePolicy`/`applyAutomatedResult`) is exported and test-covered but not yet consumed by `aiw policy-check` parsing (documented deviation; current policy format has no multi-rule conflicts). triage: judgment-required

## Checks

- Full suite: 96 files / 785 tests pass, including pre-existing human-gates, quality-gates, blocking-reasons, cli, and adapter-contract suites (NFR-002 regression evidence).
- `npm run check` (format:check, eslint, tsc --noEmit, build, vitest, security:check) → exit 0.
- `aiw verify` → "Verification passed."
- Schema-additive review: all new ledger/session fields (`rejectionCount`, `rejectionReasons`, `escalated`, `rejectionBudget`) are optional; `parseApprovalLedger` round-trips old files; docs parity test updated for `stage_escalated`.
- Escalation safety: gate blocking (`stage_escalated`) precedes state mutation; observe mode skips `assertStageReady` by design (dry-run), never writes the ledger; budget preserved through `withStage`, `invalidateStageAndDescendants`, `beginStageApproval`.
- Security/trust: no new network, subprocess, or credential handling; observe log and rules candidates contain only local workflow text; nothing auto-activates rules; consistent with docs/trust-boundaries.md.

## Residual Risks

- String-based rejection clustering misses paraphrases (accepted v1 limit; human reviews all candidates).
- Observe-decision JSON file could drift from the YAML convention (F-1) — cosmetic.
- Automated results from any future classifier remain capped at `require-approval` by `applyAutomatedResult`, but wiring into a live policy file is future work (F-4).

## Decision

Accept — findings F-1..F-4 are minor/informational with bounded impact; two are advisory follow-ups (JSON→YAML checkpoint consistency, scan-preserves-manual-entries) that can be addressed in a follow-up task without blocking this workflow.
