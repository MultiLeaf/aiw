---
name: tdd-development
description: Implement repository changes through test-first development.
---

# TDD Development

For implementation approval or rejection, use the host's native blocking question widget, not a prose-only prompt when the widget is available. Leave choices unselected and offer “Approve and continue”, “Request changes”, and “Reject/stop”. Wait for an actual submission before running `aiw approve` or `aiw reject` or starting verification. Collect requested changes in a follow-up free-text widget. If the host has no blocking widget, use a numbered chat prompt and end the turn until an explicit reply arrives. The CLI records the decision but cannot verify that a widget was used.

Follow Red, Green, Refactor, Verify. Write a failing behavioral test first, implement the smallest change, refactor for clarity and design quality, then run the relevant quality gate. Never weaken a test to make an implementation pass.

After implementation tasks are green and refactored, write `.aiw/generated/reports/implementation-report.md` with changed files, tests, validation results, and deviations. Run `aiw gate implementation`, present the diff, changed requirements, test commands, and exact evidence to the human. Ask for explicit approval to proceed to verification, end the turn, and wait. Do not invoke verification until the human approves and `aiw approve implementation` succeeds. If changes are requested, first record `aiw reject implementation --reason=<feedback>`, remain in implementation, repeat relevant tests, update the report, rerun its gate, and ask again. Invoke CLI commands through `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global binary exists.
