# OPP-017: Orchestration depth — integration tooling, leak reporting, per-harness guidance

- Status: Proposed
- Priority: P2
- Added: 2026-11-01
- Decision: extends [ADR-001](../../.context/adrs/ADR-001-odd-rdd-proportionality-scope.md) Decision A
- Source signal: external qualitative assessment scored "Multi-agent orchestration 3/5 — scheduler and isolation; runtime delegated to host". Agreed: the delegation is by design, but three concrete pieces of depth on aiw's side of the contract are missing.

## Problem

After OPP-010, isolated execution exists: branch-per-task worktrees, evidence-bound checkpoints, cleanup. What remains missing keeps orchestration at 3/5:

1. **No integration tooling**: after a plan passes, the task branches (`aiw/<plan>/<task>`) sit without guidance — the human must remember merge order (waves) and discover conflicts by trial.
2. **No leak reporting**: `orchestrate --cleanup` removes managed worktrees, but `aiw doctor` does not report them — leaked worktrees from crashed runs are invisible in diagnostics.
3. **No per-harness guidance**: whether a given harness integration honors `OrchestrationTask.worktree` is undocumented — teams cannot know before running.

## Proposal

1. **`aiw orchestrate integrate --plan=<id>`** (read-only): prints the merge order derived from the execution waves, and for each task branch runs `git merge-tree` (dry-run) against the target branch, reporting conflicts per task before anything is merged. Merges stay human-executed (delivery boundary unchanged); the command is a conflict _forecast_, not an executor.
2. **Doctor leak reporting**: doctor gains a managed-worktree check (reuse `listManagedWorktrees`) — leaked worktrees are reported with plan/task attribution and the cleanup continuation (`orchestrate --cleanup --execute`), per the OPP-004 typed-continuation contract.
3. **Diff-stat evidence**: the checkpoint gains per-task changed-file stats (`git -C <worktree> diff --stat <base>..<final>`), so integration review starts from real scope numbers.
4. **Per-harness honor guidance**: a documented matrix in `docs/orchestration.md` — for each documented harness integration, whether (and how) it consumes `task.worktree`, plus the minimal adapter contract statement ("run the task with the worktree as cwd, or fail with a typed error").
5. **Parallel evidence**: when a plan executes with `--max-parallel > 1`, the checkpoint records wall-clock duration and per-task overlap so parallel execution is evidenced, not assumed.

## Affected areas

- `src/orchestration.ts` (integrate preview: wave-ordered merge plan + merge-tree dry run; diff-stat collection)
- `src/workflow.ts` (orchestrate subcommand wiring; doctor leak check)
- `docs/orchestration.md` (honor matrix + adapter contract statement)
- `docs/backlog.md` (this file)

## Acceptance criteria

- Given a passed isolated plan, when `orchestrate integrate --plan=<id>` runs, then it prints merge order respecting waves and flags conflicting task branches via merge-tree without merging anything.
- Given leaked managed worktrees, when `aiw doctor` runs, then they are reported with plan/task attribution and the cleanup continuation command (typed reason, OPP-004 contract).
- Given a task branch in conflict with the target, when the integrate forecast runs, then the conflict is reported before any merge is attempted.
- Given an isolated execution with `--max-parallel=2`, when the checkpoint is written, then per-task wall-clock and overlap evidence are present.
- Given no isolation, when orchestrate/integrate/doctor run, then behavior is unchanged.

## Non-goals

- No automatic merge, push, or orphan-branch deletion (human-owned integration).
- No remote/cloud orchestration; no cross-repository worktrees.
- No behavioral parity claims for harnesses that do not declare worktree support.

## Open questions

- Integrate target: main directly, or stacked branches per wave (easier review, harder bookkeeping)?
- Should integrate also propose squash strategy per task from the checkpoint's commit evidence?
- Doctor leak threshold: report all, or only worktrees older than N hours?
