# OPP-010: Worktree isolation for orchestrated execution

- Status: Implemented (2026-11-01): orchestrate --isolate with branch-per-task worktrees, evidence-bound checkpoints, kept-on-failure worktrees, and --cleanup
- Priority: P2
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Trend signal: Spec Kitty sells isolated worktrees as its core ("implementation can happen in parallel without branch chaos"); Conductor (3.7K★) and Grasp are built entirely around parallel agent worktrees; AI Workflow's own `docs/quality.md` already mandates isolated-worktree validation runs — currently performed manually.

## Problem

`aiw orchestrate` schedules a validated task graph and delegates each task to an adapter, but every task runs against the **same working tree**. Consequences:

- parallel tasks conflict on shared files (the reason `--max-parallel` exists but parallelism stays risky);
- the quality.md requirement — "externally visible tasks also require an isolated integration run by an AI subagent in a separate worktree" — is satisfied by hand, with no evidence that the worktree was actually isolated;
- a failed task leaves the main tree dirty, mixing orchestration debris with human work.

## Proposal

1. **`aiw orchestrate --isolate`**: before executing a task (or an independent wave), create a git worktree from the current HEAD under `.aiw/worktrees/<plan-id>/<task-id>/`; pass that path as the task's working directory; remove the worktree on success (after evidence capture) and keep it on failure for diagnosis.
2. **Adapter contract extension** (backward compatible): `OrchestrationTask` gains an optional `worktree?: string`; the adapter contract keeps "the adapter owns process isolation" — aiw owns **git** isolation and hands the path over. Adapters that cannot use a worktree reject `--isolate` with a typed error naming the capability (consistent with the adapter capability matrix).
3. **Evidence binding**: the per-task checkpoint (already `orchestration-<plan-id>.yml`) records the worktree path, base commit, and final commit/diff stat, so the "isolated run happened" requirement becomes verifiable evidence instead of prose.
4. **Merge strategy**: on success, a fast-forward/merge step records which task branches are ready to integrate; merge remains a human-approved action (delivery is never automatic — consistent with the approval contract).
5. **Cleanup guard**: `aiw orchestrate --cleanup` lists and removes stale worktrees for completed/failed plans; doctor reports leaked worktrees (a worktree whose plan checkpoint shows completion but still exists on disk).

## Affected areas

- `src/orchestration.ts` (worktree lifecycle, evidence fields, cleanup)
- `src/adapter-contract.ts` (optional `worktree` task field, capability declaration)
- Adapters (`src/claude-adapter.ts`, codex, gemini, copilot, universal) — pass-through or capability-declared refusal
- `src/doctor`/`src/workflow.ts` diagnostics (leaked worktree check)
- `docs/orchestration.md`, `docs/quality.md` (manual requirement → tooling requirement)

## Acceptance criteria

- Given `--isolate` with two independent tasks, when the plan executes with `--max-parallel=2`, then each task runs in its own worktree from the same base commit and their file writes never touch the main tree.
- Given a task failure under isolation, when the plan finishes, then the failed task's worktree is preserved on disk and the checkpoint names its path and base commit.
- Given a successful task under isolation, when evidence is recorded, then the checkpoint contains base commit, final commit, and diff stat for that task.
- Given an adapter that does not declare worktree support, when `--isolate` is used, then the plan fails before any task runs with a typed error naming the adapter and capability.
- Given no `--isolate` flag, when a plan executes, then behavior is byte-identical to today.
- Given leaked worktrees, when `aiw doctor` runs, then they are reported with plan/task attribution; `--cleanup` removes them after explicit confirmation.

## Non-goals

- No automatic merge/push of task results — integration stays human-approved.
- No cross-repository worktrees; isolation is within the current repository.
- No rebase/-conflict resolution automation: conflicting task branches surface for human merge.

## Open questions

- Branch-per-task inside the worktree (easier merge later) vs detached HEAD with recorded commit (simpler)? Recommendation: branch-per-task named `aiw/<plan>/<task>`.
- Should isolated runs reuse OPP-002's tier to decide whether a task needs isolation at all (advisory)?
- Windows path-length handling for deep worktree paths (`.aiw/worktrees/...`) on long repo paths.
