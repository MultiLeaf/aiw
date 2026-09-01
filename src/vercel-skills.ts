export type VercelSkillsCommand = "find" | "add" | "check" | "update";
export type VercelSkillsRequest = {
  command: VercelSkillsCommand;
  source?: string;
  skill?: string;
  agent?: string;
};
export interface CommandExecutor {
  execute(command: string[]): Promise<{ stdout: string; exitCode: number }>;
}

export function buildVercelSkillsCommand(request: VercelSkillsRequest): string[] {
  if (request.command === "find") return ["npx", "skills", "find", request.skill ?? ""];
  if (request.command === "add") {
    if (!request.source) throw new Error("A source is required to add a Vercel skill.");
    return [
      "npx",
      "skills",
      "add",
      request.source,
      ...(request.skill ? ["--skill", request.skill] : []),
      ...(request.agent ? ["--agent", request.agent] : []),
      "--yes",
    ];
  }
  return ["npx", "skills", request.command];
}

export async function installVercelSkill(
  executor: CommandExecutor,
  source: string,
  skill: string,
  agent: string,
): Promise<string> {
  const result = await executor.execute(
    buildVercelSkillsCommand({ command: "add", source, skill, agent }),
  );
  if (result.exitCode !== 0) throw new Error(`Vercel Skills installation failed: ${result.stdout}`);
  return result.stdout;
}
