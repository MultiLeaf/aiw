---
name: tdd-development
description: Implement repository changes through test-first development.
---

# TDD Development

Follow Red, Green, Refactor, Verify. Write a failing behavioral test first, implement the smallest change, refactor for clarity and design quality, then run the relevant quality gate. Never weaken a test to make an implementation pass.

After implementation tasks are green and refactored, write `.aiw/generated/reports/implementation-report.md` with changed files, tests, validation results, and deviations. Run `aiw gate implementation`, present the diff, changed requirements, test commands, and exact evidence to the human. Ask for explicit approval to proceed to verification, end the turn, and wait. Do not invoke verification until the human approves and `aiw approve implementation` succeeds. If changes are requested, first record `aiw reject implementation --reason=<feedback>`, remain in implementation, repeat relevant tests, update the report, rerun its gate, and ask again. Invoke CLI commands through `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global binary exists.
