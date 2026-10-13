---
name: ticket
description: Start a feature directly from a ticket or specific requirement without a brainstorming phase.
---

# Ticket-Driven Task

For every approval or optional skip, use the host's native blocking question widget, not a prose-only prompt when the widget is available. Leave choices unselected and offer "Accept skip" / "Do not skip" (or "Approve and continue" / "Request changes" / "Reject/stop" at gates). Wait for an actual submission before running any `aiw` approval or skip command. The CLI records the decision but cannot verify that a widget was used.

Use this skill when the user provides a ticket ID (for example `PROJ-142`) or an already-clear requirement and wants to start work immediately.

1. Extract the ticket ID and a short title from the user's request. Start the task with `npx --yes --package=@multileaf/ai-workflow -- aiw task start --ticket=<TICKET> --title="<short title>"` (add `--id=<uuid>` only if the user provides one). If a session is already active, report it with `aiw task status` and stop.
2. Brainstorming decision: the ticket already provides the requirement, but skipping is still a human decision. Ask with the blocking widget whether to skip brainstorming ("Accept skip" / "Do not skip"). Only after an explicit acceptance, record it with `npx --yes --package=@multileaf/ai-workflow -- aiw skip brainstorming --reason="Requirement provided by ticket <TICKET>"`. If the user prefers to brainstorm after all, run the brainstorming skill instead.
3. Create the specification linked to the ticket with `npx --yes --package=@multileaf/ai-workflow -- aiw spec --ticket=<TICKET> --title="<title>"`, fill in requirements with stable IDs and Given/When/Then acceptance criteria derived from the ticket, then pass `aiw gate specification`, present the artifact, wait, and record the human reply with `aiw approve specification` (or `aiw reject specification --reason=<feedback>` and revise).
4. Continue the standard SDD sequence: technical design when the change has architecture impact (`aiw adr`, gate, approval), implementation plan (`aiw plan`, gate, approval), TDD implementation, verification (`aiw verify`, gate, approval), code review, and traceability (`aiw trace`, gate, approval). Check progress at any point with `npx --yes --package=@multileaf/ai-workflow -- aiw task status`, which reports the ticket and the next pending stage.
5. Complete with `npx --yes --package=@multileaf/ai-workflow -- aiw workflow complete` only after all stages resolve; the ticket reference stays in the archived session and the specification.

Never invent a ticket ID: if the user did not provide one, ask for it (or offer the plain `aiw workflow start` flow). Never skip brainstorming without an explicit human acceptance recorded through `aiw skip brainstorming`. Use `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global CLI is available.
