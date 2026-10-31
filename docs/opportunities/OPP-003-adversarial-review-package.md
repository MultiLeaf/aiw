# OPP-003: Adversarial review package — blind judges and proof-carrying findings

- Status: Implemented (2026-10-30, plan Wave 6): skills shipped in the self-hosting package with content-rule tests; runtime permission wiring rides the existing package permission model
- Priority: P3
- Added: 2026-10-30
- Decision: [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md), Decision A

## Problem

AI Workflow's review stage uses the `code-review` skill when installed, but findings are accepted as written: nothing in the workflow attempts to _refute_ severe claims, no second independent reviewer cross-checks the first, and findings do not have to carry reproducing evidence. The result is both false positives (blocking work on an unreal defect) and unearned authority (a plausible-sounding severe finding with no proof).

## Source concept (RDD / Judgment Day)

Two Gentle-AI mechanisms address exactly this:

1. **Refuter**: every severe (BLOCKER/CRITICAL) finding with candidate causality reaches an adversarial pass that may confirm or **drop** the claim. On runtimes that support isolation (e.g., Codex), the refuter may run one reproducing command per claim inside a disposable scratch directory (fresh `mktemp -d`, no network, sandboxed, destroyed afterwards); the finding must cite the command and its observed output. A refuted finding becomes an `advisory`; corroborated and inconclusive findings go forward. Non-severe findings never reach the refuter.
2. **Judgment Day blind judges**: review by two independent judge agents (`jd-judge-a`, `jd-judge-b`) plus a fix agent (`jd-fix-agent`), so no single reviewer's output is authoritative.

References:

- Gentle-AI `docs/review-integration.md`, section "Refuter probe" (isolation matrix per runtime, proof requirements, `probe unavailable on <runtime>` honesty marker)
- Gentle-AI `docs/kiro.md`, section "ODD Execution Model" — Judgment Day adversarial review agents

## Proposal

Ship an **optional versioned resource package** `adversarial-review` through the existing package model and registry:

1. Package contents:
   - `review-judge-a` and `review-judge-b` agent/skill definitions: two independent reviewers of the same diff, each reporting findings with severity and required evidence fields; neither sees the other's output (blind).
   - `review-refuter` skill: takes severe findings and attempts to refute each — by reading cited code, and, where the host runtime supports safe isolation, by running the cited reproducing command in a disposable directory; marks each finding `corroborated` / `refuted` / `inconclusive` with proof references.
   - Rules rendered into the workflow's review stage: a severe finding without a reproducing command or file:line evidence degrades to `advisory`; only `corroborated` severe findings can block.
2. Integration points:
   - Declared in the package manifest with permissions (needs command execution for the refuter — flagged as a sensitive capability through the existing package permission/policy model).
   - The review stage template/skill references the package when installed; the existing rule applies that a human must still accept the review outcome.
3. Honesty markers: when the host runtime cannot isolate command execution, the refuter marks results accordingly (the RDD pattern: state that no command ran, rather than implying verification).

## Affected areas

- `resources/` (new package), `resources/package.yaml` conventions
- `src/package-audit.ts` / `src/policy-gate.ts` (refuter execution is a sensitive capability needing explicit permission)
- Review-stage skill templates and `docs/README.md` review section (currently: "Code review is performed with the `code-review` skill when installed")
- Registry listing (`src/registry.ts`)

## Acceptance criteria

- Given the package installed, when the review stage runs, then two blind judges receive the same diff independently and produce separately attributable findings.
- Given a severe finding without a reproducing command or file:line evidence, when the refuter processes it, then it is downgraded to `advisory` with the reason recorded.
- Given a severe finding whose cited command fails to reproduce the defect, when the refuter runs it (isolated runtime), then the finding is marked `refuted` and does not block.
- Given a runtime without isolation support, when the refuter runs, then results carry an explicit "no command executed" marker rather than silent omission.
- Given the package's execution permission, when it is not granted, then the refuter degrades to evidence-reading mode and the outcome states so.
- Human acceptance of the review outcome remains required (package never auto-accepts).

## Non-goals

- No new CLI gate command for review (the existing contract stays: code review via skill, human accepts outcome).
- No frozen synthetic trees or review authority machinery (ADR-001 Decision B); the package operates on the working diff/cited files.
- No requirement that both judges agree: disagreement is reported, not averaged away.

## Open questions

- Should judge outputs be recorded under `.aiw/generated/artifacts/` as versioned review evidence for the traceability graph?
- Which target adapters can safely host isolated command execution for the refuter (Codex sandbox vs Claude Code vs local-only)?
- Package name and whether `code-review` (existing) becomes judge-a or stays separate.
