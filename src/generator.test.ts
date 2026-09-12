import { describe, expect, it } from "vitest";
import { generateProjectResources, type ResourceWriter } from "./generator.js";
import type { ProjectProfile } from "./profile.js";

const profile: ProjectProfile = {
  runtime: { languages: ["typescript"] },
  frameworks: ["nextjs"],
  packageManager: "npm",
  quality: {
    linter: { name: "eslint", command: "npm run lint" },
    formatter: { name: "prettier", command: "npm run format" },
  },
  testing: { name: "vitest", command: "npm test" },
  ci: ["github-actions"],
  workspaces: [],
  facts: [],
};

describe("project resource generator", () => {
  it("generates English project-specific rules and agent context", () => {
    const files = new Map<string, string>();
    const writer: ResourceWriter = (path, content) => {
      files.set(path, content);
    };
    generateProjectResources(
      profile,
      ["typescript-quality", "tdd-development", "react-best-practices"],
      writer,
    );
    expect(files.get("generated/rules/project-quality.md")).toContain("npm run lint");
    expect(files.get("generated/rules/project-quality.md")).toContain("TypeScript");
    expect(files.get("generated/agents/project-context.md")).toContain("Next.js");
    expect([...files.values()].every((content) => /[A-Za-z]/.test(content))).toBe(true);
  });

  it("generates only selected capability resources", () => {
    const paths: string[] = [];
    generateProjectResources(profile, ["typescript-quality"], (path) => paths.push(path));
    expect(paths).toEqual([
      "generated/rules/project-quality.md",
      "generated/context/project-profile.md",
      "generated/hooks/quality-check.md",
    ]);
  });

  it("does not invent unavailable commands", () => {
    const contents: string[] = [];
    generateProjectResources(
      { ...profile, quality: {}, testing: undefined },
      ["typescript-quality"],
      (_path, content) => contents.push(content),
    );
    expect(contents.join("\n")).not.toContain("npm run lint");
    expect(contents.join("\n")).not.toContain("npm test");
  });

  it("uses distinct test commands from monorepo workspaces", () => {
    const contents: string[] = [];
    const monorepo: ProjectProfile = {
      ...profile,
      testing: undefined,
      modules: [
        {
          path: "apps/api",
          runtime: { languages: ["typescript"] },
          frameworks: ["nestjs"],
          packageManager: "pnpm",
          quality: {},
          testing: { name: "jest", command: "pnpm --filter api test" },
        },
        {
          path: "apps/web",
          runtime: { languages: ["typescript"] },
          frameworks: ["vite", "react"],
          packageManager: "pnpm",
          quality: {},
          testing: { name: "vitest", command: "pnpm --filter web test" },
        },
      ],
    };
    generateProjectResources(monorepo, ["tdd-development"], (_path, content) =>
      contents.push(content),
    );
    expect(contents.join("\n")).toContain(
      "workspace apps/api test command `pnpm --filter api test`",
    );
    expect(contents.join("\n")).toContain(
      "workspace apps/web test command `pnpm --filter web test`",
    );
  });
});
