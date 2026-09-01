export type VercelSkillsCommand = "find" | "add" | "check" | "update";
export type VercelSkillsRequest = {
  command: VercelSkillsCommand;
  source?: string;
  skill?: string;
  agent?: string;
};

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
