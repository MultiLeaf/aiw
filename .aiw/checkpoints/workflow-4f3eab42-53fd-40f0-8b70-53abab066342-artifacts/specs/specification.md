# Improve ai-workflow using post-PR automation patterns

- Workflow ID: 4f3eab42-53fd-40f0-8b70-53abab066342
- Version: 1 (draft)
- Date: 2026-11-27
- Source: Brainstorm v1 (approved), Claude Ship article analysis

## Context

ai-workflow runs spec-driven development with AI agents across stages (brainstorming, specification, design, plan, implementation, verification, review, traceability), each gated with mandatory human approval. The Claude Ship article ("The work after you open a PR") demonstrates patterns that make agent automation safe and calibratable: observe-before-enforce, bounded retries with escalation, finding triage, persisted rules, and explicit trust boundaries. This specification turns those patterns into ai-workflow capabilities covering all six approved scope candidates.

## Requirements

### REQ-001: Gate observe mode

- **Description:** Provide a dry-run mode for stage quality gates that evaluates the gate and logs the decision it *would* make (pass/fail with reasons) without blocking stage progression.
- **Acceptance criteria:**
  - Given an active workflow with a pending stage
  - When the user runs the gate command with an observe flag (e.g., `aiw gate <stage> --observe`)
  - Then the gate evaluates the stage artifact, records the would-be decision and findings to the workflow checkpoint/evidence, and the stage state is unchanged (still awaiting human approval)
  - And running the normal gate command afterwards behaves identically to today

### REQ-002: Bounded retry with escalation on gate rejections

- **Description:** After N consecutive rejections of the same stage (default 3, configurable), the workflow stops auto-revision loops and escalates to the human with a summary of attempts and reasons.
- **Acceptance criteria:**
  - Given a stage has been rejected N-1 consecutive times
  - When the Nth rejection is recorded
  - Then the CLI/status reports an escalation notice listing each rejection reason and the revisions attempted
  - And the workflow does not silently allow further agent revision cycles for that stage without an explicit human action (e.g., an explicit continue/approve-new-attempt command)

### REQ-003: Rejection-reason persistence loop

- **Description:** Recurring rejection reasons are captured from checkpoint/approval records and surfaced as candidate rules or skill updates for human review.
- **Acceptance criteria:**
  - Given recorded rejections exist for completed or active workflows
  - When the user runs a dedicated command (e.g., `aiw recommend` or a new `aiw rules-candidates`)
  - Then recurring reasons are clustered and presented as draft rule/skill candidates with evidence links
  - And nothing becomes an active rule or skill without an explicit human accept action

### REQ-004: Finding triage classification

- **Description:** Review and verification skills classify findings as `auto-fixable` or `judgment-required`, and agents only act automatically on auto-fixable ones.
- **Acceptance criteria:**
  - Given a code-review or verification report produced under this workflow
  - When findings are recorded
  - Then each finding carries a triage class (`auto-fixable` | `judgment-required`)
  - And judgment-required findings (redesign, security, scope) are always surfaced to the human, never auto-addressed

### REQ-005: Trust-boundary documentation

- **Description:** Publish explicit trust-boundary guidance for ai-workflow: which text is untrusted (artifact/chat content), under whose credentials checks run, and that the caller of the agent is responsible for agent-produced changes.
- **Acceptance criteria:**
  - Given the ai-workflow documentation set
  - When a user reads the workflow/skill guidance
  - Then trust boundaries per stage are stated: untrusted inputs are never executed or trusted as commands; gate checks run under the invoking user's credentials; every approval is attributable to a named human
  - And agent guidance never instructs committing rule/secret-like files automatically

### REQ-006: Policy conflict semantics

- **Description:** When multiple rules or policies match, the strictest one wins, and rules marked as always-require-human cannot be overridden by any classifier or automation.
- **Acceptance criteria:**
  - Given two or more matching rules with different strictness
  - When a decision is evaluated
  - Then the strictest rule's decision applies deterministically
  - And a rule flagged `always-require-human` (or equivalent) is never overridden by automated decisions, with the behavior covered by tests

## Non-functional Requirements

- **NFR-001 Portability:** All changes remain target-neutral (no codex/claude/cursor-specific behavior in core CLI).
- **NFR-002 Backwards compatibility:** Existing workflows, artifact layouts (legacy fallback), and gate/approve commands keep working unchanged.
- **NFR-003 Observability:** Observe-mode and escalation events are recorded in checkpoints/telemetry like other workflow events.

## Constraints

- Human approval remains mandatory for stage progression in all cases.
- Default retry budget is 3 (matching the article); configurable but not removable below 1.
- Rule/skill candidates are never activated without human review.

## Open Questions

- Exact CLI surface for observe mode (`--observe` vs. `aiw gate-observe <stage>`) — decide in technical design.
- Storage format for rejection-reason clusters (checkpoint extension vs. new file) — decide in technical design.
- Whether REQ-004 lives in skill templates only or also in report schema validation — decide in technical design.
