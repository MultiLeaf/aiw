# OPP-007: Decision model — findings-evidence triage and lane scope-watch

- Status: Proposed
- Priority: P3
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A (model-integration addendum)
- Companion: [OPP-008](OPP-008-embedding-covering-tests-judge-context.md)

## Problem

Two implemented flows have deterministic guards with semantic blind spots:

1. **Adversarial review (OPP-003)**: a severe finding can be structurally well-formed (has `file:line`, has a command) while the cited evidence does not actually support the claim. The refuter catches this only for findings it processes — and a weak first filter passes noise downstream.
2. **Light lane (OPP-001)**: lane abuse (substantial work routed as light) is currently caught by deterministic mismatch signals only (`risk assess` tier vs lane). What deterministic rules cannot see: 80 lines spread across three subsystems _is_ substantial even when every path rule stays quiet.

Meanwhile the existing `aiw decision triage` keeps serving full-lane artifacts but is not connected to either gap — and its cost profile is already proportional: light-lane tasks produce no artifacts, so there is nothing to triage and the model spend is zero by construction.

## Source concept

- Spec NFR-2/NFR-3 (odd-rdd-proportionality spec): deterministic floor first; models advisory-only, never change evidence states, gates, or approvals.
- `buildEvidenceTriageRequest` (`src/decision.ts`) already asks "does this artifact include concrete verification evidence for every stated requirement" — the same pattern aimed at judge findings.
- `src/model-routing.ts`: advisory per-category routing with named evidence — the natural assignment mechanism (categories such as `review.findings-triage`, `workflow.lane-watch`), no new machinery.
- ADR-001 principle: ceremony scales with consequence — model spend scales the same way (where ceremony survived, value density is highest; where it shrank, cost is already zero).

## Proposal

1. **Findings triage** (pairs with OPP-003, prerequisite for the diversity-judge idea): a deterministic shape check always runs (severity present; proof references or `file:line` non-empty) — pure parse. When the decision model is enabled, each severe finding additionally gets one triage question ("does the cited evidence support the claim?") recorded as an advisory `evidence_supported: yes/no/unclear` flag next to the finding. The refuter still owns corroboration/refutation; degradation to advisory stays governed by OPP-003's rules; the flag never blocks by itself.
2. **Lane scope-watch** (pairs with OPP-001): on light-lane `task start` when `risk assess` reports `high`, and on light-lane completion, a mismatch notice is recorded. The deterministic part (tier vs lane mismatch) runs always; the model adds the semantic dimension (multi-subsystem footprint) only when enabled. Recorded as an advisory note in the checkpoint/ledger; never blocks, never changes the lane.
3. **Routing and settings**: new `routing.yml` categories with evidence links; everything gated by the existing `decision` settings section; unconfigured means zero behavior change and zero network (NFR-2).

## Affected areas

- `src/decision.ts` (new request builders: findings triage, lane watch)
- `src/workflow.ts` (light-lane complete/escalate advisory notice), `src/risk-assess.ts` (mismatch signal hook)
- OPP-003 integration point (review-refuter skill contract note; runtime wiring lands with OPP-003's runtime phase)
- `src/model-routing.ts` categories; `docs/decision-model-evaluation.md`

## Acceptance criteria

- Given the decision model unconfigured, when review or lane flows run, then behavior is byte-identical to today and no network request is made.
- Given a severe finding whose cited `file:line` does not support the claim, when triage runs enabled, then the finding carries the advisory flag and the refuter still decides corroboration.
- Given a light-lane start or completion with a `high` deterministic risk signal, then a mismatch note is recorded even without any model.
- Given any model output, then no evidence state, gate outcome, or approval changes (NFR-3); human acceptance is unchanged.
- Given `routing.yml`, then the new categories carry evidence links; unevidenced rules are labeled `unevidenced-rule`.

## Non-goals

- The decision model never judges finding correctness (that is the refuter on the host agent's model), never lowers risk tiers, never chooses lanes, never blocks, never replaces human acceptance.
- No new settings sections beyond the existing `decision` gate; no per-finding model calls without a batched alternative evaluated first.

## Open questions

- Per-finding triage (n calls, stronger isolation) vs one batched request (cheaper, weaker)? Measure on the self-hosting package's own review artifacts.
- Does scope-watch belong only in `workflow complete` output, or also in `task status`?
