import { describe, expect, it } from "vitest";
import { applyOverrides } from "./confirmation.js";
const detected = [
    {
        key: "package-manager",
        value: "npm",
        state: "detected",
        method: "deterministic",
        confidence: 1,
        evidence: [{ source: "package.json", reason: "" }],
    },
];
describe("fact confirmation", () => {
    it("confirms an accepted fact while preserving its evidence", () => {
        const result = applyOverrides(detected, [{ key: "package-manager", action: "accept" }]);
        expect(result[0]).toMatchObject({ state: "confirmed", method: "user-confirmed", value: "npm" });
        expect(result[0].evidence).toEqual(detected[0].evidence);
    });
    it("rejects a detected fact", () => {
        const result = applyOverrides(detected, [{ key: "package-manager", action: "reject" }]);
        expect(result).toEqual([]);
    });
    it("edits a fact and marks the replacement as confirmed", () => {
        const override = { key: "package-manager", action: "edit", value: "pnpm" };
        expect(applyOverrides(detected, [override])).toEqual([
            {
                key: "package-manager",
                value: "pnpm",
                state: "confirmed",
                method: "user-confirmed",
                confidence: 1,
                evidence: [],
            },
        ]);
    });
});
