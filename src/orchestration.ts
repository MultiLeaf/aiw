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
          try {
            const isolated = isolation?.worktrees.get(id);
            const outcome = await orchestrator.run(
              isolated ? { ...task, worktree: isolated.worktree } : task,
            );
            const base = isolation?.worktrees.get(id);
            results.set(id, {
              id,
              status: outcome.success ? "passed" : "failed",
              detail: safeDetail(outcome.detail),
              ...(base
                ? {
                    worktree: base.worktree,
                    baseCommit: base.baseCommit,
                    finalCommit: worktreeFinalCommit(base.worktree),
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
): string {
  return `schema: 1\nplan: ${plan.id}\nresults:\n${results
    .map((result) => {
      const isolation = result.worktree
        ? `\n    worktree: ${JSON.stringify(result.worktree)}\n    baseCommit: ${JSON.stringify(result.baseCommit ?? "")}\n    finalCommit: ${JSON.stringify(result.finalCommit ?? "")}`
        : "";
      return `  - id: ${result.id}\n    status: ${result.status}\n    detail: ${JSON.stringify(result.detail)}${isolation}`;
    })
    .join("\n")}\n`;
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
