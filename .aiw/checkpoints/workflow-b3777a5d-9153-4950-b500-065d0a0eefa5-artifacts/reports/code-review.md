# Code Review

## Scope

OPP-007 diff: `src/decision.ts` (findings model + builders), `src/workflow.ts` (findings-triage subcommand + light-lane advisories), tests, `docs/decision-model-evaluation.md`.

## Findings

None blocking. Advisory notes:
1. `parseReviewFindings` is a permissive line-scanner, not a full YAML parse — intentional fail-closed trade-off (unparseable entries drop out and `checkFindingShapes` reports "No parsable findings" for empty sets); documented in tests.
2. The scope-watch request sends changed-path names only (no contents) as state — consistent with the interpreter's privacy guardrails.

## Checks

- Diff reviewed against the approved design (builders, CLI surface, lane advisories, routing).
- Advisory-only invariants verified: no gate/approval/evidence-state changes on any model path; provider failures swallowed with shape-check-only output; exit codes unaffected.
- Unconfigured paths assert zero provider calls (fake provider throws if called).
- Deterministic shape check is pure parse; no network.

## Residual Risks

None beyond the advisory notes.

## Decision

Accept.
