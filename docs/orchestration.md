# Multi-agent Orchestration

AI Workflow represents coordinated work as a strict, versioned task graph. The core scheduler is provider-neutral: a host integrates Codex, Claude, Gemini, Orca, or another runtime through the exported `AgentOrchestrator` interface.

## Plan format

```yaml
schema: 1
id: release-readiness
tasks:
  - id: TASK-001
    agent: codex
    prompt: "Implement the approved specification."
    depends_on: []
  - id: TASK-002
    agent: claude
    prompt: "Review the implementation and tests."
    depends_on: [TASK-001]
  - id: TASK-003
    agent: gemini
    prompt: "Validate documentation and traceability."
    depends_on: [TASK-001]
```

Plan identifiers use lowercase letters, numbers, and hyphens. Task identifiers use `TASK-###`. Prompts are JSON-quoted strings, dependencies must reference tasks in the same plan, and cycles are rejected before execution.

## Commands

```bash
aiw orchestrate --plan=orchestration.yml
aiw orchestrate --plan=orchestration.yml --execute --max-parallel=2
```

The first command prints deterministic execution waves and does not invoke an agent or mutate project state. `--execute` requires a host-provided adapter. Parallelism must be an integer from 1 through 16. A failed or unavailable agent marks its task as failed; dependent tasks are blocked, while unrelated tasks continue.

Each executed plan writes one `.aiw/checkpoints/orchestration-<plan-id>.yml` result. Existing checkpoints are never overwritten: use a new plan identifier for a new run. Agent result details are bounded and serialized safely.

## Adapter contract

```ts
import type { AgentOrchestrator, OrchestrationTask } from "@multileaf/ai-workflow/orchestration";

const orchestrator: AgentOrchestrator = {
  async run(task: OrchestrationTask) {
    return { success: true, detail: `${task.id} completed by ${task.agent}` };
  },
};
```

The adapter owns runtime authentication, process isolation, completion detection, and permission enforcement. It must resolve only after the delegated agent has finished. AI Workflow owns graph validation, scheduling, failure propagation, result ordering, and checkpoint persistence.
