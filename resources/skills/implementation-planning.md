---
name: implementation-planning
description: Break an approved design into independently verifiable implementation tasks.
---

# Implementation Planning

Create small ordered tasks. Each task must reference requirements, affected modules, tests, commands, dependencies, and completion evidence.

After the plan passes its gate, implement in task order. Use `tdd-development` when it is installed and the project has a test workflow; otherwise use the repository's existing validation methods. Hand completed work to `verification`.
