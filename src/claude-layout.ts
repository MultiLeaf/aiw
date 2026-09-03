import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type ClaudeResourceType = ResourceType | "context";
export type ClaudeResourceDescriptor = {
  path: string;
  support: "native" | "compatibility";
};

export function describeClaudeResource(
  type: ClaudeResourceType,
  id: string,
): ClaudeResourceDescriptor {
  const native: Partial<Record<ClaudeResourceType, string>> = {
    skills: `.claude/skills/${id}/SKILL.md`,
    rules: `.claude/rules/${id}.md`,
    agents: `.claude/agents/${id}.md`,
    context: "CLAUDE.md",
  };
  if (native[type]) return { path: native[type], support: "native" };
  const compatibility: Partial<Record<ClaudeResourceType, string>> = {
    hooks: `.claude/aiw/hooks/${id}.md`,
    templates: `.claude/aiw/templates/${id}.md`,
  };
  if (compatibility[type]) return { path: compatibility[type], support: "compatibility" };
  throw new Error(`Unsupported Claude resource type: ${type}`);
}

export function renderClaudeContext(root: string, content: string, fs: FileSystem): string {
  const path = describeClaudeResource("context", "project").path;
  fs.write(join(root, path), content);
  return path;
}
