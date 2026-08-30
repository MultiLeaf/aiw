import type { ProjectProfile } from "./profile.js";
import { resolveGeneratedPath } from "./drift.js";

export type ResourceWriter = (path: string, content: string) => void;

export function generateProjectResources(
  profile: ProjectProfile,
  selected: string[],
  write: ResourceWriter,
): void {
  if (selected.includes("typescript-quality"))
    write(
      resolveGeneratedPath("rules/project-quality.md"),
      `# Project Quality Rules\n\n- Use ${profile.runtime.languages.map((language) => (language === "typescript" ? "TypeScript" : language)).join(", ")} with strict typing.\n- Run \`${profile.quality.linter?.command ?? "npm run lint"}\` before completion.\n- Run \`${profile.quality.formatter?.command ?? "npm run format"}\` before review.\n- Keep all generated AI Workflow artifacts in English.\n`,
    );
  if (selected.includes("tdd-development"))
    write(
      resolveGeneratedPath("rules/tdd-project-policy.md"),
      `# TDD Project Policy\n\n- Run \`${profile.testing?.command ?? "npm test"}\` for verification.\n- Write a failing behavioral test before implementation.\n- Refactor only after the test is green.\n`,
    );
  if (selected.includes("nextjs-development") || selected.includes("react-best-practices"))
    write(
      resolveGeneratedPath("agents/project-context.md"),
      `# Project Context\n\nThis project uses ${profile.frameworks.map((framework) => (framework === "nextjs" ? "Next.js" : framework)).join(", ")}. Follow the detected project structure and existing framework conventions.\n`,
    );
}
