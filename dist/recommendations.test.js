import { describe, expect, it } from "vitest";
import { recommendCapabilities, serializeRecommendations } from "./recommendations.js";
const profile = {
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
            permissions: [],
            conflicts: [],
        });
        expect(react?.evidence).toContain("framework:react");
        expect(react?.rationale).toContain("React");
    });
    it("recommends testing and quality capabilities for matching tools", () => {
        const ids = recommendCapabilities(profile).map((item) => item.id);
        expect(ids).toEqual(expect.arrayContaining(["tdd-development", "typescript-quality", "vitest-testing"]));
    });
    it("does not recommend unrelated capabilities", () => {
        const empty = {
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
