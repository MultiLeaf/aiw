import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type CopilotResourceType = ResourceType | "context";
export type CopilotResourceDescriptor = {
  path: string;
  support: "native" | "compatibility";
};

export function describeCopilotResource(
  type: CopilotResourceType,
  id: string,
): CopilotResourceDescriptor {
  if (type === "skills") return { path: `.github/skills/${id}/SKILL.md`, support: "native" };
  if (type === "rules")
    return { path: `.github/instructions/${id}.instructions.md`, support: "native" };
  if (type === "agents") return { path: `.github/agents/${id}.md`, support: "native" };
  if (type === "context") return { path: ".github/copilot-instructions.md", support: "native" };
  const roots: Partial<Record<CopilotResourceType, string>> = {
    hooks: ".github/aiw/hooks",
    templates: ".github/aiw/templates",
  };
  const root = roots[type];
  if (!root) throw new Error(`Unsupported Copilot resource type: ${type}`);
  return { path: `${root}/${id}.md`, support: "compatibility" };
}

export function renderCopilotContext(root: string, content: string, fs: FileSystem): string {
  const path = describeCopilotResource("context", "project").path;
  fs.write(join(root, path), content);
  return path;
}
