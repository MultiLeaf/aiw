---
name: code-review
description: Review code for correctness, maintainability, design quality, and regression risk.
---

# Code Review

For every approval, rejection, or optional skip, use the host's native blocking question widget, not a prose-only prompt when the widget is available. Leave choices unselected and offer “Approve and continue”, “Request changes”, and “Reject/stop”; for a skip, offer “Accept skip” or “Do not skip”. Wait for an actual submission before running `aiw approve`, `aiw reject`, or `aiw skip` or proceeding. Collect revision/skip reasons in a follow-up free-text widget. If the host has no blocking widget, use a numbered chat prompt and end the turn until an explicit reply arrives. The CLI records the decision but cannot verify that a widget was used.

Review behavior, boundaries, cohesion, naming, types, error handling, duplication, complexity, tests, and documentation. Prioritize actionable findings with severity and evidence.

Write `.aiw/generated/reports/code-review.md` with the scope, findings (including an explicit `None` when clear), checks, residual risks, and decision. Run `aiw gate review`, present the exact report, and ask whether to address findings or accept the residual risk. Stop and wait for an explicit decision. Only after approval, record it with `aiw approve review`; do not start traceability before it succeeds. If changes are requested, first record `aiw reject review --reason=<feedback>`, return to implementation, and require verification and review again. Review completeness is an automated gate; it does not replace human approval. Invoke commands through `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global binary exists.
