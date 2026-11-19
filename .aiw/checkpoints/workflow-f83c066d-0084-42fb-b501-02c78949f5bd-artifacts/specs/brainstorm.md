# Bounded Research Skill

## Goal

Give host agents a structured, bounded research lane: starting from a concrete question (an error, a log signature, a migration implication, an external library question), collect and sharpen context with cited evidence, and produce a durable research artifact that downstream stages (brainstorm, specification, diagnosis) can consume — instead of losing the investigation in chat history.

## Users

- Developers facing an unexplained failure ("why does this 401 only in staging?") before any fix is scoped.
- Agents preparing a change that needs facts gathered first (version constraints, API behavior, log evidence).
- Anyone onboarding into an incident or unfamiliar subsystem who needs an evidence-backed picture fast.

## Facts

- AI Workflow already packages skills as resources (`resources/skills/*.md`) recommended by the engine and rendered per target.
- Existing adjacent lanes: brainstorming (product ideas), diagnosis (root cause inside the bugfix process), idea-assessment (go/clarify/stop).
- The repo has semantic retrieval (`aiw semantic query`, judge-context), scoped artifacts per workflow (FRIC-005), light lane with evidence recording, and eval contracts for generated skills (OPP-011).
- AIW core is deterministic and offline; external search is a host-agent capability, not an AIW network call.

## Assumptions

- Host agents (Claude, Codex, etc.) can read logs/files and perform web searches themselves; the skill's job is contract and structure, not transport.
- Most research tasks are small enough for the light lane (resume test), with escalation when scope grows.

## Hypotheses

- Evidence-first structure (every finding cites file:line / log line / URL+date) measurably reduces hallucinated findings later in review and verification.
- A turn/step budget with explicit stop conditions keeps research proportional (ODD/RDD token economics) without blocking useful depth.
- A durable, workflow-scoped research artifact gets reused by later stages (digestible via the existing digest layer), cutting re-reading.

## Constraints

- AIW stays deterministic and offline by default; no new network transport, no new settings sections beyond existing gates.
- Privacy: secrets and credentials must be redacted before any external query or before persisting excerpts; same guardrail posture as the interpreter.
- Advisory-only structure: the skill never gates, decides, or replaces human judgment; it feeds later stages.

## Risks

- Overlap with diagnosis/brainstorm blurring lanes — mitigated by a strict "collect and sharpen context, never decide or design" boundary.
- Unbounded research becoming a token sink — mitigated by scope gate + budget + stop conditions in the skill contract.
- Fabricated provenance — mitigated by the refuter-grade citation standard (verifiable file:line, log line, or URL).

## Non-goals

- AIW performing web searches or network requests itself.
- Replacing diagnosis (root-cause workflows) or brainstorming (product ideation).
- A new SDD process entry point or new quality gate in this iteration.

## Open Questions

1. Should the research artifact be a formal SDD stage with a gate, or an advisory artifact recorded in the light-lane evidence (no gate)?
2. How should the recommendation engine decide when to suggest the research skill (error/log signals? question-shaped tickets? manual only)?
3. Should the artifact template include a fixed confidence scale, or reuse the existing evidence/confidence model from scan facts?
4. Does the skill need CLI support (e.g., `aiw research` scaffold command) or is a pure skill document enough?
