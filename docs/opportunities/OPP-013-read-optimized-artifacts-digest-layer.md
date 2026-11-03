# OPP-013: Read-Optimized Artifacts — the Digest Layer

- Status: Implemented (2026-11-01): fingerprint-bound digests computed at approval; aiw digest and context --stage serve them stale-safe
- Priority: P1 (largest measurable token lever in the product)
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Measured baseline (this repository's own artifacts): a full-lane feature whose specification is ~2.2K tokens and plan ~4.1K tokens pays **~25-30K tokens in downstream re-reads alone** — the specification is re-read ~6-7× (plan, implementation, verification, review, traceability) and the plan ~4×. Writing artifacts is ~20% of their lifetime token cost; re-reading them is ~80%.

## Problem

Every artifact in the staged workflow is written once and read many times. The single dominant token cost of a full-lane feature is not authoring — it is downstream stages re-ingesting full artifacts to extract the handful of facts they need:

- `plan` needs the spec's requirement IDs and acceptance criteria — re-reads everything;
- `implementation` needs its task's linked requirements — re-reads the spec and the whole plan per task;
- `verification`/`review`/`traceability` need requirement→evidence mappings — re-read both.

Three methodologies shrink artifacts (ODD: fewer; HDAE: smaller; spec-kit: better templates). None attack the multiplier: **write once, read N×**. AI Workflow can be the first to formalize the separation: **full artifacts are for humans; agents get a derived, verifiable view**.

## Proposal

1. **Digest at the approval boundary**: when a stage passes its gate and receives human approval, aiw computes a structured **digest** from the exact approved bytes and stores it fingerprint-bound: `goal`, `scope` (one line), `requirements: [{id, one-line, criteria-ids}]`, `non-goals`, `decisions-open`, `links` (artifacts and commits). Deterministic extraction from required sections (the gate already enforces their presence) — **never a model-generated summary**.
2. **Downstream reads target digests by default**: `aiw context --stage=<stage>` (CTX-002's delta retrieval) returns the manifest of digests plus only the artifact sections a stage's manifest declares; full reads remain available (`--full`, or task-linked requirement sections by ID anchor).
3. **Digest integrity**: the digest records the artifact's SHA-256 fingerprint (already bound in `.aiw/approvals.yml`); a stale digest (artifact changed without re-gating) is reported as stale, never silently served — same semantics as approval staleness.
4. **Template-declared fields**: digests extract from the sections templates already mandate (`## Requirements`, `## Acceptance Criteria`, `## Tasks`, `## Validation`), so extraction is parse-not-guess; templates may declare additional digest fields per process (OPP-009).
5. **Read-path reporting**: `aiw token-usage` gains a digest row (served-digest vs full-read counts) so the saving is measured, not assumed.

## Affected areas

- `src/context-retrieval.ts` / `src/context-cache.ts` (digest store + default-read routing)
- `src/quality-gates.ts` (digest extraction validators per artifact type)
- `src/workflow.ts` (compute at approve; serve in stage flows), `src/token-usage.ts` (read-path accounting)
- `resources/templates/*` (digest field declarations), `docs/architecture.md`, `docs/token-efficiency.md`

## Acceptance criteria

- Given an approved specification, when a downstream stage requests context, then it receives the digest plus only declared sections; a full read happens only with an explicit flag or a linked-section reference.
- Given a digest, when the artifact's fingerprint no longer matches the approval ledger, then the digest is reported stale and the full artifact is required (fail-safe toward fidelity).
- Given the digest extraction, when the artifact lacks a mandated section, then the gate fails before approval (digests only exist for gate-passing artifacts).
- Given no flag changes, when a light-lane workflow runs, then behavior is unchanged (light tasks produce no durable artifacts to digest).
- Given a full-lane feature at the measured baseline, when downstream stages complete, then recorded full-artifact reads drop by at least 60% (served-digest accounting in `token-usage`).

## Non-goals

- No model-generated summaries, ever (a stochastic digest would void the fingerprint guarantee).
- No digest replacing the artifact for humans; no digest content beyond extraction from mandated sections.
- No change to gate or approval semantics — digests exist only downstream of approval.

## Open questions

- Digest storage: sidecar files (`.aiw/digests/<artifact>.yml`) vs front-matter appended to the artifact itself (one file, but touches approved bytes — likely sidecar, to keep approved artifacts immutable)?
- Anchor format for per-requirement reads (headings are stable; `REQ-\d+` IDs are already mandated).
- Do plan digests include per-task validation commands (OPP-014 pairs), or do those stay task-scoped?
