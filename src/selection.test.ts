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
    id: "vitest-testing",
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
    const result = await selectRecommendations(items, async () => "n", ["vitest-testing"]);
    expect(result).toEqual(["vitest-testing"]);
  });

  it("selects every capability with the all shortcut", async () => {
    const result = await selectRecommendations(items, async () => "n", ["all"]);
    expect(result).toEqual(["typescript-quality", "vitest-testing"]);
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
});
