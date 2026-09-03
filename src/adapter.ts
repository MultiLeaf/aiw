import { join } from "node:path";
import { TARGETS, type Target, type FileSystem } from "./types.js";
import { getAdapterCapabilities } from "./adapter-contract.js";
import type { ResourceType } from "./package-contract.js";
import { describeCodexResource } from "./codex-layout.js";
import { describeClaudeResource } from "./claude-layout.js";
import { describeCursorResource } from "./cursor-layout.js";
import { describeGeminiResource } from "./gemini-layout.js";
import { describeCopilotResource } from "./copilot-layout.js";
export function isTarget(value: string): value is Target {
  return TARGETS.includes(value as Target);
}

export function detectTarget(root: string, fs: FileSystem): Target | undefined {
  const markers: Array<[Target, string]> = [
    ["codex", ".agents"],
    ["claude", ".claude"],
    ["cursor", ".cursor"],
    ["gemini", ".gemini"],
    ["copilot", ".github/copilot-instructions.md"],
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
    gemini: ".gemini/skills/ai-init/SKILL.md",
    copilot: ".github/copilot-instructions.md",
    universal: ".aiw/resources/skills/ai-init.md",
  };
  fs.write(
    join(root, paths[target]),
    `---\nname: ai-init\ndescription: Analyze the project and configure AI Workflow.\n---\n\n# AI Init\n\nAnalyze the repository safely and recommend project-specific capabilities.\n\n## Language Policy\n\nAll generated AI Workflow artifacts must be written in English unless the user explicitly requests another language.\n`,
  );
}

export function renderResourcePath(target: Target, type: ResourceType, id: string): string {
  if (!isTarget(target))
    throw new Error(`Adapter rendering is not implemented for target: ${target}`);
  if (target === "codex") return describeCodexResource(type, id).path;
  if (target === "claude") return describeClaudeResource(type, id).path;
  if (target === "cursor") return describeCursorResource(type, id).path;
  if (target === "gemini") return describeGeminiResource(type, id).path;
  if (target === "copilot") return describeCopilotResource(type, id).path;
  const roots: Record<ResourceType, string> = {
    skills: ".aiw/resources/skills",
    rules: ".aiw/resources/rules",
    agents: ".aiw/resources/agents",
    hooks: ".aiw/resources/hooks",
    templates: ".aiw/resources/templates",
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
