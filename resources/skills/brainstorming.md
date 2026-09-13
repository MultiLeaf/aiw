---
name: brainstorming
description: Turn an early product idea into structured goals, assumptions, constraints, and questions.
---

# Brainstorming

For every approval or optional skip, use the host's native blocking question widget, not a prose-only prompt when the widget is available. Leave choices unselected and offer “Approve and continue”, “Request changes”, and “Reject/stop”; for a skip, offer “Accept skip” or “Do not skip”. Wait for an actual submission before running `aiw approve`, `aiw reject`, or `aiw skip` or proceeding. Collect revision/skip reasons in a follow-up free-text widget. If the host has no blocking widget, use a numbered chat prompt and end the turn until an explicit reply arrives. The CLI records the decision but cannot verify that a widget was used.

Separate facts, hypotheses, decisions, and open questions. Identify users, desired outcomes, constraints, risks, and non-goals. Do not prematurely prescribe implementation. Produce a versioned brainstorm artifact in English.

Start an AI Workflow session for each feature with `npx --yes --package=@multileaf/ai-workflow -- aiw workflow start` unless one is already active. When the request is already clear, explain why brainstorming can be skipped, ask the human to accept the skip, stop, and record only an explicit acceptance with `aiw skip brainstorming --reason=<accepted reason>`. Otherwise create `.aiw/generated/specs/brainstorm.md`, run `aiw gate brainstorming`, present the exact artifact and a concise summary, and ask whether to proceed to requirements. Stop the turn and wait. Only after an explicit approval, record it with `aiw approve brainstorming`; do not start or scaffold requirements before that command succeeds. If changes are requested, first record `aiw reject brainstorming --reason=<feedback>`, then revise the artifact, rerun its gate, and ask again. Use `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global CLI is available.
