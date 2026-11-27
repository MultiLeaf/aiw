# Technical Design: Hardening follow-ups

- Workflow ID: a5748466-09dc-40fd-8014-5b8158298375
- Ticket: AIW-002
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Specification v1 (approved)

## Context

Five localized fixes at named sites: the pr-gate forecast branch (src/workflow.ts ~3698), the plan-gate TC linkage (src/quality-gates.ts plan branch), `prReadinessSection` (src/completion-report.ts), `recordObserveDecision` (src/workflow.ts), and `clusterRejections`/CLI scan (src/rules-candidates.ts + src/workflow.ts). All are additive or behavior-tightening with testable boundaries; no schema or command changes.

## Proposed Design

### 1. Forecast targeting (REQ-001)

- The pr-gate branch reads the PR report's `## Branch` section (first line, `feature → base` shape) before auto-consuming. The declared feature branch is matched against the plan's task branches (`aiw/<plan.id>/<taskId>` prefix check: the declared branch starts with `aiw/<planId>/`, or the declared branch equals a task branch).
- Multi-checkpoint handling: iterate `orchestration-*.yml` checkpoints; for each, require a repo-level plan file whose id appears in the checkpoint filename (`orchestration-<id>.yml`); compute the forecast only when the plan id matches the declared branch prefix; on no match, skip auto-consumption silently (recorded evidence remains, exactly as the no-git fallback today). Single-plan repos keep today's behavior because the one plan either matches or is skipped — the "as today" case is a matching single plan.
- Plan files: `orchestration.yml` remains the canonical single plan; when additional `orchestration-<id>.yml` plan files exist at the repo root they are considered too (read, parsed, matched by id).

### 2. Wrapped TC lines (REQ-002)

- In the plan branch of `evaluateQualityGate`, define a case entry as the TC line plus following lines that are indented (start with whitespace) or list-continuations, up to the next case line (a line containing another `TC-###`) or section end. The linkage regex runs over the whole entry text, not the single line. Unlinked = no `REQ-\d+` anywhere in the entry.

### 3. Fence-tolerant section extraction (REQ-003)

- `prReadinessSection`'s `extract` builds the section body by scanning lines after the heading: track fenced-code state (lines starting with ``` toggle), and stop only at a line that is a heading (`^## `) **while not inside a fence**. Same logic replaces the section regex inside the helper; reports without fences behave identically (regex and scanner agree on them).

### 4. Observe log as YAML (REQ-004)

- `recordObserveDecision` serializes entries with the repo's `yaml` `stringify` to `checkpoints/workflow-<id>-observe.yml`. Reading: if the `.yml` file exists → parse YAML; else if a legacy `.json` file exists → parse JSON, migrate entries, write the YAML file (delete the JSON file). Cap 20 per stage unchanged; entry shape unchanged (stage/decision/issues/recordedAt).

### 5. Rules-candidates manual-entry preservation (REQ-005)

- The CLI scan merges instead of replacing: `candidates = [...clusterRejections(occurrences, prior), ...prior.filter(entry => !candidatesFromCluster.some(c => c.id === entry.id))]` — implemented as: clustered set (statuses preserved as today), plus prior entries whose id is not in the clustered set, appended unchanged. Dismissed entries keep their status because cluster regeneration already preserves prior status by id; the merge only adds protection for ids that no longer cluster.

## Alternatives

- Forecast targeting by workflow session linkage (recording the plan id in the session) — rejected: requires schema additions; the branch-prefix match needs no state.
- Dropping auto-consumption entirely (evidence-only) — rejected: loses the deterministic conflict check the design intentionally added.
- Replacing the plan-gate section regex with a full Markdown parser — rejected: dependency and scope growth for a two-line fix; the entry heuristic covers the wrapped-line case.
- Deleting legacy observe JSON without migration — rejected: NFR-001 requires lossless migration.

## Interfaces

- No new commands, flags, schema fields, or file formats (observe YAML is a format change of an internal checkpoint file, with migration).
- `clusterRejections` signature unchanged; the merge lives in the CLI scan branch.
- `prReadinessSection` stays private; extraction helper gains the fence-aware scanner.

## Risks

- Branch-name heuristics (prefix match) could miss renamed branches — fallback is the recorded evidence path, never a false block.
- The wrapped-line heuristic could over-merge adjacent cases — bounded by requiring the continuation to be indented; tests pin both directions.
- YAML observe migration must handle a corrupt legacy JSON file — falls back to empty entries as today's catch does.

## Validation

- REQ-001: multi-plan repo test (matching plan consumed, non-matching skipped, no-match falls back); single-plan regression unchanged.
- REQ-002: wrapped-line case passes; unlinked case still fails; same-line linkage unchanged.
- REQ-003: fenced `## ` inside a section body is included; fence-free reports identical.
- REQ-004: YAML write/read round-trip; legacy JSON migrated losslessly (entries preserved, JSON removed); cap enforced.
- REQ-005: manual entry survives rescan; dismissed status survives cluster reappearance.
- Project quality: `npm run check` exit 0; full suite green.

## Traceability

- REQ-001 → §1 | REQ-002 → §2 | REQ-003 → §3 | REQ-004 → §4 | REQ-005 → §5 | NFR-001 → §4 migration, §5 merge | NFR-002 → Interfaces (no surface change).
