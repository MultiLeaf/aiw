import { join } from "node:path";
import type { ResourceType } from "./package-contract.js";
import type { FileSystem } from "./types.js";

export type GeminiResourceType = ResourceType | "context";
export type GeminiResourceDescriptor = {
  path: string;
  support: "native" | "compatibility";
};

export function describeGeminiResource(
  type: GeminiResourceType,
  id: string,
): GeminiResourceDescriptor {
  if (type === "skills") return { path: `.gemini/skills/${id}/SKILL.md`, support: "native" };
  if (type === "agents") return { path: `.gemini/agents/${id}.md`, support: "native" };
  if (type === "context") return { path: "GEMINI.md", support: "native" };
  const roots: Partial<Record<GeminiResourceType, string>> = {
    rules: ".gemini/aiw/rules",
    hooks: ".gemini/aiw/hooks",
    templates: ".gemini/aiw/templates",
  };
  const root = roots[type];
  if (!root) throw new Error(`Unsupported Gemini resource type: ${type}`);
  return { path: `${root}/${id}.md`, support: "compatibility" };
}

export function renderGeminiContext(root: string, content: string, fs: FileSystem): string {
  const path = describeGeminiResource("context", "project").path;
  fs.write(join(root, path), content);
  return path;
}
