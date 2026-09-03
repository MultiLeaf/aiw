import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type CursorResourceType = ResourceType | "context";
export type CursorResourceDescriptor = {
  path: string;
  support: "native" | "compatibility";
};

export function describeCursorResource(
  type: CursorResourceType,
  id: string,
): CursorResourceDescriptor {
  if (type === "rules") return { path: `.cursor/rules/${id}.mdc`, support: "native" };
  if (type === "context") return { path: "AGENTS.md", support: "native" };
  const roots: Partial<Record<CursorResourceType, string>> = {
    skills: ".cursor/skills",
    agents: ".cursor/aiw/agents",
    hooks: ".cursor/aiw/hooks",
    templates: ".cursor/aiw/templates",
  };
  const root = roots[type];
  if (!root) throw new Error(`Unsupported Cursor resource type: ${type}`);
  return {
    path: type === "skills" ? `${root}/${id}/SKILL.md` : `${root}/${id}.md`,
    support: "compatibility",
  };
}

export function renderCursorContext(root: string, content: string, fs: FileSystem): string {
  const path = describeCursorResource("context", "project").path;
  fs.write(join(root, path), content);
  return path;
}
