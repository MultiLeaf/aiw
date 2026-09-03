import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type UniversalResourceType = ResourceType | "context";
export type UniversalResourceDescriptor = { path: string; support: "fallback" };

const ROOTS: Record<UniversalResourceType, string> = {
  skills: ".aiw/resources/skills",
  rules: ".aiw/resources/rules",
  agents: ".aiw/resources/agents",
  hooks: ".aiw/resources/hooks",
  templates: ".aiw/resources/templates",
  context: ".aiw/resources/context",
};

export function describeUniversalResource(
  type: UniversalResourceType,
  id: string,
): UniversalResourceDescriptor {
  const root = ROOTS[type];
  if (!root) throw new Error(`Unsupported universal resource type: ${type}`);
  const filename = type === "skills" ? "SKILL.md" : `${id}.md`;
  return { path: `${root}/${id}/${filename}`, support: "fallback" };
}

export function renderUniversalContext(root: string, content: string, fs: FileSystem): string {
  const path = describeUniversalResource("context", "project").path;
  fs.write(join(root, path), content);
  return path;
}
