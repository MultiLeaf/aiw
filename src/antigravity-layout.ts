import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type AntigravityResourceType = ResourceType | "context";
export type AntigravityResourceDescriptor = {
  path: string;
  support: "native" | "compatibility";
};

export function describeAntigravityResource(
  type: AntigravityResourceType,
  id: string,
): AntigravityResourceDescriptor {
  if (type === "skills") return { path: `.agents/skills/${id}/SKILL.md`, support: "native" };
  if (type === "rules") return { path: `.agents/rules/${id}.md`, support: "native" };
  if (type === "context") return { path: "GEMINI.md", support: "native" };
  const roots: Partial<Record<AntigravityResourceType, string>> = {
    agents: ".agents/agents",
    hooks: ".agents/hooks",
    templates: ".agents/templates",
  };
  const root = roots[type];
  if (!root) throw new Error(`Unsupported Antigravity resource type: ${type}`);
  return { path: `${root}/${id}.md`, support: "compatibility" };
}

export function renderAntigravityContext(root: string, content: string, fs: FileSystem): string {
  const path = describeAntigravityResource("context", "project").path;
  fs.write(join(root, path), content);
  return path;
}
