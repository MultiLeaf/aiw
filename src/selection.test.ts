import { describe, expect, it } from "vitest";
import { selectRecommendations } from "./selection.js";
import type { CapabilityRecommendation } from "./recommendations.js";

const items: CapabilityRecommendation[] = [
  {
    id: "typescript-quality",
    provider: "multileaf",
    confidence: 1,
    rationale: "TypeScript",
    evidence: ["language:typescript"],
    permissions: [],
    conflicts: [],
    resources: [],
  },
  {
    id: "verification",
    provider: "multileaf",
    confidence: 1,
    rationale: "Vitest",
    evidence: ["testing:vitest"],
    permissions: [],
    conflicts: [],
    resources: [],
  },
];

describe("interactive recommendation selection", () => {
  it("returns the selected indexes and skips rejected recommendations", async () => {
    const answers = ["y", "n"];
    const result = await selectRecommendations(items, async () => answers.shift() ?? "n");
    expect(result).toEqual(["typescript-quality"]);
  });

  it("supports non-interactive selection", async () => {
    const result = await selectRecommendations(items, async () => "n", ["verification"]);
    expect(result).toEqual(["verification"]);
  });

  it("selects every capability with the all shortcut", async () => {
    const result = await selectRecommendations(items, async () => "n", ["all"]);
    expect(result).toEqual(["typescript-quality", "verification"]);
  });

  it("accepts individual recommended resources for custom installation", async () => {
    const catalog = [
      {
        ...items[0],
        resources: [{ type: "skills" as const, id: "verification" }],
      },
    ];
    const result = await selectRecommendations(catalog, async () => "n", ["skills/verification"]);
    expect(result).toEqual(["skills/verification"]);
  });

  it("adds declared prerequisite capabilities for a selected stage", async () => {
    const workflow: CapabilityRecommendation[] = [
      {
        ...items[0],
        id: "requirements-specification",
        resources: [{ type: "skills", id: "requirements-specification" }],
      },
      {
        ...items[0],
        id: "implementation-planning",
        requires: ["requirements-specification"],
        resources: [{ type: "skills", id: "implementation-planning" }],
      },
      { ...items[0], id: "verification", resources: [{ type: "skills", id: "verification" }] },
      {
        ...items[0],
        id: "tdd-development",
        requires: ["implementation-planning", "verification"],
        resources: [{ type: "skills", id: "tdd-development" }],
      },
    ];
    const result = await selectRecommendations(workflow, async () => "n", [
      "skills/tdd-development",
    ]);
    expect(result).toEqual([
      "skills/tdd-development",
      "implementation-planning",
      "requirements-specification",
      "verification",
    ]);
  });

  it("accepts the previous verification recommendation ID for saved project state", async () => {
    const workflow = [{ ...items[0], id: "verification" }];
    const result = await selectRecommendations(workflow, async () => "n", ["vitest-testing"]);
    expect(result).toEqual(["verification"]);
  });
});
