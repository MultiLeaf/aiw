import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { realpathSync } from "node:fs";

export const ORCHESTRATION_AGENTS = ["codex", "claude", "gemini"] as const;
export type OrchestrationAgent = (typeof ORCHESTRATION_AGENTS)[number];
export type OrchestrationTask = {
  id: string;
  agent: OrchestrationAgent;
  prompt: string;
  dependsOn: string[];
  /** Set by `orchestrate --isolate`: the per-task git worktree the adapter must run in (OPP-010). */
  worktree?: string;
};
export type OrchestrationPlan = { schema: 1; id: string; tasks: OrchestrationTask[] };
export type OrchestrationTaskResult = {
  id: string;
  status: "passed" | "failed" | "blocked";
  detail: string;
  /** OPP-010 isolation evidence, present when the plan ran with --isolate. */
  worktree?: string;
  baseCommit?: string;
  finalCommit?: string;
  /** OPP-017 execution evidence. */
  durationMs?: number;
  diffStat?: string;
};

export type IsolationOptions = {
  /** Repository root the plan runs in. */
  root: string;
  /** AI Workflow state directory (usually `.aiw`). */
  aiw: string;
  planId: string;
};

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function worktreeDirectory(aiw: string, planId: string, taskId: string): string {
  return join(aiw, "worktrees", planId, taskId);
}

/**
 * OPP-010: create one branch-per-task worktree from the current HEAD so
 * parallel tasks never share a working tree. Branches are named
 * `aiw/<plan>/<task>` so later human merge is explicit.
 */
export function createTaskWorktrees(
  root: string,
  aiw: string,
  plan: OrchestrationPlan,
): Map<string, { worktree: string; baseCommit: string }> {
  const created = new Map<string, { worktree: string; baseCommit: string }>();
  const head = git(root, ["rev-parse", "HEAD"]);
  for (const task of plan.tasks) {
    const worktree = worktreeDirectory(aiw, plan.id, task.id);
    const branch = `aiw/${plan.id}/${task.id}`;
    git(root, ["worktree", "add", "-b", branch, worktree, head]);
    created.set(task.id, { worktree, baseCommit: head });
  }
  return created;
}

