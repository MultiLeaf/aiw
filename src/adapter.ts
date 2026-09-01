import { join } from "node:path";
import { TARGETS, type Target, type FileSystem } from "./types.js";
import { getAdapterCapabilities } from "./adapter-contract.js";
import type { ResourceType } from "./package-contract.js";
export function isTarget(value: string): value is Target {
  return TARGETS.includes(value as Target);
}

export function detectTarget(root: string, fs: FileSystem): Target | undefined {
  const markers: Array<[Target, string]> = [
    ["codex", ".agents"],
    ["claude", ".claude"],
    ["cursor", ".cursor"],
  ];
  return markers.find(([, marker]) => fs.exists(join(root, marker)))?.[0];
}
export function generateAiInit(root: string, target: string, fs: FileSystem): void {
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
  getAdapterCapabilities(target);
  const paths: Record<Target, string> = {
    codex: ".agents/skills/ai-init/SKILL.md",
    claude: ".claude/skills/ai-init/SKILL.md",
    cursor: ".cursor/skills/ai-init/SKILL.md",
    universal: ".aiw/resources/skills/ai-init.md",
  };
  fs.write(
    join(root, paths[target]),
    `---\nname: ai-init\ndescription: Analyze the project and configure AI Workflow.\n---\n\n# AI Init\n\nAnalyze the repository safely and recommend project-specific capabilities.\n\n## Language Policy\n\nAll generated AI Workflow artifacts must be written in English unless the user explicitly requests another language.\n`,
  );
}

export function renderResourcePath(target: Target, type: ResourceType, id: string): string {
  if (target !== "codex" && target !== "claude" && target !== "cursor")
    throw new Error(`Adapter rendering is not implemented for target: ${target}`);
  const roots: Record<ResourceType, string> = {
    skills:
      target === "codex"
        ? ".agents/skills"
        : target === "claude"
          ? ".claude/skills"
          : ".cursor/skills",
    rules:
      target === "codex"
        ? ".agents/rules"
        : target === "claude"
          ? ".claude/rules"
          : ".cursor/rules",
    agents:
      target === "codex"
        ? ".agents/agents"
        : target === "claude"
          ? ".claude/agents"
          : ".cursor/agents",
    hooks:
      target === "codex"
        ? ".agents/hooks"
        : target === "claude"
          ? ".claude/hooks"
          : ".cursor/hooks",
    templates:
      target === "codex"
        ? ".agents/templates"
        : target === "claude"
          ? ".claude/templates"
          : ".cursor/templates",
  };
  return join(roots[type], id, type === "skills" ? "SKILL.md" : `${id}.md`);
}

export function renderCodexResource(
  type: ResourceType,
  id: string,
  content: string,
  root: string,
  fs: FileSystem,
): string {
  const path = renderResourcePath("codex", type, id);
  fs.write(join(root, path), content);
  return path;
}
