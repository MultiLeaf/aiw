# Specification: End-to-end flow from idea to merge-ready PR

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Brainstorm v1 (approved), research artifact 7a2fb5f9

## Context

ai-workflow gates a feature from brainstorm to traceability, then stops with a usage report. The approved goal is a continuous, gated flow that ends in a merge-ready pull request: CI green, review comments resolved, no merge conflicts, all recorded as evidence. This specification resolves the brainstorm's open questions and defines five additive capabilities. Design decisions taken here (each resolves a brainstorm open question):

- **D1 (PR execution boundary):** the CLI adds no forge/network commands. The host agent executes `gh`/git; aiw provides the stage, gates, templates, and evidence recording (consistent with docs/trust-boundaries.md).
- **D2 (CI observation):** CI results are recorded evidence (command + result + link), not CLI polling.
- **D3 (PRD placement):** optional stage `product-requirements` between brainstorming and specification, with its own template and light gate; skipping requires explicit human acceptance (existing skip mechanics).
- **D4 (QA matrix):** test-plan.md is wired at both ends — the plan gate requires tasks to reference test cases, and verification requires executed-case evidence.
- **D5 (Merge-ready criteria):** the final gate checks locally verifiable evidence (recorded CI result, unresolved-comment count, conflict forecast) and presents the rest (branch protection, approvals) as an explicit human checklist item.

## Requirements

### REQ-001: PR stage with merge-ready gate

- **Description:** A new stage `pr` after `traceability` takes the workflow from completed evidence to an open, merge-ready pull request, with a quality gate over a PR-readiness report.
- **Acceptance criteria:**
  - Given a workflow whose `traceability` stage is approved
  - When the PR stage is gated with its artifact present
  - Then the gate requires a report with: PR reference (URL/number), branch and base, CI evidence (command + result + link), unresolved review comments count with resolution evidence, conflict-check evidence, and a merge-ready checklist
  - And the gate fails with actionable findings when any section is missing or declares unresolved items (CI failed, comments > 0, conflicts present)
  - And the report template is scaffolded by an `aiw pr` command that also prints host-side instructions (`gh pr create …`) without executing them
  - And `workflow complete` is only reachable after the `pr` stage is approved (or explicitly skipped with human acceptance, for local-only workflows)

### REQ-002: PRD as an optional stage

- **Description:** An optional `product-requirements` stage between brainstorming and specification captures user-facing intent (problem, users, outcomes, non-goals) before technical requirements.
- **Acceptance criteria:**
  - Given an active feature workflow
  - When `aiw prd --title=…` runs (or the stage is scaffolded by the flow)
  - Then a PRD artifact is created from a template with sections Problem, Users, Outcomes, Non-goals, Success signals
  - And its quality gate fails when required sections are missing or empty
  - And the stage can be skipped only with an explicit human-approved reason (existing skip mechanics), and specification proceeds identically whether the stage ran or was skipped
  - And the specification digest cites the PRD when present

### REQ-003: QA test matrix wired into plan and verification

- **Description:** The existing test-plan template becomes a gated artifact linking requirements → test cases → tasks, with execution evidence at verification.
- **Acceptance criteria:**
  - Given an implementation plan
  - When the plan gate runs
  - Then the plan must reference a test plan whose cases carry IDs (TC-###) and each case links to at least one REQ-###; the gate fails when cases are missing or unlinked
  - And the verification gate requires executed-case evidence: each TC-### with a result (pass/fail) and the command that ran it
  - And the traceability graph includes TC links between requirements and tests

### REQ-004: ADR enforcement in technical-design

- **Description:** The technical-design gate requires ADRs for consequential decisions declared by the design.
- **Acceptance criteria:**
  - Given a technical-design report
  - When its gate runs
  - Then the report must list each consequential decision with a linked ADR path (`.context/adrs/ADR-*.md`)
  - And the gate fails when a declared decision lacks an existing ADR file (path missing or file absent)
  - And designs that declare no consequential decisions pass with an explicit "None" statement

### REQ-005: PR-readiness completion report

- **Description:** `workflow complete` reports end-to-end readiness, extending the current usage report with PR status.
- **Acceptance criteria:**
  - Given a workflow completing after the `pr` stage
  - When completion runs
  - Then the completion report includes PR reference, CI result, unresolved-comment count, conflict status, and the merge-ready decision with links to the underlying evidence
  - And for workflows without a PR (skipped stage), the report states so explicitly

## Non-functional Requirements

- **NFR-001 Portability:** no forge-specific code in the core CLI; all forge interaction stays host-side (D1).
- **NFR-002 Backwards compatibility:** existing workflows without the new stages complete as today; new stages are optional or append-only in the process definition; artifact paths follow the workflow-scoped layout.
- **NFR-003 Human gates:** every new stage keeps mandatory human approval; merge decisions stay human (non-goal: auto-merge).
- **NFR-004 Trust boundaries:** no new network/subprocess surface in the CLI; evidence is recorded, not fetched.

## Constraints

- Existing processes (feature/bugfix/idea-assessment) must keep their current stage lists unless explicitly configured; the `pr` stage appends to the feature process.
- The QA matrix must reuse the existing test-plan template structure, extended with IDs, not a new parallel format.
- Gate findings follow the existing blocking-reason vocabulary (additive codes allowed).

## Open Questions

- Exact stage ordering when `product-requirements` is skipped vs. run in the bugfix process (does bugfix get a PRD stage at all?) — decide in technical design.
- Whether the `pr` stage gate should also consume `aiw orchestrate integrate`'s conflict forecast automatically or accept recorded evidence only — decide in technical design.
- TC-ID vocabulary and whether the traceability YAML schema needs a new link field or reuses `tests` — decide in technical design.

## Traceability Seeds

- Scope candidates → requirements: brainstorm candidate 1 → REQ-001; 2 → REQ-002; 3 → REQ-003; 4 → REQ-004; 5 → REQ-005.
- Research findings F-3..F-9 back the corresponding requirements (see research artifact).
