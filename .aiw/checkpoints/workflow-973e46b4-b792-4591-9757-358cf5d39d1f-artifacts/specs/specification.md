# Specification: Embedding Retrieval — Covering-Test Detection and Judge Context Scoping

> Ticket: OPP-008
> Version: 0.1

## Purpose

Sharpen two flows with the existing semantic index: `risk assess`'s `untested_regression` sibling heuristic misses differently-named covering tests (false highs), and adversarial judges receive only the raw diff. Retrieval is an aid only: it can only prevent false `untested` flags; absence fails safe toward the flag standing. No new settings; unconfigured behavior is byte-identical and offline.

## Requirements

### REQ-001: Covering-test retrieval prevents false `untested_regression` flags

- **Description:** When semantic mapping is enabled and an index exists, for each high-risk-category source path without a sibling test, one scoped semantic query ("tests exercising this module") runs; top-k test-chunk hits count as covering evidence.
- **Acceptance criteria:**
  - Given an index and a test exercising the changed module from a differently named file, when `risk assess` runs, then `untested_regression` is not flagged and the reason set records `covering: semantic-retrieval` (advisory label distinguishing heuristic from retrieval).
  - Given retrieval finds no covering test, then `untested_regression` stands unchanged.
  - Given no semantic config or no index, when risk assess runs, then behavior is byte-identical to today and no embedding/network call is made.

### REQ-002: Retrieval never lowers tiers

- **Description:** Retrieval only prevents the `untested_regression` reason; tiers stay rule-based.
- **Acceptance criteria:**
  - Given retrieval-aided coverage on a change with other high-risk categories, when risk assess runs, then other reasons and the tier are unchanged from the deterministic outcome minus `untested_regression`.

### REQ-003: Judge prompts gain bounded retrieved context when available

- **Description:** Judge prompt rendering (OPP-003 skills) includes, when an index exists, top-k retrieved chunks relevant to the changed paths under a bounded token budget, labeled as context aids.
- **Acceptance criteria:**
  - Given judge context rendering with an index, then the rendered context contains retrieved chunks labeled as context aids within the existing token ceiling (diff takes priority; retrieved chunks fill the remainder).
  - Given no index, then judge context is exactly today's raw-diff behavior.

### REQ-004: Runtime degradation fails safe

- **Description:** When the embedding model is unavailable at runtime, flows degrade to deterministic behavior per the SEM contract.
- **Acceptance criteria:**
  - Given an enabled-but-unreachable embedding endpoint during risk assess, then the sibling heuristic outcome stands, no crash, and no tier change.

## Constraints

- Path-semantics-only queries (module/route terms from the changed path); no import/export symbol parsing (open question resolved: deterministic, simpler, fail-safe).
- No reindexing inside risk assess; index freshness remains `aiw scan`'s job (a stale index can only miss → fail safe).
- No new providers or settings sections; reuse the `semantic` gate.

## Traceability

- Backlog item OPP-008; opportunity doc `docs/opportunities/OPP-008-embedding-covering-tests-judge-context.md`; ADR-001 Decision A.
