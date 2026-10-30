# OPP-002: `aiw risk assess` — content-based risk classification with an exact next command

- Status: Proposed
- Priority: P2
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A

## Problem

AI Workflow applies the same gate and review depth to every change. A two-line edit to authentication handling and a thousand-line documentation addition produce identical ceremony. There is no command that answers, before deciding how much process a change needs: _what is the risk of this change, why, and what should I run next?_

## Source concept (RDD)

RDD's `gentle-ai review assess` is a **read-only** risk classification that:

- builds the same candidate a review would, without creating any authority or mutating state;
- classifies risk by **what changed**, never by size — a README edit is `passive` (zero reviewers), two lines of login code is `high` (four reviewers);
- reports a typed tier (`passive` / `medium` / `high`), machine-readable reasons with paths, and a **`next_transition.command`**: the exact, literally runnable next command, so callers never reconstruct invocations from prose;
- supports agent escalation: an agent may raise (never lower) risk citing one of six high-risk items — 1 data/irreversible effects, 2 security, 3 contracts others consume, 4 concurrency, 5 delivery/environment, 6 no test would catch a regression.

References:

- Gentle-AI `docs/review-integration.md`, section "Read-only risk assessment (`gentle-ai review assess`)" — includes the `gentle-ai.review-assessment/v1` JSON envelope example
- Gentle-AI `docs/architecture/organic-rdd.md` — risk tier → lens selection (low: structural readback, 0 lenses; medium: 1 lens; high: canonical 4R)

## Proposal

Add `aiw risk assess`:

```bash
aiw risk assess [--ticket=PROJ-142] [--base-ref <ref>] [--json]
aiw risk assess --escalate-item <1-6> --escalate-reason "<one line>"
```

1. **Inputs**: working tree changes by default; or `--base-ref` for a committed base-to-HEAD comparison (mirroring RDD's `--base-ref --committed-only`).
2. **Classification layers** (deterministic first, model optional):
   - deterministic path/content rules for the six high-risk categories (auth/security surfaces, exported contracts, concurrency primitives, migrations/irreversible data ops, delivery/environment scripts, code with no covering test);
   - the existing `decision` module (advisory) may refine reasons when enabled — output stays advisory and never changes evidence states or bypasses approval, consistent with the decision-model contract.
3. **Output tiers**: `passive` (documentation-only or no risk category hit), `medium`, `high`, with typed reasons `[{"code": "...", "path": "..."}]` and, with `--json`, a schema-versioned envelope (e.g., `aiw.risk-assessment/v1`).
4. **Exact continuation**: when the tier warrants more process, the output includes `next_command`: the literal runnable `aiw` command (e.g., start the full lane, or open a gate). Follows OPP-004's rule: a next command is printed only when running it resolves the decision at hand.
5. **Escalation**: `--escalate-item`/`--escalate-reason` raise `passive`/`medium` to `high`, never lower a tier; both flags together, reason ≤ 500 bytes, one line.
6. **Read-only guarantee**: no writes to `.aiw/`, no approval or gate state changes, works offline with no model configured.

## Affected areas

- New command module + tests (pattern: `src/decision.ts`, `src/evidence.ts`)
- `src/quality-gates.ts` / `src/human-gates.test.ts` conventions for envelope schemas
- `src/scanner.ts` reuse for change/path detection (ignore-aware)
- CLI wiring (`src/cli.ts`), docs (`docs/README.md`, `docs/decision-model-evaluation.md` cross-link)

## Acceptance criteria

- Given a documentation-only diff, when `aiw risk assess --json` runs, then tier is `passive` and no reviewer escalation is suggested.
- Given a diff touching an authentication module, when assessed, then tier is `high` with a reason naming the path and the security category.
- Given any invocation, when it completes, then no file under `.aiw/` changed (read-only proof in tests).
- Given `review_due`-style output, when a next step is warranted, then `next_command` executes successfully as printed (tested by executing it).
- Given `--escalate-item 2 --escalate-reason "..."`, when the base tier is `medium`, then output tier is `high`; escalation never lowers a tier.
- Given no decision model configured, when assessing, then classification is fully deterministic and offline.

## Non-goals

- No automatic gate skipping or approval bypass based on tier (tiers inform humans and agents; they do not decide).
- No review lifecycle/authority machinery (RDD's lineages and burns are out of scope — see ADR-001 Decision B).
- No model-only classification: deterministic rules are the floor; the model layer is optional refinement.

## Open questions

- Should `--ticket` bind the assessment into the checkpoint ledger for audit (write-only log, no approval state)?
- Which concrete path rules seed the six categories for this repository's own stack (self-hosting dogfood)?
- Should the light lane (OPP-001) consume `risk assess` output as an entry-criteria signal (advisory only)?
