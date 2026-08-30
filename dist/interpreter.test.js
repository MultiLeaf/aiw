import { describe, expect, it } from "vitest";
import { createInterpretationRequest, createProjectInterpreter, } from "./interpreter.js";
const profile = {
    runtime: { languages: ["typescript"] },
    frameworks: ["react"],
    packageManager: "npm",
    quality: {},
    ci: [],
    workspaces: [],
    facts: [],
};
describe("scoped AI interpreter", () => {
    it("selects only relevant safe files and excludes sensitive or generated paths", () => {
        const request = createInterpretationRequest(profile, [
            "package.json",
            "src/app.ts",
            ".env",
            "node_modules/x.js",
            ".git/config",
            ".aiw/generated/specs/a.md",
            ".aiw/checkpoints/session.yml",
            "README.md",
            "config/.env.production",
            "packages/app/node_modules/x.js",
            "build/output.js",
            ".next/server.js",
            "vendor/library.rb",
            "target/debug/app.rs",
            "image.png",
        ]);
        expect(request.files).toEqual(["README.md", "package.json", "src/app.ts"]);
        expect(request.files.join(" ")).not.toContain(".env");
        expect(request.maxTokens).toBe(4000);
        expect(request.estimatedTokens).toBeLessThanOrEqual(request.maxTokens);
    });
    it("rejects an invalid token budget", () => {
        expect(() => createInterpretationRequest(profile, ["src/app.ts"], 0)).toThrow("maxTokens must be a positive integer");
    });
    it("reads only filtered text context and normalizes structured provider output", async () => {
        const reads = [];
        const provider = {
            generate: async (request) => {
                expect(request.prompt).toContain("## src/app.ts\nfeature modules");
                expect(request.prompt).not.toContain("private-token");
                expect(request.prompt).not.toContain("very-secret");
                expect(request.prompt).toContain("password=[REDACTED]");
                expect(request.responseFormat).toBe("json");
                return JSON.stringify({
                    facts: [
                        {
                            key: "architecture.style",
                            value: "feature-based",
                            confidence: 0.78,
                            evidence: [{ source: "src/app.ts", reason: "Feature modules are grouped" }],
                        },
                    ],
                });
            },
        };
        const interpreter = createProjectInterpreter("/project", provider, async (path) => {
            reads.push(path);
            return path.endsWith("src/app.ts")
                ? "feature modules\npassword=very-secret"
                : "private-token";
        });
        const facts = await interpreter.interpret(createInterpretationRequest(profile, ["src/app.ts", "nested/.env", ".git/config"]));
        expect(reads).toEqual(["/project/src/app.ts"]);
        expect(facts).toEqual([
            {
                key: "architecture.style",
                value: "feature-based",
                state: "inferred",
                method: "ai-inference",
                confidence: 0.78,
                requiresConfirmation: true,
                evidence: [{ source: "src/app.ts", reason: "Feature modules are grouped" }],
            },
        ]);
    });
    it("rejects provider evidence for files outside the scoped request", async () => {
        const provider = {
            generate: async () => JSON.stringify({
                facts: [
                    {
                        key: "policy.secret",
                        value: "present",
                        confidence: 0.9,
                        evidence: [{ source: ".env", reason: "token" }],
                    },
                ],
            }),
        };
        const interpreter = createProjectInterpreter("/project", provider, async () => "source");
        await expect(interpreter.interpret(createInterpretationRequest(profile, ["src/app.ts"]))).rejects.toThrow("outside the scoped context");
    });
    it("defines a structured interpreter contract with inferred output", async () => {
        const interpreter = {
            interpret: async () => [
                {
                    key: "architecture.style",
                    value: "feature-based",
                    state: "inferred",
                    method: "ai-inference",
                    confidence: 0.8,
                    evidence: [{ source: "src/app.ts", reason: "Observed feature boundary" }],
                },
            ],
        };
        const result = await interpreter.interpret(createInterpretationRequest(profile, ["src/app.ts"]));
        expect(result[0]).toMatchObject({ state: "inferred", method: "ai-inference" });
    });
});
