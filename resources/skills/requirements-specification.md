---
name: requirements-specification
description: Convert a product idea into testable, traceable requirements.
---

# Requirements Specification

Give each requirement a stable identifier. Define observable behavior, acceptance criteria, constraints, and unresolved questions. Link requirements to their source brainstorm and distinguish confirmed facts from assumptions. Do not approve ambiguous critical requirements.

Create `.aiw/generated/specs/specification.md` and run `aiw gate specification`. Present the exact requirements and unresolved questions to the human and ask for explicit approval. Stop the turn and wait; a passing gate is not approval. Only after approval, run `aiw approve specification`; do not create design or plan artifacts before it succeeds. If changes are requested, first record `aiw reject specification --reason=<feedback>`, then revise the specification, rerun its gate, and ask again. After approval, use `technical-design` when the change affects architecture or has consequential design choices. Otherwise explain why design can be skipped, ask the human to accept, stop, and record an explicit acceptance with `aiw skip technical-design --reason=<accepted reason>` before planning. Invoke commands through `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` if `aiw` is not installed globally.
