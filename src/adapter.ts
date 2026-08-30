import { join } from "node:path";
import { TARGETS, type Target, type FileSystem } from "./types.js";
export function isTarget(value: string): value is Target {
  return TARGETS.includes(value as Target);
}
export function generateAiInit(root: string, target: string, fs: FileSystem): void {
  if (!isTarget(target)) throw new Error(`Unsupported target: ${target}`);
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