/** Final commit recorded from an isolated worktree (evidence for the checkpoint). */
export function worktreeFinalCommit(worktree: string): string | undefined {
  try {
    return execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function gitDiffStat(root: string, worktree: string, base: string, final: string): string {
  try {
    return execFileSync("git", ["-C", worktree, "diff", "--stat", `${base}..${final}`], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function boundedDiffStat(stat: string): string | undefined {
  if (!stat) return undefined;
  const lines = stat.split("\n");
  const bounded = lines.slice(0, 20).join("\n");
  return lines.length > 20 ? `${bounded}\n(truncated)` : bounded;
}

/**
 * OPP-017 integration forecast: wave-ordered merge preview for the isolated
 * task branches against the current branch. Deterministic `git merge-tree`
 * dry runs — nothing is merged. Conflicts surface per task before any human
 * merge is attempted.
 */
export type IntegrationForecastLine = {
  wave: number;
  taskId: string;
  branch: string;
  state: "clean" | "conflict" | "missing" | "identical";
  conflicts?: string[];
};

export function currentBranch(root: string): string {
  return git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function forecastIntegration(
  root: string,
  plan: OrchestrationPlan,
  results: OrchestrationTaskResult[],
): IntegrationForecastLine[] {
  const waves = orchestrationWaves(plan);
  const byId = new Map(results.map((result) => [result.id, result]));
  const target = currentBranch(root);
  const lines: IntegrationForecastLine[] = [];
  waves.forEach((wave, index) => {
    for (const taskId of wave) {
      const branch = `aiw/${plan.id}/${taskId}`;
      let branchTip: string;
      try {
        branchTip = git(root, ["rev-parse", "--verify", branch]);
      } catch {
        lines.push({ wave: index + 1, taskId, branch, state: "missing" });
        continue;
      }
      const result = byId.get(taskId);
      if (result?.finalCommit && result.finalCommit === branchTip) {
        // nothing new on the branch beyond the recorded final commit
      }
      let output: string;
      let conflict = false;
      try {
        output = execFileSync(
          "git",
          ["merge-tree", "--write-tree", "--name-only", target, branchTip],
          { cwd: root, encoding: "utf8" },
        );
      } catch (error) {
        conflict = true;
        output =
          error instanceof Error && "stdout" in error
            ? String((error as { stdout?: string }).stdout ?? "")
            : "";
      }
      if (conflict) {
        const conflictFiles = output
          .split("\n")
          .filter((line) => line.length > 0 && !line.startsWith("^[0-9a-f]"))
          .filter((line) => !/^[0-9a-f]{40}$/.test(line.trim()))
          .slice(0, 5);
        lines.push({
          wave: index + 1,
          taskId,
          branch,
          state: "conflict",
          conflicts: conflictFiles.length > 0 ? conflictFiles : ["merge conflicts detected"],
        });
        continue;
      }
      const mergedTree = output.split("\n")[0]?.trim();
      const identical = mergedTree === git(root, ["rev-parse", target + "^{tree}"]);
      lines.push({
        wave: index + 1,
        taskId,
        branch,
        state: identical ? "identical" : "clean",
      });
    }
  });
  return lines;
}

/** Parse a serialized orchestration checkpoint back into task results. */
export function parseOrchestrationResults(content: string): OrchestrationTaskResult[] {
  const results: OrchestrationTaskResult[] = [];
  const blocks = content.split(/\n(?= {2}- id: )/);
  for (const block of blocks) {
    const id = /^ {2}- id: (.+)$/m.exec(block)?.[1];
    if (!id) continue;
    const status = /^ {4}status: (.+)$/m.exec(block)?.[1] as
      OrchestrationTaskResult["status"] | undefined;
    const detail = /^ {4}detail: (.+)$/m.exec(block)?.[1];
    const worktree = /^ {4}worktree: "?([^"\n]+)"?$/m.exec(block)?.[1];
    const baseCommit = /^ {4}baseCommit: "?([^"\n]+)"?$/m.exec(block)?.[1];
    const finalCommit = /^ {4}finalCommit: "?([^"\n]+)"?$/m.exec(block)?.[1];
    results.push({
      id,
      status: status ?? "blocked",
      detail: detail?.replace(/^"|"$/g, "") ?? "",
      ...(worktree ? { worktree } : {}),
      ...(baseCommit ? { baseCommit } : {}),
      ...(finalCommit ? { finalCommit } : {}),
    });
  }
  return results;
}

/** Remove isolated worktrees; failed-task worktrees are kept unless forced. */
export function removeWorktrees(
  root: string,
  paths: Iterable<string>,
  options: { force?: boolean } = {},
): void {
  for (const path of paths) {
    try {
      git(root, ["worktree", "remove", path, options.force ? "--force" : "--force"]);
    } catch {
      // A worktree whose branch has unmerged changes refuses plain removal;
      // callers decide whether to force. Removal failures are non-fatal:
      // `aiw orchestrate --cleanup` can always retry.
    }
  }
}

/** List isolated worktrees managed under `<aiw>/worktrees` (for cleanup/doctor). */
export function listManagedWorktrees(root: string, aiw: string): string[] {
  try {
    const output = git(root, ["worktree", "list", "--porcelain"]);
    // git reports fully resolved paths (macOS /tmp is a symlink to /private/tmp)
    const prefix = realpathSync(join(aiw, "worktrees")) + "/";
    return output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((path) => path.startsWith(prefix));
  } catch {
    return [];
  }
}
export interface AgentOrchestrator {
  run(task: OrchestrationTask): Promise<{ success: boolean; detail: string }>;
}

