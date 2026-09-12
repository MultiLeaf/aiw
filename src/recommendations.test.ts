import { describe, expect, it } from "vitest";
import { recommendCapabilities, serializeRecommendations } from "./recommendations.js";
import type { ProjectProfile } from "./profile.js";

const profile: ProjectProfile = {
  runtime: { languages: ["typescript"] },
  frameworks: ["nextjs", "react"],
  packageManager: "npm",
  quality: {
    linter: { name: "eslint", command: "npm run lint" },
    formatter: { name: "prettier", command: "npm run format" },
  },
  testing: { name: "vitest", command: "npm test" },
  ci: [],
  workspaces: [],
  facts: [],
};

describe("capability recommendations", () => {
  it("recommends capabilities using project evidence and explains why", () => {
    const recommendations = recommendCapabilities(profile);
    const react = recommendations.find((item) => item.id === "react-best-practices");
    expect(react).toMatchObject({
      id: "react-best-practices",
      confidence: 1,
      permissions: ["network:external"],
      conflicts: [],
    });
    expect(react?.evidence).toContain("framework:react");
    expect(react?.rationale).toContain("React");
  });

  it("recommends testing and quality capabilities for matching tools", () => {
    const ids = recommendCapabilities(profile).map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining(["tdd-development", "typescript-quality", "vitest-testing"]),
    );
  });

  it("recommends stack-specific capabilities with workspace evidence", () => {
    const monorepo: ProjectProfile = {
      ...profile,
      frameworks: ["nestjs", "prisma", "react", "vite"],
      modules: [
        {
          path: "apps/api",
          name: "api",
          runtime: { languages: ["typescript"] },
          frameworks: ["nestjs", "prisma"],
          packageManager: "pnpm",
          quality: {},
          testing: { name: "jest", command: "pnpm --filter api test" },
        },
        {
          path: "apps/web",
          name: "web",
          runtime: { languages: ["typescript"] },
          frameworks: ["react", "vite"],
          packageManager: "pnpm",
          quality: {},
          testing: { name: "vitest", command: "pnpm --filter web test" },
        },
      ],
    };
    const recommendations = recommendCapabilities(monorepo);

    expect(recommendations.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "nestjs-backend",
        "prisma-data-access",
        "react-best-practices",
        "vite-frontend",
      ]),
    );
    expect(recommendations.find(({ id }) => id === "nestjs-backend")?.evidence).toContain(
      "workspace:apps/api",
    );
    expect(recommendations.find(({ id }) => id === "vite-frontend")?.evidence).toContain(
      "workspace:apps/web",
    );
  });

  it("does not recommend unrelated capabilities", () => {
    const empty: ProjectProfile = {
      runtime: { languages: [] },
      frameworks: [],
      packageManager: "unknown",
      quality: {},
      ci: [],
      workspaces: [],
      facts: [],
    };
    expect(recommendCapabilities(empty)).toEqual([]);
  });

  it("serializes recommendations with explicit selection state", () => {
    const output = serializeRecommendations(recommendCapabilities(profile), ["vitest-testing"]);
    expect(output).toContain("id: vitest-testing");
    expect(output).toContain("selected: true");
    expect(output).toContain("selected: false");
  });
});
