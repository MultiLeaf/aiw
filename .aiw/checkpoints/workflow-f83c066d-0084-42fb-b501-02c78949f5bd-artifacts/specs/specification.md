# Specification: Bounded Research Skill

> Ticket: RES-001
> Version: 0.1

## Purpose

Package a `research` skill that turns a bounded question (error, log signature, migration implication, external library behavior) into an evidence-first, budget-capped investigation recorded as a durable artifact for downstream stages. The host agent performs the investigation; the skill defines the contract. AIW stays deterministic and offline.

## Requirements

### REQ-001: The skill enforces a scope gate and budget

- **Description:** The skill text requires one investigable question plus an explicit source list before work starts, and caps effort with a step/turn budget and stop conditions.
- **Acceptance criteria:**
  - Given a vague or multi-question request, when the skill runs, then it refuses to start until the human confirms a single question and a bounded source list.
  - Given active research, when the budget or a stop condition is reached, then the skill converges: reports what was verified, what remains open, and stops.
  - Given scope growth beyond the question, when detected, then the skill escalates (suggest a workflow / diagnosis) instead of continuing open-ended.

### REQ-002: Findings are evidence-first with verified citations

- **Description:** Every finding must cite a verifiable source: `file:line`, log line with timestamp, or URL with consultation date; facts, hypotheses, and unverified claims are separated.
- **Acceptance criteria:**
  - Given any finding in the artifact, when reviewed, then it carries a citation and a state (fact / hypothesis / unverified).
  - Given a claim without a verifiable citation, when the artifact is assembled, then it is recorded as an open question, never as a finding.

### REQ-003: External research redacts secrets and records provenance

- **Description:** Host-side web/doc searches follow a privacy contract: secrets redacted before querying; every external source recorded with URL and consultation date.
- **Acceptance criteria:**
  - Given external research, when results enter the artifact, then each entry names its URL and consultation date.
  - Given potential secrets in logs/excerpts, when persisting them, then the skill instructs redaction before writing or querying.

### REQ-004: The investigation produces a durable workflow-scoped artifact

- **Description:** The output is `.aiw/generated/reports/<workflowId>/research.md` (or the light-lane evidence note when no workflow is active), consumable by brainstorm/specification/diagnosis.
- **Acceptance criteria:**
  - Given a completed bounded research task, when the skill finishes, then the artifact contains question, sources, findings with citations and confidence (reusing the scan evidence/confidence vocabulary), budget usage, and open questions.
  - Given an active light-lane session, when research completes, then the summary is recorded via `aiw task evidence --validation=...` naming the artifact path.
  - Given no active workflow, when research completes, then the skill instructs starting a light-lane task first (artifact paths are workflow-scoped).

### REQ-005: The skill ships as a packaged resource with eval contracts

- **Description:** `resources/skills/research.md` ships in the package, is recommended appropriately, and passes the generated-skill eval contracts.
- **Acceptance criteria:**
  - Given the packaged resources, when validated, then `research` is present, English, and contract-valid.
  - Given a scan/recommendation run on a project with error/log signals or question-shaped requests, when recommendations render, then the research capability is offered (advisory, manually selectable; never auto-installed).
  - Given the eval suite, when it runs, then the research skill's contract invariants hold.

## Constraints

- No new CLI commands, no new settings sections, no network transport in AIW core.
- Advisory-only: no gates, no approvals, no evidence-state changes.
- Reuse the existing evidence/confidence vocabulary from scan facts.

## Traceability

- Brainstorm artifact (this workflow); analysis preceding ticket RES-001.
