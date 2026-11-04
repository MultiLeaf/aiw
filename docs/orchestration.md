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

## Isolation and integration (OPP-010/OPP-017)

`aiw orchestrate --plan=plan.yml --execute --isolate` creates one branch-per-task git worktree (`aiw/<plan>/<task>` from the plan HEAD) and hands the path to the adapter through the optional `worktree` field on the orchestration task. Passed-task worktrees are removed after evidence capture; failed-task worktrees are kept for diagnosis. Checkpoints record per-task worktree path, base commit, final commit, diff stat, and duration, plus the plan's wall-clock time.

`aiw orchestrate integrate --plan=plan.yml` prints the wave-ordered integration forecast for the task branches: a deterministic `git merge-tree` dry run against the current branch, reporting conflicts per task before any human merge. Conflicts make the command exit nonzero; nothing is ever merged by the tool. `aiw orchestrate --cleanup --execute` removes managed worktrees left by crashed runs, and `aiw doctor` reports leaks with the cleanup continuation.

### Worktree honor matrix

The adapter contract owns process execution; aiw owns git isolation. What each documented integration does with `task.worktree`:

| Integration                                                  | Honor                                                                                                   | Notes                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Host-integrated adapters (in-process)                        | Receives the path; runs the task with the worktree as its working directory or fails with a typed error | The minimal adapter contract: never run against the main tree when a worktree is provided    |
| Claude Code / Codex / Gemini CLIs launched by a host adapter | Honored by passing the worktree as the session working directory                                        | Harness-native worktree features may substitute; the checkpoint evidence stays authoritative |
| Adapters without worktree support                            | Must reject `--isolate` before any task runs                                                            | The plan fails before execution rather than silently running in the main tree                |

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
