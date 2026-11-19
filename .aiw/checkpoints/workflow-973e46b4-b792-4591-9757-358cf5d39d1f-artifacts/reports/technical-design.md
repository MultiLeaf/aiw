# Technical Design: Embedding Covering-Test Detection and Judge Context Scoping

> Ticket: OPP-008 · Spec REQ-001…REQ-004

## Context

`src/risk-assess.ts` injects a sibling-file `hasCoveringTest` probe into `assessRisk`; `src/semantic.ts` has `querySemanticIndex` + Ollama embedding provider gated by `loadSemanticConfig`; OPP-003 judges are skill markdown without runtime rendering. Design follows OPP-007's pattern: pure helpers + CLI surface + skill doc updates; deterministic floor unchanged.

## Proposed Design

### 1. `src/semantic.ts` — retrieval helpers

- `buildCoveringTestQuery(path: string): string` — path-semantics only: split the changed file path into module terms (drop extension, split `-_/`, drop generic segments like `src`, `index`, `test`) → query "tests exercising <module terms>".
- `semanticCoveringEvidence(fs, aiwPath, paths, provider?)` → `{ covering: Set<path>, degraded: boolean } | undefined` — `undefined` when semantic config disabled or no index (callers keep the sibling heuristic byte-identically). For each high-risk source path lacking a sibling test, one `querySemanticIndex` call; a hit counts when a top-k chunk's file matches test patterns (`\.test\.`, `\.spec\.`, `(^|/)tests?/`). Provider/embedding failure → `degraded: true` with empty set (REQ-004).
- `renderJudgeContext(diff, chunks, budget)` — pure: diff first; retrieved chunks fill the remaining budget; each labeled `context aid (retrieval — not a confirmed fact)`.

### 2. `src/risk-assess.ts` — retrieval-aided probe

- In `runRiskAssess`, after the deterministic assessment: when `semanticCoveringEvidence` returns hits, remove `untested_regression` reasons for covered paths **only** (tiers recompute rule-based from remaining reasons — REQ-002), and record an audit line `covering: semantic-retrieval` (stdout; `covering_evidence` array in `--json`) listing the covered paths (REQ-001 label requirement).
- Zero calls and byte-identical output when the helper returns `undefined`.

### 3. Judge context CLI + skills

- New subcommand `aiw semantic judge-context --paths=<csv> [--budget=N]` — requires enabled config + index; prints the bounded context-aids block; errors with an advisory (exit 1, no network) when unavailable. Default budget reuses the interpreter's context ceiling constant.
- `resources/skills/review-judge-a.md`, `review-judge-b.md`, `review-refuter.md`: one optional line — when `aiw semantic judge-context` is available, its output is a context aid, never evidence.

### 4. Docs

- `docs/semantic-mapping.md`: covering-test retrieval + judge-context sections with fail-safe rules; cross-link OPP-002/OPP-008.

## Interfaces

- `buildCoveringTestQuery(path: string): string`
- `semanticCoveringEvidence(fs, aiwPath, paths: string[]): Promise<{ covering: string[]; degraded: boolean } | undefined>`
- `renderJudgeContext(diff: string, chunks: { file: string; excerpt: string }[], budget: number): string`

## Alternatives

- Symbol/import parsing for queries — richer but nondeterministic across languages; rejected (spec constraint).
- Reindex inside risk assess — violates freshness ownership and adds latency; a stale index can only miss, which fails safe.

## Risks

- One embedding call per uncovered high-risk path could add latency on large diffs — bounded by high-risk category paths only; measured in tests via a counting fake provider.
- Reason removal must not touch other categories — covered by REQ-002 tests.

## Validation

- Unit: query builder, covering evidence (hit/miss/degraded/undefined), judge context rendering budget order.
- CLI: risk assess with index + differently-named covering test (no flag, `covering: semantic-retrieval` line, tier unchanged); no config byte-identical; judge-context subcommand output/budget/unavailable advisory.
- Full `npm run check`.
