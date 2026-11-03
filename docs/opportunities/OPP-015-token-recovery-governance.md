# OPP-015: Token and Recovery Governance — enforced budgets, recovery block, advisory suggestions

- Status: Implemented (2026-11-01): enforced context budgets, recovery managed block, advisory lane suggestion, regression-pinning advisory
- Priority: P2 (small, independent mechanisms; bundle ships together)
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Sources: HDAE's context-recovery managed block and "do not fill gaps with assumptions" interview discipline; ODD's advisory lane guidance; AI Workflow's own CTX-004 (per-stage budgets, currently report-only) and OPP-002 (`risk assess`, already shipped).

## Problem

Four small gaps share one theme — the workflow knows the right thing but does not _act_ on it:

1. **Stage budgets are advisory**: CTX-004 measures per-stage token usage, but exceeding a budget changes nothing — there is no enforced ceiling, so drift accumulates silently.
2. **Post-compaction recovery is left to the agent's memory**: after context compaction or handoff, the agent re-derives state from chat remnants instead of reading the authoritative files — expensive and lossy.
3. **Lane choice is uninformed**: `task start` does not surface what `risk assess` already knows; humans pick lanes blind when a one-line advisory would do.
4. **Regression pinning is folklore**: "touched behavior keeps a test proving its previous behavior" exists in docs/quality culture but not as a declared, checkable artifact item.

## Proposal

1. **Enforced stage budgets**: stage/context manifests (per process and lane, OPP-009-ready) declare ceilings; exceeding one fails with a typed block (`context_budget_exceeded`) whose continuation names what to trim or the `--budget=<n>` override requiring an explicit reason recorded in the checkpoint. Budgets default from measured baselines (`context-bench --save`), never invented.
2. **Context-recovery managed block**: the root context file gains an aiw-managed block (same preserve/drift semantics as other managed content): _"After any context compaction, reset, resume, or handoff: run `aiw task status`, read the artifacts this workflow declares, and do not rely on compacted chat as the source of project state."_ Points at digests when OPP-013 exists (declared forward reference).
3. **Advisory lane suggestion**: `task start --lane=light` (and plain `task start`) prints, when `aiw risk assess` data is available for the current changes, one advisory line — `risk: high -> consider the full lane` or `risk: passive -> light lane viable` — always advisory; the human's choice is recorded as today. No new flags, no blocking.
4. **Regression-pinning declaration**: the plan template's task format gains an optional `Regression: <behavior> → <test>` line; `verify`/traceability report tasks that touched existing behavior (declared `Touches:` existing paths) without a regression declaration, as advisory output in the verification report and a documentation rule in `docs/quality.md`. Optional to declare, reported when absent — declaration, not bureaucracy.

## Affected areas

- `src/workflow.ts` (budget enforcement points, lane suggestion line), `src/context-quality.ts` / CTX-004 ceilings
- `src/human-approval.ts` (budget override reason recorded in checkpoints)
- `src/generator.ts` / `resources/templates/*` (recovery block, task `Regression:` line)
- `src/blocking-reasons.ts` (`context_budget_exceeded` + inventory row)
- `docs/quality.md`, `docs/token-efficiency.md`, `docs/architecture.md`

## Acceptance criteria

- Given a stage context exceeding its declared ceiling, when the stage runs, then it blocks with `context_budget_exceeded` and the continuation names trim options or the explicit override; the override is recorded with its reason in the checkpoint.
- Given `context-bench --save` baselines, when budgets are absent, then defaults derive from them (never arbitrary constants).
- Given the recovery block rendered for each target, when an agent resumes after compaction, then the block instructs reading `aiw task status` and workflow-declared artifacts before continuing (block present in all adapter renderings; preserved on user edits per drift rules).
- Given pending changes classified `high` by risk assess, when `task start --lane=light` runs, then the advisory line appears and the lane still starts as chosen (advisory never blocks).
- Given a task declaring `Touches: src/auth/token.ts` without a `Regression:` line, when verification runs, then the report lists the gap as advisory; declaring one removes it.
- Given the `npm`-published package on any target, when installed fresh, then behavior without baselines/budgets configured is byte-identical to today (all four mechanisms default-inert until declared).

## Non-goals

- No hard token ceilings on artifact authoring (authors write what the work needs; budgets govern _context served_, not writing).
- No automatic lane switching, budget auto-tuning, or model-driven anything (deterministic floor per spec NFR-2/3).
- No compaction simulator: the recovery block is an instruction artifact; testing it is OPP-011 invariant territory.

## Open questions

- Default budget derivation: per-stage from `context-bench` baseline, or per-workflow pooled?
- Should the lane suggestion also appear in `aiw recommend` output for ticket-driven starts?
- Does the `Regression:` line belong in the plan task format (OPP-014 pairs live there too) or the implementation report?
