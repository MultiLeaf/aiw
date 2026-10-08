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

- `src/decision.ts`: `DecisionConfig` (`.aiw/decision.yml`, flag-gated: `enabled` / `model` / `baseUrl`), a `DecisionProvider` with availability verification (`/api/tags`), typed question/response contracts, and `buildEvidenceTriageRequest` for pre-gate triage.
- `aiw decision status` and `aiw decision triage --artifact=<path>`: advisory `evidence_complete` (noul) and `gate` (`ready` / `needs-work`) decisions over any project artifact, with explicit confidence reporting.

Observed behavior on real plans: an evidence-free plan scored `gate: ready` with confidence 0.044 and `evidence_complete` 0.260, while a fully evidenced plan scored confidence 0.718 and `evidence_complete` 0.924 — low confidence signals an inconclusive decision rather than approval.

## Future integration points (advisory)

- **Recommendation ranking**: order capability recommendations by decision-model relevance to the confirmed profile.
- **Semantic re-ranking**: combine embedding recall (`aiw semantic query`) with clef re-ranking for sharper context selection during interpretation.

## Hard boundary (unchanged)

Decision-model output is `inferred` evidence with confidence, never `confirmed`. It can move an artifact to _pending review_, never to _approved_, and cannot replace the fingerprinted human approval ledger. This matches the existing approval contract and keeps the audit trail human-owned.
