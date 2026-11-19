# Decision Model Evaluation: jev/clef (clef-flash)

Status: implemented 2026-10-08 as an advisory triage layer behind a flag (`.aiw/decision.yml`, commands `aiw decision status` / `aiw decision triage`). It uses the `/v1/systemone` endpoint.

## What the model offers

Local inspection (`ollama show clef-flash:latest`, Ollama 0.40.1, MLX runner):

| Property                  | Value                                        |
| ------------------------- | -------------------------------------------- |
| Architecture              | `clef` (purpose-built decision model by jev) |
| Parameters / quantization | 9.5B, mxfp8, ~12 GB                          |
| Context                   | 262,144 tokens                               |
| Capabilities              | `decision`, `vision`                         |
| License                   | Apache 2.0                                   |

A dedicated decision model is architecturally attractive for AI Workflow: the SDD flow already separates automated quality gates from human approval, and an advisory triage layer between them could pre-screen evidence completeness, rank recommendations, and classify drift before a human reviews it.

## API

Clef Flash answers typed questions over a supplied state in a single non-autoregressive forward pass (Ollama `/v1/systemone`). Question types used by AI Workflow:

- `noul` — yes/no with the probability that the answer is true (`evidence_complete`).
- `choice` — ordered options with per-option probabilities (`gate`: `ready` / `needs-work`).

## Implemented integration

The earlier blocker (no exposed endpoint in Ollama 0.40.1) is resolved by the `/v1/systemone` endpoint documented at <https://ollama.com/library/clef-flash>. AI Workflow now ships the advisory layer:

- `src/decision.ts`: `DecisionConfig` (`.aiw/decision.yml`, flag-gated: `enabled` / `model` / `baseUrl` / optional `apiKeyEnv` for an external OpenAI-compatible endpoint with bearer authentication), a `DecisionProvider` with availability verification (`/api/tags` for Ollama, `/v1/models` with auth for external), typed question/response contracts, and `buildEvidenceTriageRequest` for pre-gate triage.
- `aiw decision status` and `aiw decision triage --artifact=<path>`: advisory `evidence_complete` (noul) and `gate` (`ready` / `needs-work`) decisions over any project artifact, with explicit confidence reporting.

Observed behavior on real plans: an evidence-free plan scored `gate: ready` with confidence 0.044 and `evidence_complete` 0.260, while a fully evidenced plan scored confidence 0.718 and `evidence_complete` 0.924 — low confidence signals an inconclusive decision rather than approval.

## Future integration points (advisory)

- **Recommendation ranking**: order capability recommendations by decision-model relevance to the confirmed profile. _Status:_ implemented 2026-10-08 behind `decision.enabled` — `aiw recommend` sends one `score` question per recommendation (with the confirmed profile summary and the recommendation rationale/evidence) through `/v1/systemone`, orders the output by advisory relevance, and serializes `decision_relevance` / `decision_confidence` per item. The ranking is advisory: evidence, confidence, and selection logic are unchanged, and without a decision model the deterministic order is preserved.
- **Semantic re-ranking**: combine embedding recall (`aiw semantic query`) with clef re-ranking for sharper context selection during interpretation.

## Hard boundary (unchanged)

Decision-model output is `inferred` evidence with confidence, never `confirmed`. It can move an artifact to _pending review_, never to _approved_, and cannot replace the fingerprinted human approval ledger. This matches the existing approval contract and keeps the audit trail human-owned.

## Implemented integration (OPP-007)

Two advisory flows ship (see [OPP-007](opportunities/OPP-007-decision-findings-triage-scope-watch.md)):

1. **Findings-evidence triage** — `aiw decision findings-triage --findings=<path>` always runs the deterministic shape check (severity present; proof references or `file:line` non-empty; unparseable input fails closed). When the decision model is enabled, one batched request asks "does the cited evidence support the claim?" per severe finding; answers are printed as advisory `evidence_supported: yes/no/unclear` flags and the refuter still owns corroboration/refutation. Provider failures degrade silently to shape-check-only output.
2. **Lane scope-watch** — light-lane completion always records the deterministic tier-vs-lane mismatch advisory (`risk assess` high on a light lane) in the light checkpoint and completion output; when the model is enabled, one additional advisory scope question (multi-subsystem footprint) is printed. Both notes never block, never change lanes, never change tiers.

Routing categories `review.findings-triage` and `workflow.lane-watch` follow the evidence-linked routing contract: rules with evidence are `evidenced`, without evidence `unevidenced-rule`, absent rules fall back safely. Unconfigured decision settings mean byte-identical behavior and zero network requests.
