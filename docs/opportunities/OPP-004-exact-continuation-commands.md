# OPP-004: Exact continuation commands — every block names a runnable way out

- Status: Partially implemented (2026-10-30, plan Wave 1): workflow, gate, and approval paths emit typed reason codes, continuations, and `--json` envelopes; sync/apply conflicts and doctor diagnostics remain prose-only follow-up
- Priority: P1 (small scope, high leverage)
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A

## Problem

When an `aiw` command blocks (gate incomplete, stage prerequisite unresolved, conflict, stale artifact), the output explains the problem but does not always provide the exact command that resolves it. Users and agents then reconstruct invocations from prose — which is where drift, dead ends, and wrong flags are born. There is no inventory guaranteeing that every blocking path has a tested, runnable continuation.

## Source concept (RDD)

RDD's CLI is governed by one rule:

> **"A message may name a command only if running that command resolves the block."**

Mechanisms behind it:

- Every blocking `stop` carries a typed **reason code** and, when a continuation exists, the **exact command** (provider-issued `next_transition.command`), with fixed argument order, runnable verbatim.
- A complete, published **continuation inventory**: a table mapping every reason code to its continuation or an explicit `Terminal` marker when no in-lineage continuation exists — terminal states say so instead of implying an escape route that isn't there.
- The rule was learned the hard way: an escalated review told operators to run `review.status`, which _looked_ like a command but was an internal routing name. And a fixed message named a continuation that, when finally executed, turned out not to resolve anything. "Naming a command that runs and does not help is more expensive than naming nothing, because now the person trusts it."

References:

- Gentle-AI `docs/review-integration.md` — "Continue after a stop reason code" table (complete continuation inventory)
- Gentle-AI `docs/architecture/the-organic-rdd-story.md` — "the rule that ran over everything else: if you tell someone what to do, make sure it works"

## Proposal

1. **Typed reason codes**: every blocking exit in the CLI (gates, stage commands, conflicts, doctor diagnostics) emits a stable reason code (e.g., `gate_incomplete`, `stage_prerequisite_unresolved`, `artifact_conflict`, `approval_stale`).
2. **Exact continuation**: when a continuation exists, the same output includes the literal runnable `aiw` command with all flags resolved (ticket, stage, path). When no continuation exists, the output says so explicitly (`terminal`) and names the human decision required.
3. **Continuation inventory doc**: a generated or maintained table mapping every reason code → continuation / terminal, published under `docs/` (contract for users, agents, and OPP-005's benchmark).
4. **Machine-readable form**: `--json` outputs carry `reason_code` and `next_command` fields so agents can chain without parsing prose (aligns with OPP-002's `next_command`).

## Affected areas

- `src/cli.ts` (error/blocking output paths), `src/quality-gates.ts`, `src/human-gates.test.ts` conventions
- `src/human-approval.ts` (stale approval blocks), migration/conflict reporting paths (`src/migration.ts`, `src/files.ts`)
- New reason-code registry module with the inventory table
- OPP-006 test policy is the enforcement mechanism for this opportunity

## Acceptance criteria

- Given any blocking exit, when its output is parsed, then it contains a stable reason code and either an exact `next_command` or an explicit terminal statement.
- Given an emitted `next_command`, when executed in the state that produced the block, then it resolves or advances that block (verified by test, per OPP-006).
- Given the continuation inventory, when a new reason code is added without a mapped continuation, then CI fails (inventory completeness check).
- Given `--json`, when a block occurs, then `reason_code` and `next_command` are machine-readable fields.
- No output names a command that exists but does not resolve the block it was printed for (regression-tested via OPP-006).

## Non-goals

- No interactive wizard behavior: the command prints the way out; it does not run it automatically.
- No changes to what blocks — only to what each block tells you.

## Open questions

- Should the reason-code registry live as code (single source, docs generated from it) or as docs with a CI check?
- Do adapter-rendered skills need the same guarantee in their prompts (the generated skills also tell agents what to run next)?
