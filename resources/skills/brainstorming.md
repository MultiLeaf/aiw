---
name: brainstorming
description: Turn an early product idea into structured goals, assumptions, constraints, and questions.
---

# Brainstorming

Separate facts, hypotheses, decisions, and open questions. Identify users, desired outcomes, constraints, risks, and non-goals. Do not prematurely prescribe implementation. Produce a versioned brainstorm artifact in English.

Start an AI Workflow session for each feature with `npx --yes --package=@multileaf/ai-workflow -- aiw workflow start` unless one is already active. When the request is already clear, explain why brainstorming can be skipped, ask the human to accept the skip, stop, and record only an explicit acceptance with `aiw skip brainstorming --reason=<accepted reason>`. Otherwise create `.aiw/generated/specs/brainstorm.md`, run `aiw gate brainstorming`, present the exact artifact and a concise summary, and ask whether to proceed to requirements. Stop the turn and wait. Only after an explicit approval, record it with `aiw approve brainstorming`; do not start or scaffold requirements before that command succeeds. If changes are requested, first record `aiw reject brainstorming --reason=<feedback>`, then revise the artifact, rerun its gate, and ask again. Use `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global CLI is available.
