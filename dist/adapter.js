import { join } from "node:path";
import { TARGETS } from "./types.js";
export function isTarget(value) {
    return TARGETS.includes(value);
}
export function generateAiInit(root, target, fs) {
    if (!isTarget(target))
        throw new Error(`Unsupported target: ${target}`);
    const paths = {
        codex: ".agents/skills/ai-init/SKILL.md",
        claude: ".claude/skills/ai-init/SKILL.md",
        cursor: ".cursor/skills/ai-init/SKILL.md",
        universal: ".aiw/resources/skills/ai-init.md",
    };
    fs.write(join(root, paths[target]), `---\nname: ai-init\ndescription: Analyze the project and configure AI Workflow.\n---\n\n# AI Init\n\nAnalyze the repository safely and recommend project-specific capabilities.\n\n## Language Policy\n\nAll generated AI Workflow artifacts must be written in English unless the user explicitly requests another language.\n`);
}
