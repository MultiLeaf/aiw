import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type CodexResourceType = ResourceType | "context";
export type CodexSupport = "native" | "compatibility";
export type CodexResourceDescriptor = { path: string; support: CodexSupport };

const COMPATIBILITY_ROOTS: Record<Exclude<ResourceType, "skills">, string> = {
  rules: ".agents/rules",
  agents: ".agents/agents",
  hooks: ".agents/hooks",
  templates: ".agents/templates",
};

export function describeCodexResource(
  type: CodexResourceType,
  id: string,
): CodexResourceDescriptor {
  if (type === "skills") return { path: `.agents/skills/${id}/SKILL.md`, support: "native" };
  if (type === "context") return { path: "AGENTS.md", support: "native" };
  if (!(type in COMPATIBILITY_ROOTS)) throw new Error(`Unsupported Codex resource type: ${type}`);
  return {
    path: `${COMPATIBILITY_ROOTS[type]}/${id}/${id}.md`,
    support: "compatibility",
  };
}

export function renderCodexContext(root: string, content: string, fs: FileSystem): string {
  const descriptor = describeCodexResource("context", "project");
  fs.write(join(root, descriptor.path), content);
  return descriptor.path;
}
