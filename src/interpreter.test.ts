import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInterpretationRequest,
  createProjectInterpreter,
  type AiProvider,
  type Interpreter,
} from "./interpreter.js";
import type { ProjectProfile } from "./profile.js";

const profile: ProjectProfile = {
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
    expect(() => createInterpretationRequest(profile, ["src/app.ts"], 0)).toThrow(
      "maxTokens must be a positive integer",
    );
  });

  it("reads only filtered text context and normalizes structured provider output", async () => {
    const reads: string[] = [];
    const provider: AiProvider = {
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

    const facts = await interpreter.interpret(
      createInterpretationRequest(profile, ["src/app.ts", "nested/.env", ".git/config"]),
    );

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
    const provider: AiProvider = {
      generate: async () =>
        JSON.stringify({
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
    await expect(
      interpreter.interpret(createInterpretationRequest(profile, ["src/app.ts"])),
    ).rejects.toThrow("outside the scoped context");
  });

  it("does not send binary-like context to the provider", async () => {
    const provider: AiProvider = {
      generate: async (request) => {
        expect(request.prompt).not.toContain("binary-content");
        return JSON.stringify({ facts: [] });
      },
    };
    const interpreter = createProjectInterpreter("/project", provider, async (path) =>
      path.endsWith("binary.txt") ? "binary-content\0payload" : "safe text",
    );
    await interpreter.interpret(createInterpretationRequest(profile, ["binary.txt"]));
  });

  it("redacts cloud, provider, quoted, JSON, YAML, bearer, and private-key credentials", async () => {
    const secrets = [
      "aws-secret-value",
      "github-secret-value",
      "azure-secret-value",
      "gcp-secret-value",
      "quoted-secret-value",
      "json-secret-value",
      "yaml-secret-value",
      "bearer-secret-value",
      "private-key-secret-value",
      "ghp_123456789012345678901234567890",
      "sk-123456789012345678901234567890",
      "AKIA1234567890ABCDEF",
    ];
    const source = `AWS_SECRET_ACCESS_KEY = "${secrets[0]}"\nGITHUB_TOKEN: '${secrets[1]}'\nAZURE_CLIENT_SECRET: ${secrets[2]}\nGCP_API_KEY = ${secrets[3]}\n"client_secret": "${secrets[4]}"\n{"OPENAI_API_KEY":"${secrets[5]}"}\npassword: '${secrets[6]}'\nAuthorization: Bearer ${secrets[7]}\n-----BEGIN PRIVATE KEY-----\n${secrets[8]}\n-----END PRIVATE KEY-----\n${secrets[9]}\n${secrets[10]}\n${secrets[11]}\nconst tokenCount = 42\nconst GITHUB_TOKEN\n`;
    const provider: AiProvider = {
      generate: async (request) => {
        for (const secret of secrets) expect(request.prompt).not.toContain(secret);
        expect(request.prompt).toContain("tokenCount = 42");
        expect(request.prompt).toContain("const GITHUB_TOKEN");
        expect(request.prompt).toContain("[REDACTED]");
        return JSON.stringify({ facts: [] });
      },
    };
    await createProjectInterpreter("/project", provider, async () => source).interpret(
      createInterpretationRequest(profile, ["src/config.ts"]),
    );
  });

  it("fails closed when context cannot be read or decoded", async () => {
    let calls = 0;
    const provider: AiProvider = {
      generate: async () => {
        calls += 1;
        return JSON.stringify({ facts: [] });
      },
    };
    const interpreter = createProjectInterpreter("/project", provider, async () => {
      throw new Error("credential-value must not escape");
    });
    expect(
      await interpreter.interpret(createInterpretationRequest(profile, ["src/config.ts"])),
    ).toEqual([]);
    const root = await mkdtemp(join(tmpdir(), "aiw-invalid-utf8-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src/config.ts"), Buffer.from([0xff, 0xfe]));
      const unreadable = createProjectInterpreter(root, provider);
      expect(
        await unreadable.interpret(createInterpretationRequest(profile, ["src/config.ts"])),
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect(calls).toBe(0);
  });

  it("defines a structured interpreter contract with inferred output", async () => {
    const interpreter: Interpreter = {
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
    const result = await interpreter.interpret(
      createInterpretationRequest(profile, ["src/app.ts"]),
    );
    expect(result[0]).toMatchObject({ state: "inferred", method: "ai-inference" });
  });
});
