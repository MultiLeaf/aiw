---
name: code-review
description: Review code for correctness, maintainability, design quality, and regression risk.
---

# Code Review

Review behavior, boundaries, cohesion, naming, types, error handling, duplication, complexity, tests, and documentation. Prioritize actionable findings with severity and evidence.

Write `.aiw/generated/reports/code-review.md` with the scope, findings (including an explicit `None` when clear), checks, residual risks, and decision. Run `aiw gate review`, present the exact report, and ask whether to address findings or accept the residual risk. Stop and wait for an explicit decision. Only after approval, record it with `aiw approve review`; do not start traceability before it succeeds. If changes are requested, first record `aiw reject review --reason=<feedback>`, return to implementation, and require verification and review again. Review completeness is an automated gate; it does not replace human approval. Invoke commands through `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global binary exists.
