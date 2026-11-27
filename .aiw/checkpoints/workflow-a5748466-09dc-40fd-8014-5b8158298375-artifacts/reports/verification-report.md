# Verification Report: Hardening follow-ups

- Workflow ID: a5748466-09dc-40fd-8014-5b8158298375
- Ticket: AIW-002
- Date: 2026-11-27

## Requirements Checked

- REQ-001: PR gate consumes the matching orchestration plan.
- REQ-002: Plan gate accepts REQ links on wrapped TC lines.
- REQ-003: PR-readiness section extraction tolerates code fences.
- REQ-004: Observe log uses YAML with lossless legacy migration.
- REQ-005: Rules-candidates rescan preserves manual entries.
- NFR-001 (backwards compatibility), NFR-002 (no behavior broadening).

## Checks Passed

- `npx vitest run` (full suite): 805 tests passed, 0 failures.
- `npm run check` (format:check + eslint + tsc + build + vitest + security:check) → exit 0.
- `aiw verify` → "Verification passed: requirements have acceptance criteria and validation coverage."
- REQ-001 acceptance: with a matching declared branch (`aiw/plan1/TASK-001 → main`), the forecast is consumed and real git conflicts block the gate; with a non-matching branch and an unrelated checkpoint present, the gate passes on recorded evidence (no false block); the single-plan conflict regression passes.
- REQ-002 acceptance: `TC-001: login flow` followed by an indented `covers REQ-001` passes the linkage check; a case with no REQ anywhere in its entry still fails.
- REQ-003 acceptance: a fenced ``` block containing `## inner heading is content` is extracted as section body; the next real heading (Review Comments) still terminates the section.
- REQ-004 acceptance: the observe log is written to `workflow-<id>-observe.yml` in YAML; a pre-existing legacy JSON file's entries are preserved and the JSON file is removed after migration; the 20-per-stage cap is unchanged (existing tests).
- REQ-005 acceptance: a manually added accepted candidate (`rc-manual-rule`) survives rescans unchanged; a dismissed clustered candidate stays dismissed when its cluster reappears; the manual entry's status is unaffected by the dismiss flow.
- NFR-001: existing plans, reports, observe JSON (migrated), and rules-candidates files all continue to work — full pre-existing suite passes.
- NFR-002: no new commands, flags, schema fields, or file formats; every change is local to the five named sites.

## Missing Evidence

None.

## Residual Risks

- Feature-named PR branches (not `aiw/<planId>/…`) never trigger forecast auto-consumption — conservative by design; recorded evidence still gates.
- Filesystems without `fs.remove` keep the legacy observe JSON after migration (harmless duplicate; YAML is authoritative).

## Decision

Complete.

## Test Results

- TC-001: forecast matching + conflict block pass (REQ-001) — `npx vitest run src/workflow-pr.test.ts` pass
- TC-002: non-matching branch fallback pass (REQ-001) — `npx vitest run src/workflow-pr.test.ts` pass
- TC-003: wrapped TC linkage pass (REQ-002) — `npx vitest run src/quality-gates.test.ts` pass
- TC-004: fence-tolerant extraction pass (REQ-003) — `npx vitest run src/completion-report.test.ts` pass
- TC-005: YAML migration pass (REQ-004) — `npx vitest run src/workflow-observe.test.ts` pass
- TC-006: manual entry preservation pass (REQ-005) — `npx vitest run src/rules-candidates.test.ts` pass

## Validation

- TASK-001: Validation: `npx vitest run src/workflow-pr.test.ts` → exit 0
- TASK-002: Validation: `npx vitest run src/quality-gates.test.ts` → exit 0
- TASK-003: Validation: `npx vitest run src/completion-report.test.ts` → exit 0
- TASK-004: Validation: `npx vitest run src/workflow-observe.test.ts` → exit 0
- TASK-005: Validation: `npx vitest run src/rules-candidates.test.ts` → exit 0
