export const ORCHESTRATION_AGENTS = ["codex", "claude", "gemini"] as const;
export type OrchestrationAgent = (typeof ORCHESTRATION_AGENTS)[number];
export type OrchestrationTask = {
  id: string;
  agent: OrchestrationAgent;
  prompt: string;
  dependsOn: string[];
};
export type OrchestrationPlan = { schema: 1; id: string; tasks: OrchestrationTask[] };
export type OrchestrationTaskResult = {
  id: string;
  status: "passed" | "failed" | "blocked";
  detail: string;
};
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
  for (const fieldName of ["schema", "id", "tasks"]) {
    if ((normalized.match(new RegExp(`^${fieldName}:`, "gm")) ?? []).length !== 1)
      throw new Error(`Orchestration plan field '${fieldName}' must occur exactly once.`);
  }
  const schema = normalized.match(/^schema:\s*(.+)$/m)?.[1]?.trim();
  if (schema !== "1") throw new Error("Orchestration plan schema must be version 1.");
  const id = normalized.match(/^id:\s*(.+)$/m)?.[1]?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error("Orchestration plan id must use lowercase letters, numbers, and hyphens.");
  const starts = [...normalized.matchAll(/^\s{2}- id:\s*(.+)$/gm)];
  if (!starts.length) throw new Error("Orchestration plan requires at least one task.");
  if (starts.length > 64) throw new Error("Orchestration plan cannot exceed 64 tasks.");
  const tasks = starts.map((match, index): OrchestrationTask => {
    const block = normalized.slice(match.index, starts[index + 1]?.index ?? normalized.length);
    const taskId = match[1].trim();
    const agent = field(block, "agent");
    const prompt = quotedField(block, "prompt");
    const dependsOn = inlineList(field(block, "depends_on"));
    for (const fieldName of ["agent", "prompt", "depends_on"]) {
      if ((block.match(new RegExp(`^\\s{4}${fieldName}:`, "gm")) ?? []).length !== 1)
        throw new Error(`${taskId} field '${fieldName}' must occur exactly once.`);
    }
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
): Promise<OrchestrationTaskResult[]> {
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1 || maxParallel > 16)
    throw new Error("Orchestration parallelism must be between 1 and 16.");
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
            const outcome = await orchestrator.run(task);
            results.set(id, {
              id,
              status: outcome.success ? "passed" : "failed",
              detail: safeDetail(outcome.detail),
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
    .map(
      (result) =>
        `  - id: ${result.id}\n    status: ${result.status}\n    detail: ${JSON.stringify(result.detail)}`,
    )
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

function field(block: string, name: string): string {
  return block.match(new RegExp(`^\\s{4}${name}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
}

function quotedField(block: string, name: string): string {
  const value = field(block, name);
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
