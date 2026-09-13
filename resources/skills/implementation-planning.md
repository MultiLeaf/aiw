---
name: implementation-planning
description: Break an approved design into independently verifiable implementation tasks.
---

# Implementation Planning

Create small ordered tasks. Each task must reference requirements, affected modules, tests, commands, dependencies, and completion evidence.

Write `.aiw/generated/plans/implementation-plan.md` with ordered tasks, requirement links, affected modules, tests, validation, dependencies, risks, and completion evidence. After `aiw gate plan` passes, present the exact plan to the human and ask for explicit approval. Stop and wait; a gate pass is not approval. Do not edit implementation files until approval arrives and `aiw approve plan` succeeds. If changes are requested, first record `aiw reject plan --reason=<feedback>`, then revise the plan, rerun its gate, and ask again. After approval, implement in task order. Use `tdd-development` when installed and the project has a test workflow; otherwise use existing validation. When implementation is complete, write `.aiw/generated/reports/implementation-report.md` with changed files, tests, validation results, and deviations; run `aiw gate implementation`, present the diff and evidence to the human, stop, and wait for explicit approval. Record approval with `aiw approve implementation` before verification. Invoke CLI commands through `npx --yes --package=@multileaf/ai-workflow -- aiw <command>` when no global binary exists.
