# Code Review: Hardening follow-ups

- Workflow ID: a5748466-09dc-40fd-8014-5b8158298375
- Ticket: AIW-002
- Date: 2026-11-27

## Scope

The TASK-001..TASK-005 diff: forecast targeting in the pr-gate branch (src/workflow.ts), wrapped-line TC linkage (src/quality-gates.ts), fence-aware extraction (src/completion-report.ts), YAML observe log with migration (src/workflow.ts), rules-candidates merge (src/workflow.ts), plus the five extended/new test suites.

## Findings

- F-1 (minor, behavior): the pr-gate forecast targeting reads the declared branch only from the *first* line of the Branch section (split on newline/→); a report whose branch line follows a blank line still works (trim handles it), but a multi-line preamble before the branch would mis-parse. The template pins the one-line format; bounded. triage: auto-fixable
- F-2 (info, robustness): legacy observe JSON removal depends on optional `fs.remove`; hosts without it retain a stale duplicate file. Documented deviation; YAML is authoritative. triage: judgment-required
- F-3 (info, consistency): the wrapped-TC continuation heuristic requires indented follow-lines; a non-indented continuation (rare in the documented format) is treated as a new entry and still fails linkage — conservative direction, matches REQ-002's "or still fails" criterion. triage: judgment-required

## Checks

- Full suite: 805 tests pass, including 10 new/extended tests for the five fixes.
- `npm run check` (format, eslint, tsc, build, vitest, security) → exit 0.
- Correctness review: forecast matching is conservative (prefix match on `aiw/<planId>/`, skip on no-match — never a false block); the fallback path is unchanged from the pre-hardening behavior.
- Migration review: observe YAML migration parses legacy JSON once, preserves entries, orders them before the new entry, and removes the JSON when the filesystem supports it; corrupt files degrade to empty as before.
- Safety review: rules-candidates merge only appends prior non-clustered entries; no status is ever downgraded (dismissed stays dismissed; accepted stays accepted).
- Regression: all pre-existing suites pass; no public interface changed (NFR-002).

## Residual Risks

- None blocking. F-1 is template-bounded; F-2/F-3 are documented conservative behaviors.

## Decision

Accept — every fix is local, test-covered, and conservative in its failure direction; findings are informational.