export function parseOrchestrationPlan(content: string): OrchestrationPlan {
  if (/\r(?!\n)/.test(content))
    throw new Error("Orchestration plan contains unsupported characters.");
  const normalized = content.replace(/\r\n/g, "\n");
  if ([...normalized].some((character) => character !== "\n" && isControl(character)))
    throw new Error("Orchestration plan contains unsupported characters.");
  const lines = normalized.split("\n").filter(Boolean);
  if (lines.some((line) => !isPlanLine(line)))
    throw new Error("Orchestration plan syntax is invalid.");
  if (lines.length < 7 || lines[2] !== "tasks:" || (lines.length - 3) % 4 !== 0)
    throw new Error("Orchestration plan structure is invalid.");
  const schema = lines[0]?.match(/^schema:\s*(.+)$/)?.[1]?.trim();
  if (schema !== "1") throw new Error("Orchestration plan schema must be version 1.");
  const id = lines[1]?.match(/^id:\s*(.+)$/)?.[1]?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error("Orchestration plan id must use lowercase letters, numbers, and hyphens.");
  const taskCount = (lines.length - 3) / 4;
  if (taskCount > 64) throw new Error("Orchestration plan cannot exceed 64 tasks.");
  const tasks = Array.from({ length: taskCount }, (_, index): OrchestrationTask => {
    const offset = 3 + index * 4;
    const taskId = lines[offset]?.match(/^\s{2}- id:\s*(.+)$/)?.[1]?.trim() ?? "";
    const agent = orderedField(lines[offset + 1] ?? "", "agent");
    const prompt = quotedValue(orderedField(lines[offset + 2] ?? "", "prompt"), "prompt");
    const dependsOn = inlineList(orderedField(lines[offset + 3] ?? "", "depends_on"));
    if (!/^TASK-\d+$/.test(taskId)) throw new Error(`Invalid orchestration task id: ${taskId}`);
    if (!ORCHESTRATION_AGENTS.includes(agent as OrchestrationAgent))
      throw new Error(`Unsupported orchestration agent for ${taskId}: ${agent}`);
    if (!prompt.trim()) throw new Error(`Orchestration task prompt is required: ${taskId}`);
    if ([...prompt].some(isControl))
      throw new Error(`Orchestration task prompt contains unsupported characters: ${taskId}`);
    if (prompt.length > 8000) throw new Error(`Orchestration task prompt is too long: ${taskId}`);
    return { id: taskId, agent: agent as OrchestrationAgent, prompt, dependsOn };
  });
  assertPlanGraph(tasks);
  return { schema: 1, id, tasks };
}

export function orchestrationWaves(plan: OrchestrationPlan): string[][] {
  const remaining = new Map(plan.tasks.map((task) => [task.id, task]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size) {
    const wave = [...remaining.values()]
      .filter((task) => task.dependsOn.every((dependency) => completed.has(dependency)))
      .map((task) => task.id)
      .sort();
    if (!wave.length) throw new Error("Orchestration plan contains a dependency cycle.");
    waves.push(wave);
    wave.forEach((id) => {
      remaining.delete(id);
      completed.add(id);
    });
  }
  return waves;
}

export async function executeOrchestrationPlan(
  plan: OrchestrationPlan,
  orchestrator: AgentOrchestrator,
  maxParallel: number,
  isolation?: {
    options: IsolationOptions;
    worktrees: Map<string, { worktree: string; baseCommit: string }>;
  },
): Promise<OrchestrationTaskResult[]> {
  validateOrchestrationParallelism(maxParallel);
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  const results = new Map<string, OrchestrationTaskResult>();
  for (const wave of orchestrationWaves(plan)) {
    for (let offset = 0; offset < wave.length; offset += maxParallel) {
      const batch = wave.slice(offset, offset + maxParallel);
      await Promise.all(
        batch.map(async (id) => {
          const task = tasks.get(id);
          if (!task) throw new Error(`Unknown orchestration task: ${id}`);
          if (task.dependsOn.some((dependency) => results.get(dependency)?.status !== "passed")) {
            results.set(id, { id, status: "blocked", detail: "A dependency did not pass." });
            return;
          }
          const startedAt = Date.now();
          try {
            const isolated = isolation?.worktrees.get(id);
            const outcome = await orchestrator.run(
              isolated ? { ...task, worktree: isolated.worktree } : task,
            );
            const base = isolation?.worktrees.get(id);
            const finalCommit = base ? worktreeFinalCommit(base.worktree) : undefined;
            const diffStat =
              base && finalCommit
                ? boundedDiffStat(
                    gitDiffStat(
                      isolation!.options.root,
                      base.worktree,
                      base.baseCommit,
                      finalCommit,
                    ),
                  )
                : undefined;
            results.set(id, {
              id,
              status: outcome.success ? "passed" : "failed",
              detail: safeDetail(outcome.detail),
              durationMs: Date.now() - startedAt,
              ...(base
                ? {
                    worktree: base.worktree,
                    baseCommit: base.baseCommit,
                    finalCommit,
                    ...(diffStat ? { diffStat } : {}),
                  }
                : {}),
            });
          } catch (error) {
            results.set(id, {
              id,
              status: "failed",
              detail: safeDetail(error instanceof Error ? error.message : String(error)),
            });
          }
        }),
      );
    }
  }
  return plan.tasks.map(
    ({ id }) => results.get(id) ?? { id, status: "blocked", detail: "Not run." },
  );
}

export function validateOrchestrationParallelism(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16)
    throw new Error("Orchestration parallelism must be between 1 and 16.");
  return value;
}

