import { describe, expect, it } from "vitest";
import { selectRecommendations } from "./selection.js";
const items = [
    {
        id: "typescript-quality",
        provider: "multileaf",
        confidence: 1,
        rationale: "TypeScript",
        evidence: ["language:typescript"],
        permissions: [],
        conflicts: [],
    },
    {
        id: "vitest-testing",
        provider: "multileaf",
        confidence: 1,
        rationale: "Vitest",
        evidence: ["testing:vitest"],
        permissions: [],
        conflicts: [],
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
});
