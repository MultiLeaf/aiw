# Brainstorm: End-to-end flow — from idea to a merge-ready PR

- Workflow ID: 72b951e7-a75e-4eab-8edc-0859418470a9
- Version: 1 (draft)
- Date: 2026-11-27
- Input: Research artifact `.aiw/generated/checkpoints/workflow-7a2fb5f9-fb68-4d86-9180-0c930cabebb7-artifacts/research.md` (9 findings, 4 open questions)

## Goal

Extend ai-workflow so a feature travels the full distance: from conception (brainstorm or research) through specification, design, plan, implementation, verification, review, and traceability — ending in a pull request that is merge-ready: CI checks passed, reviewer comments resolved, no merge conflicts, all validated.

## Facts (from the research artifact)

- `aiw adr` exists with template and adapter guidance, but no gate requires or verifies ADRs (research F-3).
- `resources/templates/test-plan.md` exists (Behavioral/Integration/Failure Cases) but is wired to no stage, gate, or skill (F-5).
- No PRD artifact exists; `specification` covers requirements (F-4).
- No PR-creation command exists anywhere in src/ or resources/ (F-6).
- No CI-status integration exists; only the repo's own CI (F-8).
- `aiw orchestrate integrate` already produces a per-branch merge-conflict forecast (F-7).
- The workflow currently terminates at `traceability` + `workflow complete` with a usage/cost report, not a PR-readiness report (F-6).
- Claude Ship (external reference) demonstrates the target loop: PR opened, agent watches CI checks, resolves conflicts, addresses review comments, small fixes automated, big issues escalated, merge decision stays human.

## Hypotheses

- A `pr` stage after `traceability` can close the flow: create the branch/PR, verify CI, resolve comments/conflicts, and gate on "merge-ready" criteria.
- The host (agent adapter) should execute `gh`/git commands, while aiw provides the stage, gates, templates, and evidence recording — keeping the CLI free of network/credential trust (consistent with docs/trust-boundaries.md).
- A PRD fits as an optional stage (or template + gate) between brainstorming and specification; a QA test matrix fits by wiring test-plan.md into the plan/verification gates.
- ADRs become enforceable by extending the technical-design gate to require linked ADRs when the design declares consequential decisions.
- CI status can be captured as recorded evidence (`aiw pr evidence`-style) rather than polled by the CLI, matching the evidence-first model.

## Decisions

- None yet; awaiting human direction on the open questions.

## Open Questions

- **PR execution boundary:** should aiw ship a `pr` command that shells out to `gh`/git, or only provide stage/gate/templates while the host agent runs the commands? (Trust boundaries favor the latter.)
- **CI observation:** record CI results as human/agent-supplied evidence vs. an actual `gh run watch`-style observer?
- **PRD placement:** new optional stage `product-requirements` before specification, or a PRD template folded into specification/brainstorm?
- **QA matrix:** require test-plan.md at plan time (gate: plan links test cases to tasks), at verification time, or both?
- **Merge-ready gate criteria:** what exactly must be true to pass the final gate — CI green, unresolved-comments = 0, mergeable = true, branch protection satisfied? Which of these are checkable locally vs. only in the forge?
- **Scope of v1:** all of PRD + ADR gate + QA matrix + PR stage in one workflow, or staged delivery (PR stage first)?

## Users

- Developers and tech leads using ai-workflow who want one continuous, gated flow from idea to merge instead of a hand-off at "workflow complete".
- QA engineers who need a visible test matrix traceable to requirements and tasks.

## Desired Outcomes

- A feature request entered as brainstorm/research exits as a PR that is CI-green, comment-free, conflict-free, and mergeable.
- ADRs, PRD, and QA test matrix exist as first-class gated artifacts, not optional side documents.
- The human remains the merge decision-maker; the workflow proves readiness with recorded evidence.

## Constraints

- Target-neutral core (no codex/claude/cursor-specific logic); adapters do execution.
- Trust boundaries (docs/trust-boundaries.md): untrusted text never becomes instructions; the CLI adds no hidden network/credential surface without explicit design.
- Backwards compatible: existing stage flow and artifacts keep working; new stages are additive (optional where possible).
- Human approval stays mandatory at every new gate.

## Risks

- Forge coupling (GitHub-specific `gh`) could break portability — mitigate with a forge-adapter boundary (CLI records evidence; host executes forge commands).
- CI/comment polling can burn tokens and time — mitigate with evidence-based recording and bounded observation (mirrors the 3-push escalation cap already built).
- Scope explosion: end-to-end PR flow + 3 new artifact types is large — mitigate by sequencing (PR stage first, then artifacts).
- "Merge-ready" checks that only the forge can answer risk false confidence — mitigate by gating on locally verifiable evidence and surfacing the rest as explicit human checklist.

## Non-Goals

- Merging PRs automatically — merge stays a human/branch-protection decision.
- Hosting a PR-watching daemon (like Claude Ship's cloud agents) — aiw remains repo-local.
- Replacing the forge's own review/CI UI; aiw complements it with gated evidence.

## Scope Candidates (for specification, if approved)

1. New `pr` stage (post-traceability): PR creation guidance, CI evidence, comment-resolution loop, conflict re-check, merge-ready gate.
2. PRD as optional stage/template between brainstorming and specification.
3. QA test matrix: wire test-plan.md into plan and/or verification gates with REQ↔test-case traceability.
4. ADR enforcement: technical-design gate requires linked ADRs for consequential decisions.
5. PR-readiness report at `workflow complete` (extends the completion report).
