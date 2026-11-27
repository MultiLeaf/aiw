# Specification: Hardening follow-ups

- Workflow ID: a5748466-09dc-40fd-8014-5b8158298375
- Ticket: AIW-002
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Code-review findings F-1/F-2/F-3 (workflow 72b951e7) and F-1/F-3 (workflow 4f3eab42).

## Context

Five minor hardening fixes accumulated from the code reviews of the last two features. Each is small, self-contained, and has no open design question. This ticket bundles them so they ship as one reviewable change; the policy-resolver wiring (the remaining larger follow-up) is explicitly out of scope.

## Requirements

### REQ-001: PR gate consumes the matching orchestration plan

- **Description:** The pr-stage gate's forecast auto-consumption must target the orchestration plan that matches the PR's branch instead of the first checkpoint found.
- **Acceptance criteria:**
  - Given an active workflow in the pr stage with multiple `checkpoints/orchestration-*.yml` files and a repo-level `orchestration.yml`
  - When the pr gate runs
  - Then the forecast is computed only from a plan whose task branches relate to the PR report's declared branch, or — when no match exists — the gate skips auto-consumption and relies on recorded evidence without failing
  - And a repository with a single plan behaves exactly as today

### REQ-002: Plan gate accepts REQ links on wrapped TC lines

- **Description:** The TC↔REQ linkage check in the plan gate must treat a test-case entry as the case line plus its following indented lines, so a REQ reference wrapped to the next line still counts as linked.
- **Acceptance criteria:**
  - Given a plan Test Plan section where a TC-### line's REQ-### reference appears on an immediately following (indented) line
  - When the plan gate runs
  - Then that case passes the linkage check
  - And unlinked cases (no REQ anywhere in the case entry) still fail

### REQ-003: PR-readiness section extraction tolerates code fences

- **Description:** `prReadinessSection` (completion report) must extract a heading's content up to the next heading line at the same level, ignoring `## ` occurrences inside fenced code blocks.
- **Acceptance criteria:**
  - Given a pr-readiness report whose section body contains a fenced code block including a `## ` line
  - When the completion report is built
  - Then the section is extracted through the fenced block, not truncated at it
  - And reports without fences behave as today

### REQ-004: Observe log uses YAML like sibling checkpoints

- **Description:** The observe-decision checkpoint file changes from JSON to YAML, matching every other file in `checkpoints/`.
- **Acceptance criteria:**
  - Given a workflow recording observe decisions
  - When the decisions are written
  - Then `checkpoints/workflow-<id>-observe.yml` contains the same entries in YAML form
  - And an existing legacy JSON file is read once for migration (entries preserved) before being rewritten as YAML
  - And the cap of 20 decisions per stage is unchanged

### REQ-005: Rules-candidates rescan preserves manual entries

- **Description:** `aiw rules-candidates` scanning must keep candidate entries that were not derived from the current rejection evidence (manual additions), not drop them.
- **Acceptance criteria:**
  - Given a rules-candidates file containing an entry whose id does not match any current cluster
  - When the scan runs
  - Then that entry is preserved unchanged (id, summary, occurrences, status)
  - And clustered entries are regenerated as today, with prior statuses preserved
  - And dismissed entries are not re-proposed as drafts when their cluster re-appears (status remains dismissed)

## Non-functional Requirements

- **NFR-001 Backwards compatibility:** existing reports, plans, observe logs (JSON), and rules-candidates files continue to work; the observe migration is lossless.
- **NFR-002 No behavior broadening:** each fix is strictly local to the named function/command; no gate criteria change beyond the acceptance criteria above.

## Constraints

- No new commands, stages, or schema fields.
- The forecast targeting must not shell out beyond the git usage already present in `forecastIntegration`.

## Open Questions

None — every fix has a single named implementation site and a testable acceptance criterion.
