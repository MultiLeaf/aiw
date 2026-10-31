# OPP-008: Embedding retrieval — covering-test detection and judge context scoping

- Status: Proposed
- Priority: P3
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A (model-integration addendum)
- Companion: [OPP-007](OPP-007-decision-findings-triage-scope-watch.md)

## Problem

Three implemented flows use weak approximations where the existing semantic index would materially sharpen results, and one new flow spends tokens where retrieval would save them:

1. **`untested_regression` in `risk assess` (OPP-002)** uses a sibling-file heuristic (`src/x.ts` → `src/x.test.ts`). A test exercising the changed module from a differently named file (`integration.spec.ts` via the public API) is invisible → false `high` flags.
2. **Adversarial judges (OPP-003)** receive the raw diff; related unchanged code (callers, consumed contracts) is missed or fetched ad hoc by the frontier model — the expensive way.
3. The semantic index (SEM-001…006) already exists and proved the pattern (SEM-006: scoped context reduced tokens without quality regression), but nothing in the new flows consumes it.

## Source concept

- ODD token economics: ceremony shrank, so spend shifted from writing/reading artifacts to **reviewing changes** — retrieval should target the new spend.
- Spec NFR-2: deterministic floor first — the sibling heuristic remains the exact no-model behavior; retrieval only _prevents false positives_ (retrieval absence never implies low risk: no covering test found → the flag stands).
- SEM contract: retrieval results are aids, never confirmed facts; stale index fails safe toward `high`.

## Proposal

1. **Covering-test retrieval** (pairs with OPP-002): when semantic mapping is enabled and an index exists, for each high-risk-category source path run one scoped semantic query ("tests exercising this module/symbol"). Top-k test-chunk hits count as covering evidence; none found → `untested_regression` stands. Retrieval-aided verdicts are labeled in reasons (`covering: semantic-retrieval`) so audits can distinguish heuristic from retrieval. Unconfigured: sibling heuristic exactly as today.
2. **Judge context scoping** (pairs with OPP-003): when rendering judge prompts with an index available, include the diff plus top-k retrieved chunks for changed symbols (callers, types, contracts) under a bounded token budget, labeled as context aids. Unconfigured: judges get the raw diff as today.
3. Both flow through the existing `semantic` settings gate and the chunk index built by `aiw scan` — no new settings, no reindexing inside risk assess (freshness stays `scan`'s job; a stale index can only miss, which fails safe toward `high`).

## Affected areas

- `src/risk-assess.ts` (covering-test probe gains an optional retrieval provider; deterministic fallback unchanged)
- `src/semantic.ts` (query reuse; symbol-aware scoped query helper)
- OPP-003 judge skill rendering (`resources/skills/review-judge-a.md`, `review-judge-b.md`: context sections are retrieval aids, never facts)
- `docs/semantic-mapping.md`; cross-links from [OPP-002](OPP-002-risk-assess-command.md) and [OPP-003](OPP-003-adversarial-review-package.md)

## Acceptance criteria

- Given no semantic config, when risk assess or judge prompts render, then behavior is byte-identical to today and offline.
- Given an index and a test exercising the changed module from a differently named file, when risk assess runs, then `untested_regression` is not flagged and the reason records `covering: semantic-retrieval`.
- Given retrieval finds no covering test, then `untested_regression` stands.
- Given judge prompt rendering with an index, then prompts include bounded retrieved chunks labeled as context aids within existing token ceilings.
- Given the embedding model unavailable at runtime, then flows degrade to deterministic behavior per the SEM contract.

## Non-goals

- No model-driven risk _tier_ changes: retrieval only prevents false `untested` flags; tiers stay rule-based.
- No new providers or settings sections; no reindexing inside risk assess.

## Open questions

- Symbol extraction for queries: deterministic import/export parsing vs path-semantics-only queries?
- Judge prompt budget: how to split the token ceiling between the diff and retrieved chunks?
