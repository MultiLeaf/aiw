import { describe, expect, it } from "vitest";
import {
  rankRecommendations,
  recommendCapabilities,
  resourcesForCapabilities,
  serializeRecommendations,
} from "./recommendations.js";
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
      expect.arrayContaining(["tdd-development", "typescript-quality", "verification"]),
    );
  });

  it.each(["jest", "vitest", "playwright", "cypress"])(
    "recommends verification for the %s runner",
    (runner) => {
      const recommendations = recommendCapabilities({ ...profile, testing: { name: runner } });
      expect(recommendations.map(({ id }) => id)).toContain("verification");
      expect(recommendations.find(({ id }) => id === "verification")?.evidence).toContain(
        `testing:${runner}`,
      );
    },
  );

  it("recommends TDD from workspace-level test runners in monorepos", () => {
    const monorepo = recommendCapabilities({
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
      ],
    });
    expect(monorepo.map(({ id }) => id)).toContain("tdd-development");
    expect(monorepo.find(({ id }) => id === "tdd-development")?.evidence).toContain(
      "test-command:pnpm --filter api test",
    );
  });

  it("declares workflow prerequisites and expands the selected skill's dependencies", () => {
    const recommendations = recommendCapabilities(profile);
    expect(recommendations.find(({ id }) => id === "implementation-planning")?.requires).toContain(
      "requirements-specification",
    );
    expect(recommendations.find(({ id }) => id === "tdd-development")?.requires).toEqual([
      "verification",
    ]);
    expect(recommendations.find(({ id }) => id === "verification")?.requires).toEqual([
      "implementation-planning",
    ]);
    expect(
      resourcesForCapabilities([
        "skills/tdd-development",
        "implementation-planning",
        "requirements-specification",
        "verification",
      ]),
    ).toEqual(
      expect.arrayContaining([
        { type: "skills", id: "requirements-specification" },
        { type: "skills", id: "implementation-planning" },
        { type: "skills", id: "verification" },
        { type: "skills", id: "tdd-development" },
      ]),
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

  it("recommends only the universal workflow capabilities when no signals exist", () => {
    const empty: ProjectProfile = {
      runtime: { languages: [] },
      frameworks: [],
      packageManager: "unknown",
      quality: {},
      ci: [],
      workspaces: [],
      facts: [],
    };
    const recommended = recommendCapabilities(empty);
    expect(recommended.map((capability) => capability.id).sort()).toEqual([
      "brainstorming",
      "code-review",
      "implementation-planning",
      "requirements-specification",
      "technical-design",
      "ticket-driven-development",
      "verification",
    ]);
    expect(
      recommended.every(({ evidence }) =>
        evidence.includes(
          "Workflow capability: applies to any project, with or without detected signals.",
        ),
      ),
    ).toBe(true);
  });

  it("serializes recommendations with explicit selection state", () => {
    const output = serializeRecommendations(recommendCapabilities(profile), ["verification"]);
    expect(output).toContain("id: verification");
    expect(output).toContain("selected: true");
    expect(output).toContain("selected: false");
  });
});

describe("decision-model recommendation ranking", () => {
  it("orders recommendations by advisory relevance without changing evidence", async () => {
    const items = recommendCapabilities(profile);
    expect(items.length).toBeGreaterThan(1);
    const baseline = items.map((item) => item.id);
    const outcome = await rankRecommendations(items, profile, async (_p, recs) => {
      const answers: Record<string, { relevance?: number; confidence?: number }> = {};
      for (const [index, item] of recs.entries())
        answers[item.id] =
          index % 2 === 0 ? { relevance: 0.1, confidence: 0.9 } : { relevance: 0.95 };
      return answers;
    });
    expect(outcome.items[0].id).not.toBe(baseline[0]);
    expect(outcome.changedPositions).toBeGreaterThan(0);
    // Advisory: the recommendation payloads themselves are untouched.
    for (const item of outcome.items) {
      const original = items.find((entry) => entry.id === item.id);
      expect(item.confidence).toBe(original?.confidence);
      expect(item.evidence).toEqual(original?.evidence);
    }
    expect(outcome.ranking.every((entry) => entry.relevance >= 0)).toBe(true);
  });

  it("keeps the original order when no relevance is returned", async () => {
    const items = recommendCapabilities(profile);
    const outcome = await rankRecommendations(items, profile, async () => ({}));
    expect(outcome.items.map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(outcome.changedPositions).toBe(0);
    expect(outcome.ranking).toEqual([]);
  });

  it("serializes advisory ranking fields when provided", () => {
    const items = recommendCapabilities(profile).slice(0, 2);
    const output = serializeRecommendations(
      items,
      [],
      [{ id: items[0].id, relevance: 0.75, confidence: 0.6 }],
    );
    expect(output).toContain(`decision_relevance: 0.75`);
    expect(output).toContain(`decision_confidence: 0.6`);
    expect(output.match(/decision_relevance/g)).toHaveLength(1);
  });
});