export function serializeOrchestrationPreview(plan: OrchestrationPlan): string {
  return `schema: 1\nplan: ${plan.id}\nwaves:\n${orchestrationWaves(plan)
    .map((wave, index) => `  - index: ${index + 1}\n    tasks: [${wave.join(", ")}]`)
    .join("\n")}\n`;
}

export function serializeOrchestrationResults(
  plan: OrchestrationPlan,
  results: OrchestrationTaskResult[],
  wallClockMs?: number,
): string {
  return `schema: 1\nplan: ${plan.id}\nresults:\n${results
    .map((result) => {
      const isolation = result.worktree
        ? `\n    worktree: ${JSON.stringify(result.worktree)}\n    baseCommit: ${JSON.stringify(result.baseCommit ?? "")}\n    finalCommit: ${JSON.stringify(result.finalCommit ?? "")}${result.durationMs !== undefined ? `\n    durationMs: ${result.durationMs}` : ""}${result.diffStat ? `\n    diffStat: ${JSON.stringify(result.diffStat)}` : ""}`
        : result.durationMs !== undefined
          ? `\n    durationMs: ${result.durationMs}`
          : "";
      return `  - id: ${result.id}\n    status: ${result.status}\n    detail: ${JSON.stringify(result.detail)}${isolation}`;
    })
    .join("\n")}${wallClockMs !== undefined ? `\nwallClockMs: ${wallClockMs}` : ""}\n`;
}

function assertPlanGraph(tasks: OrchestrationTask[]): void {
  const ids = tasks.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Orchestration task ids must be unique.");
  const known = new Set(ids);
  for (const task of tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length)
      throw new Error(`${task.id} dependencies must be unique.`);
    if (task.dependsOn.includes(task.id)) throw new Error(`${task.id} cannot depend on itself.`);
    const unknown = task.dependsOn.find((dependency) => !known.has(dependency));
    if (unknown) throw new Error(`${task.id} has an unknown dependency: ${unknown}`);
  }
  orchestrationWaves({ schema: 1, id: "validation", tasks });
}

function orderedField(line: string, name: string): string {
  const value = line.match(new RegExp(`^\\s{4}${name}:\\s*(.*)$`))?.[1]?.trim();
  if (value === undefined) throw new Error(`Orchestration task field order is invalid: ${name}`);
  return value;
}

function quotedValue(value: string, name: string): string {
  if (!value.startsWith('"') || !value.endsWith('"'))
    throw new Error(`Orchestration field '${name}' must be a JSON string.`);
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error();
    return parsed;
  } catch {
    throw new Error(`Orchestration field '${name}' must be a valid JSON string.`);
  }
}

function inlineList(value: string): string[] {
  if (!/^\[(?:TASK-\d+(?:,\s*TASK-\d+)*)?\]$/.test(value))
    throw new Error("Orchestration dependencies must be an inline list of task ids.");
  return value === "[]"
    ? []
    : value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim());
}

function safeDetail(value: string): string {
  return value
    .replace(/[\r\n\u0085\u2028\u2029]+/g, " ")
    .trim()
    .slice(0, 500);
}

function isPlanLine(line: string): boolean {
  return (
    /^(?:schema|id): .+$/.test(line) ||
    line === "tasks:" ||
    /^\s{2}- id: .+$/.test(line) ||
    /^\s{4}(?:agent|prompt|depends_on): .+$/.test(line)
  );
}

function isControl(value: string): boolean {
  const code = value.codePointAt(0) ?? 0;
  return code <= 31 || code === 127 || code === 133 || code === 8232 || code === 8233;
}
