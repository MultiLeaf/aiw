import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./cli.js";
import { nodeFileSystem } from "./files.js";
import { runCommand } from "./workflow.js";
import type { FileSystem } from "./types.js";
import type { AiProvider, Interpreter } from "./interpreter.js";
import type { DecisionAnswer, DecisionProvider } from "./decision.js";
import type { EmbeddingProvider } from "./semantic.js";
import { checksumPackage } from "./package-integrity.js";
import { parseOwnership, serializeOwnership } from "./ownership.js";
import { parseProjectProfile } from "./profile.js";
import { project, syncWithApproval, writeArtifact } from "./fixtures/cli-test-helpers.js";

describe("AI Workflow CLI — intelligence, recommend, and sync", () => {
  it("scans a JavaScript project and writes its profile", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(cwd, "package.json"), "{}");
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "main.ts"), "export {};");

    expect((await run(["scan"], cwd)).exitCode).toBe(0);
    await expect(readFile(join(cwd, ".aiw/profile.yml"), "utf8")).resolves.toContain(
      "languages: [typescript]",
    );
    await expect(readFile(join(cwd, ".aiw/profile.yml"), "utf8")).resolves.toContain(
      "key: runtime.language",
    );
    await expect(readFile(join(cwd, ".aiw/profile.yml"), "utf8")).resolves.toContain(
      "method: deterministic",
    );
    await expect(readFile(join(cwd, ".aiw/profile.yml"), "utf8")).resolves.toContain(
      'evidence: ["src/main.ts"]',
    );
  });

  it("serializes detected quality and test commands in the profile", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          format: "prettier .",
          typecheck: "tsc --noEmit",
          test: "vitest",
        },
        devDependencies: { eslint: "1", prettier: "1", typescript: "1", vitest: "1" },
      }),
    );
    const result = await run(["scan"], cwd);
    expect(result.exitCode).toBe(0);
    const profile = await readFile(join(cwd, ".aiw/profile.yml"), "utf8");
    expect(profile).toContain("linter_command: eslint .");
    expect(profile).toContain("formatter_command: prettier .");
    expect(profile).toContain("typecheck_command: tsc --noEmit");
    expect(profile).toContain("testing_command: vitest");
  });

  it("persists separate profiles for monorepo modules during scan", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(join(cwd, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
    await mkdir(join(cwd, "apps/api/src"), { recursive: true });
    await writeFile(
      join(cwd, "apps/api/package.json"),
      JSON.stringify({
        name: "api",
        scripts: { test: "jest" },
        dependencies: { "@nestjs/core": "1", "@prisma/client": "1" },
        devDependencies: { prisma: "1", jest: "1" },
      }),
    );
    await writeFile(join(cwd, "apps/api/src/main.ts"), "export {};");
    await mkdir(join(cwd, "apps/web/src"), { recursive: true });
    await writeFile(
      join(cwd, "apps/web/package.json"),
      JSON.stringify({
        name: "web",
        scripts: { test: "vitest run" },
        dependencies: { react: "1" },
        devDependencies: { vite: "1", vitest: "1" },
      }),
    );
    await writeFile(join(cwd, "apps/web/src/main.tsx"), "export {};");

    const result = await run(["scan"], cwd);
    expect(result.exitCode).toBe(0);
    const serialized = await readFile(join(cwd, ".aiw/profile.yml"), "utf8");
    const profile = parseProjectProfile(serialized);
    expect(profile.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "apps/api",
          frameworks: ["nestjs", "prisma"],
          testing: { name: "jest", command: "jest" },
        }),
        expect.objectContaining({
          path: "apps/web",
          frameworks: ["react", "vite"],
          testing: { name: "vitest", command: "vitest run" },
        }),
      ]),
    );
  });

  it("persists scoped inferred facts produced during the scan", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "feature.ts"), "export {};");
    const interpreter: Interpreter = {
      interpret: async (request) => {
        expect(request.files).toContain("src/feature.ts");
        expect(request.files.every((file) => !file.startsWith(".aiw/"))).toBe(true);
        return [
          {
            key: "architecture.style",
            value: "feature-based",
            state: "inferred",
            method: "ai-inference",
            confidence: 0.74,
            requiresConfirmation: true,
            evidence: [{ source: "src/feature.ts", reason: "Feature boundary" }],
          },
        ];
      },
    };

    expect((await run(["scan"], cwd, { interpreter })).exitCode).toBe(0);
    const saved = await readFile(join(cwd, ".aiw/profile.yml"), "utf8");
    expect(saved).toContain("key: architecture.style");
    expect(saved).toContain("state: inferred");
    expect(saved).toContain("requires_confirmation: true");
  });

  it("scopes interpreter context with semantic retrieval when an index exists", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "app" }));
    await writeFile(join(cwd, "README.md"), "# app\n");
    await writeFile(join(cwd, "src", "alpha.ts"), "export const alpha = 1;");
    await writeFile(join(cwd, "src", "zulu.ts"), "export const zulu = 1;");
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
    );
    await mkdir(join(cwd, ".aiw", "semantic"), { recursive: true });
    const vector = [1, 0];
    await writeFile(
      join(cwd, ".aiw", "semantic", "index.json"),
      JSON.stringify({
        schema: 1,
        model: "test-model",
        chunks: [
          { file: "src/zulu.ts", text: "zulu", vector },
          { file: "src/alpha.ts", text: "alpha", vector },
        ],
      }),
    );
    const embeddingProvider: EmbeddingProvider = {
      available: async () => true,
      embed: async () => [[1, 0]],
    };
    const seen: string[][] = [];
    const interpreter: Interpreter = {
      interpret: async (request) => {
        seen.push(request.files);
        return [];
      },
    };
    const result = await run(["scan"], cwd, { interpreter, embeddingProvider });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("embedding: test-model — indexed");
    expect(result.output).toContain("batch requests");
    expect(seen[0][0]).toBe("README.md"); // deterministic key file first
    expect(seen[0]).toContain("package.json");
    expect(seen[0]).toContain("src/alpha.ts");
    expect(seen[0]).toContain("src/zulu.ts");
    expect(seen[0].length).toBeLessThanOrEqual(4);
  });

  it("keeps alphabetical interpreter scoping when the semantic index is absent", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "feature.ts"), "export {};");
    const seen: string[][] = [];
    const interpreter: Interpreter = {
      interpret: async (request) => {
        seen.push(request.files);
        return [];
      },
    };
    expect((await run(["scan"], cwd, { interpreter })).exitCode).toBe(0);
    expect(seen[0]).toEqual([...seen[0]].sort());
  });

  it("uses the built-in AI provider from settings when no interpreter is injected", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "feature.ts"), "export {};");
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "ai:\n  enabled: true\n  model: gpt-oss:20b\n  baseUrl: http://localhost:11434\n",
    );
    const aiProvider: AiProvider = {
      generate: async () =>
        JSON.stringify({
          facts: [
            {
              key: "architecture.style",
              value: "module-based",
              confidence: 0.8,
              evidence: [{ source: "src/feature.ts", reason: "Module boundary" }],
            },
          ],
        }),
    };
    const result = await run(["scan"], cwd, { aiProvider });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Models used:");
    expect(result.output).toContain("interpreter: gpt-oss:20b — 1 facts");
    expect(result.output).toMatch(/~[\d,]+ tokens/);
    const usage = await readFile(join(cwd, ".aiw", "usage.yml"), "utf8");
    expect(usage).toMatch(/scan\.interpreter\|\d+\|\d+\|gpt-oss:20b/);
    const summary = await run(["token-usage"], cwd);
    expect(summary.output).toContain("Token usage by model:");
    expect(summary.output).toContain("- gpt-oss:20b:");
    expect(summary.output).toContain("scan.interpreter");
    const saved = await readFile(join(cwd, ".aiw/profile.yml"), "utf8");
    expect(saved).toContain("key: architecture.style");
    expect(saved).toContain("method: ai-inference");
  });

  it("stays deterministic and offline without an ai settings section", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "feature.ts"), "export {};");
    let calls = 0;
    const aiProvider: AiProvider = {
      generate: async () => {
        calls += 1;
        return "{}";
      },
    };
    const result = await run(["scan"], cwd, { aiProvider });
    expect(result.exitCode).toBe(0);
    expect(calls).toBe(0);
    expect(result.output).toContain("Models used: none (deterministic scan).");
    expect(existsSync(join(cwd, ".aiw", "usage.yml"))).toBe(false);
  });

  it("orders recommendations by decision-model relevance when enabled", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "1" } }),
    );
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "decision:\n  enabled: true\n  model: clef-flash\n  baseUrl: http://localhost:11434\n",
    );
    let asked = 0;
    const decisionProvider: DecisionProvider = {
      available: async () => true,
      decide: async (request) => {
        asked += 1;
        const answers: Record<string, DecisionAnswer> = {};
        for (const id of Object.keys(request.questions))
          answers[id] = { type: "score", score: id.includes("tdd") ? 0.99 : 0.1, confidence: 0.8 };
        return { model: "clef-flash", answers };
      },
    };
    const result = await run(["recommend"], cwd, { decisionProvider });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Advisory decision-model ranking applied");
    expect(asked).toBe(1);
    const saved = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(saved).toContain("decision_relevance: 0.99");
    expect(saved).toContain("decision_confidence: 0.8");
    const firstId = saved.match(/^\s{2}- id: (.+)$/m)?.[1];
    expect(firstId).toBe("tdd-development");
    const usage = await readFile(join(cwd, ".aiw", "usage.yml"), "utf8");
    expect(usage).toMatch(/recommend\.decision\|\d+\|\d+/);
  });

  it("keeps deterministic recommendation order without a decision model", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["recommend"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("decision-model ranking");
    const saved = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(saved).not.toContain("decision_relevance");
  });

  it.each(["generate", "sync"])(
    "enforces organization policy before %s installs an external skill",
    async (command: string): Promise<void> => {
      const cwd = await project();
      await run(["install", "--target", "codex"], cwd);
      await writeFile(
        join(cwd, ".aiw/organization.yml"),
        "schema: 1\nname: Engineering\napproved_sources: [vercel-skills:vercel-labs/agent-skills]\ndenied_permissions: [network:external]\n",
      );
      let calls = 0;
      const options = ["--select=react-best-practices", "--allow=network:external"];
      const services = {
        externalSkills: {
          execute: async (): Promise<{ stdout: string; exitCode: number }> => {
            calls += 1;
            return { stdout: "installed", exitCode: 0 };
          },
        },
      };
      const result =
        command === "sync"
          ? await syncWithApproval(cwd, options, services)
          : await run([command, ...options], cwd, services);

      if (command === "sync") {
        expect(result.exitCode).toBe(0);
        expect(result.output).toContain(
          "Remote skill pending: Package permissions are denied by Engineering: network:external",
        );
        await expect(
          stat(join(cwd, ".agents/skills/technical-design/SKILL.md")),
        ).resolves.toBeTruthy();
      } else {
        expect(result.exitCode).toBe(1);
        expect(result.error).toContain("denied by Engineering");
      }
      expect(calls).toBe(0);
    },
  );

  it("syncs selected local recommendations without network approval and preserves project files", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "latest" },
        devDependencies: { typescript: "latest" },
      }),
    );
    const existingFiles = [
      ["README.md", "Project readme\n"],
      ["src/main.ts", "export const preserved = true;\n"],
      ["docs/architecture.md", "Project architecture\n"],
    ] as const;
    for (const [path, content] of existingFiles) {
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(join(cwd, path), content);
    }
    await run(["recommend", "--select=all"], cwd);
    let externalCalls = 0;
    const result = await syncWithApproval(cwd, [], {
      externalSkills: {
        execute: async () => {
          externalCalls += 1;
          return { stdout: "installed", exitCode: 0 };
        },
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Synchronized");
    expect(result.output).toContain("Remote skill pending: network:external was not approved");
    expect(externalCalls).toBe(0);
    await expect(stat(join(cwd, ".agents/skills/brainstorming/SKILL.md"))).resolves.toBeTruthy();
    await expect(
      stat(join(cwd, ".agents/skills/vercel-react-best-practices/SKILL.md")),
    ).rejects.toThrow();
    for (const [path, content] of existingFiles)
      await expect(readFile(join(cwd, path), "utf8")).resolves.toBe(content);
  });

  it("previews the exact sync plan and requires approval of its current fingerprint", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "latest" },
        devDependencies: { typescript: "latest" },
      }),
    );
    const selected = await run(["recommend", "--select=skills/requirements-specification"], cwd);
    expect(selected.exitCode).toBe(0);

    const preview = await run(["sync", "--preview"], cwd);
    expect(preview.exitCode).toBe(0);
    expect(preview.output).toContain('"plan": {');
    expect(preview.output).toMatch(/"fingerprint": "sha256-[a-f0-9]{64}"/);
    await expect(
      stat(join(cwd, ".agents/skills/requirements-specification/SKILL.md")),
    ).rejects.toThrow();

    const blocked = await run(["sync"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("--approve-plan=");

    const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
    expect(fingerprint).toBeTruthy();
    const applied = await run(["sync", `--approve-plan=${fingerprint}`], cwd);
    expect(applied.exitCode).toBe(0);
    await expect(
      stat(join(cwd, ".agents/skills/requirements-specification/SKILL.md")),
    ).resolves.toBeTruthy();
  });

  it("rejects a sync approval when recommendations change after preview", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "latest" },
        devDependencies: { typescript: "latest" },
      }),
    );
    await writeFile(join(cwd, "README.md"), "Previewed project README.\n");
    await run(["recommend", "--select=skills/requirements-specification"], cwd);
    const preview = await run(["sync", "--preview"], cwd);
    const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
    expect(fingerprint).toBeTruthy();

    await run(["recommend", "--select=skills/technical-design"], cwd);
    await writeFile(join(cwd, "README.md"), "Changed after preview.\n");
    const stale = await run(["sync", `--approve-plan=${fingerprint}`], cwd);
    expect(stale.exitCode).toBe(1);
    expect(stale.error).toContain("plan changed after review");
    await expect(
      stat(join(cwd, ".agents/skills/requirements-specification/SKILL.md")),
    ).rejects.toThrow();
    await expect(stat(join(cwd, ".agents/skills/technical-design/SKILL.md"))).rejects.toThrow();
  });

  it("lists file conflicts before sync and preserves them without partial writes", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "latest" },
        devDependencies: { typescript: "latest" },
      }),
    );
    await run(["recommend", "--select=skills/requirements-specification"], cwd);
    const conflictPath = join(cwd, ".agents/skills/requirements-specification/SKILL.md");
    await mkdir(dirname(conflictPath), { recursive: true });
    await writeFile(conflictPath, "human-owned content\n");

    const preview = await run(["sync", "--preview"], cwd);
    expect(preview.output).toContain(".agents/skills/requirements-specification/SKILL.md");
    expect(preview.output).toContain('"conflicts": [');
    const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
    expect(fingerprint).toBeTruthy();
    const result = await run(["sync", `--approve-plan=${fingerprint}`], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("conflicts and made no changes");
    await expect(readFile(conflictPath, "utf8")).resolves.toBe("human-owned content\n");
    await expect(stat(join(cwd, ".aiw/generated/context/project-profile.md"))).rejects.toThrow();
  });

  it("rolls back every sync write when the filesystem fails mid-apply", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: { react: "latest" },
        devDependencies: { typescript: "latest" },
      }),
    );
    await run(["recommend", "--select=skills/requirements-specification"], cwd);
    const preview = await run(["sync", "--preview"], cwd);
    const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
    expect(fingerprint).toBeTruthy();
    const originalOwnership = await readFile(join(cwd, ".aiw/ownership.yml"), "utf8");
    let writes = 0;
    const failingFileSystem: FileSystem = {
      ...nodeFileSystem,
      writeBytes: (path, content) => {
        writes += 1;
        if (writes === 2) throw new Error("injected filesystem failure");
        nodeFileSystem.writeBytes?.(path, content);
      },
    };
    const result = await runCommand(
      ["sync", `--approve-plan=${fingerprint}`],
      cwd,
      failingFileSystem,
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("injected filesystem failure");
    await expect(readFile(join(cwd, ".aiw/ownership.yml"), "utf8")).resolves.toBe(
      originalOwnership,
    );
    await expect(
      stat(join(cwd, ".agents/skills/requirements-specification/SKILL.md")),
    ).rejects.toThrow();
    await expect(stat(join(cwd, ".aiw/generated/context/project-profile.md"))).rejects.toThrow();
  });

  it("persists an accepted fact override", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["confirm", "--accept", "package-manager"], cwd);
    expect(result.exitCode).toBe(0);
    await expect(readFile(join(cwd, ".aiw/settings.yml"), "utf8")).resolves.toContain(
      "action: accept",
    );
  });

  it("persists an edited fact override", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["confirm", "--edit", "package-manager=pnpm"], cwd);
    await expect(readFile(join(cwd, ".aiw/settings.yml"), "utf8")).resolves.toContain(
      "value: pnpm",
    );
  });

  it("applies confirmed overrides when scanning the project", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(cwd, "package.json"), "{}");
    await run(["confirm", "--edit", "package-manager=pnpm"], cwd);
    await run(["scan"], cwd);
    const profile = await readFile(join(cwd, ".aiw/profile.yml"), "utf8");
    expect(profile).toContain("value: pnpm");
    expect(profile).toContain("state: confirmed");
  });

  it("removes rejected facts from persisted scan output", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(join(cwd, "package.json"), "{}");
    await run(["confirm", "--reject", "package-manager"], cwd);

    const result = await run(["scan"], cwd);
    expect(result.exitCode).toBe(0);
    const profile = await readFile(join(cwd, ".aiw/profile.yml"), "utf8");
    expect(profile).not.toContain("key: package-manager");
  });

  it("generates and selects recommendations through the CLI", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "latest", typescript: "latest" } }),
    );
    const result = await run(["recommend", "--select=verification"], cwd);
    expect(result.exitCode).toBe(0);
    const output = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(output).toContain("id: verification");
    expect(output).toContain("selected: true");
    expect(output).toContain("resources: [skills/verification");
  });

  it("previews recommendations without selecting resources in non-interactive mode", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "latest" } }),
    );

    const preview = await run(["recommend"], cwd);
    expect(preview.exitCode).toBe(0);
    expect(preview.output).toContain("without selection");
    const recommendations = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(recommendations).toContain("id: verification");
    expect(recommendations).toContain("selected: false");
    await expect(stat(join(cwd, ".agents/skills/verification/SKILL.md"))).rejects.toThrow();

    const selection = await run(["recommend", "--select=verification"], cwd);
    expect(selection.exitCode).toBe(0);
    const sync = await syncWithApproval(cwd);
    expect(sync.exitCode).toBe(0);
    await expect(stat(join(cwd, ".agents/skills/verification/SKILL.md"))).resolves.toBeTruthy();
  });

  it("allows declining every recommendation explicitly", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "latest" } }),
    );
    await run(["recommend", "--select=verification"], cwd);

    const declined = await run(["recommend", "--select="], cwd);
    expect(declined.exitCode).toBe(0);
    const sync = await syncWithApproval(cwd);
    expect(sync.exitCode).toBe(0);
    await expect(stat(join(cwd, ".agents/skills/verification/SKILL.md"))).rejects.toThrow();
  });

  it("generates project-specific resources through the CLI", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: { lint: "npm run lint", test: "npm test" },
        devDependencies: { typescript: "latest", eslint: "latest", vitest: "latest" },
      }),
    );
    await run(["generate", "--select=typescript-quality,tdd-development"], cwd);
    const quality = await readFile(join(cwd, ".aiw/generated/rules/project-quality.md"), "utf8");
    expect(quality).toContain("npm run lint");
    await expect(
      stat(join(cwd, ".aiw/generated/rules/tdd-project-policy.md")),
    ).resolves.toBeTruthy();
  });

  it("emits a semantic-retrieval-first rule when semantic mapping is enabled with an index", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "semantic:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
    );
    await mkdir(join(cwd, ".aiw", "semantic"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "semantic", "index.json"),
      JSON.stringify({ schema: 1, model: "test-model", chunks: [] }),
    );
    await run(["generate", "--select=typescript-quality"], cwd);
    const rule = await readFile(join(cwd, ".aiw/generated/rules/semantic-retrieval.md"), "utf8");
    expect(rule).toContain("aiw semantic query");
    expect(rule).toMatch(/grep/);
  });

  it("omits the semantic-retrieval rule when semantic mapping is disabled", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["generate", "--select=typescript-quality"], cwd);
    await expect(stat(join(cwd, ".aiw/generated/rules/semantic-retrieval.md"))).rejects.toThrow();
  });

  it("preserves manually changed generated resources", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "latest" } }),
    );
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "main.ts"), "export {};\n");
    await run(["generate", "--select=typescript-quality"], cwd);
    const path = join(cwd, ".aiw/generated/rules/project-quality.md");
    await writeFile(path, "manual override");
    const result = await run(["generate", "--select=typescript-quality"], cwd);
    expect(result.exitCode).toBe(1);
    await expect(readFile(path, "utf8")).resolves.toBe("manual override");
  });

  it("updates bundled resources drift-safely and additively (UPD-001)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "latest" } }),
    );
    await run(["recommend", "--select=typescript-quality,verification"], cwd);
    await syncWithApproval(cwd);
    const skillPath = join(cwd, ".agents/skills/verification/SKILL.md");
    const catalogBytes = await readFile(skillPath, "utf8");
    // Simulate an older installed version: different bytes, ownership checksum
    // patched to match them (as if installed from an older catalog).
    const older = `${catalogBytes}\n<!-- older version -->\n`;
    await writeFile(skillPath, older);
    const ownershipPath = join(cwd, ".aiw", "ownership.yml");
    const owned = parseOwnership(await readFile(ownershipPath, "utf8"));
    const patched = owned.map((file) =>
      file.path === ".agents/skills/verification/SKILL.md"
        ? { ...file, checksum: `sha256-${checksumPackage(older)}` }
        : file,
    );
    await writeFile(ownershipPath, serializeOwnership(patched));

    // Dry-run reports without writing.
    const preview = await run(["update", "--dry-run"], cwd);
    expect(preview.exitCode).toBe(0);
    expect(preview.output).toContain("updated: 1");
    expect(preview.output).toContain(".agents/skills/verification/SKILL.md");
    expect(preview.output).toContain("new available:");
    await expect(readFile(skillPath, "utf8")).resolves.toBe(older);

    // Apply replaces the unmodified-from-ownership file with the catalog version.
    const applied = await run(["update"], cwd);
    expect(applied.exitCode).toBe(0);
    await expect(readFile(skillPath, "utf8")).resolves.toBe(catalogBytes);

    // Idempotent: everything current on the second run.
    const again = await run(["update"], cwd);
    expect(again.exitCode).toBe(0);
    expect(again.output).toContain("updated: 0");

    // Manual drift: preserved, typed reason, exit 1, file untouched.
    await writeFile(skillPath, "manual edit");
    const conflicted = await run(["update"], cwd);
    expect(conflicted.exitCode).toBe(1);
    expect(conflicted.error).toContain("update_conflict");
    expect(conflicted.error).toContain(".agents/skills/verification/SKILL.md");
    await expect(readFile(skillPath, "utf8")).resolves.toBe("manual edit");
    // Restore for the next scenario.
    await writeFile(skillPath, catalogBytes);
    const ownershipNow = parseOwnership(await readFile(ownershipPath, "utf8"));
    await writeFile(
      ownershipPath,
      serializeOwnership(
        ownershipNow.map((file) =>
          file.path === ".agents/skills/verification/SKILL.md"
            ? { ...file, checksum: `sha256-${checksumPackage(catalogBytes)}` }
            : file,
        ),
      ),
    );

    // --add installs a catalog resource additively.
    const added = await run(["update", "--add=skills/research"], cwd);
    expect(added.exitCode).toBe(0);
    expect(added.output).toContain("installing: skills/research");
    const research = await readFile(join(cwd, ".agents/skills/research/SKILL.md"), "utf8");
    expect(research).toContain("Scope gate");
    await expect(readFile(skillPath, "utf8")).resolves.toBe(catalogBytes);
    const selections = await readFile(join(cwd, ".aiw", "recommendations.yml"), "utf8");
    expect(selections).toContain("skills/research");
    // Unknown id fails closed with available ids.
    const unknown = await run(["update", "--add=skills/nope"], cwd);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.error).toContain("Unknown resource id");
  });

  it("syncs resources selected in recommendations", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "latest" } }),
    );
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "main.ts"), "export {};\n");
    await run(["recommend", "--select=typescript-quality"], cwd);
    const result = await syncWithApproval(cwd);
    expect(result.exitCode).toBe(0);
    await expect(stat(join(cwd, ".aiw/generated/rules/project-quality.md"))).resolves.toBeTruthy();
  });
});

describe("decision findings triage and lane scope-watch (OPP-007)", () => {
  async function gitProject(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-opp7-"));
    const git = (cmd: string, args: string[]): void =>
      execFileSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
    git("git", ["init", "-q"]);
    git("git", ["config", "user.email", "test@example.com"]);
    git("git", ["config", "user.name", "Test"]);
    await writeFile(join(cwd, "README.md"), "# project\n");
    git("git", ["add", "."]);
    git("git", ["commit", "-qm", "initial"]);
    return cwd;
  }

  const FINDINGS = [
    "id: F-1",
    "severity: severe",
    "claim: lockfile overwritten",
    "evidence:",
    "  - src/lock.ts:42",
    "---",
    "id: F-2",
    "severity: minor",
    "claim: style issue",
    "evidence:",
    "  - src/style.ts:1",
  ].join("\n");

  it("prints the deterministic shape check without the model (REQ-001)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeArtifact(cwd, ".aiw/findings.yml", FINDINGS);
    const result = await run(["decision", "findings-triage", "--findings=.aiw/findings.yml"], cwd, {
      decisionProvider: {
        available: async () => {
          throw new Error("must not be called when unconfigured");
        },
        decide: async () => {
          throw new Error("must not be called when unconfigured");
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Shape check: all findings are well-formed.");
  });

  it("flags shape failures and reports advisory evidence triage when enabled (REQ-002)", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "decision:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
    );
    await writeArtifact(
      cwd,
      ".aiw/findings.yml",
      `${FINDINGS}\n---\nid: F-3\nseverity: severe\nclaim: unsupported\n`,
    );
    const result = await run(["decision", "findings-triage", "--findings=.aiw/findings.yml"], cwd, {
      decisionProvider: {
        available: async () => true,
        decide: async () => ({
          model: "test-model",
          answers: {
            "F-1": { type: "choice", choice: "yes" },
            "F-3": { type: "choice", choice: "no" },
          },
        }),
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("F-3: no proof references");
    expect(result.output).toContain("F-1: evidence_supported: yes");
    expect(result.output).toContain("F-3: evidence_supported: no");
    expect(result.output).toContain("refuter still owns corroboration");
    expect(result.output).not.toContain("F-2: evidence_supported");
  });

  it("records the lane mismatch note on light-lane completion and adds scope-watch when enabled (REQ-003/004)", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    // Unconfigured completion: advisory-free output (byte-stable, zero network).
    await run(["task", "start", "--no-ticket", "--lane=light", "--lane-reason=small"], cwd);
    await run(["task", "evidence", "--validation=ok"], cwd);
    // Introduce a high-risk working tree (many files across subsystems).
    for (let i = 0; i < 12; i += 1)
      await writeFile(join(cwd, `risk-${i}.ts`), "export const x = 1;\n");
    const baseline = await run(["workflow", "complete"], cwd);
    expect(baseline.exitCode).toBe(0);
    const advisoryLine = baseline.output.split("\n").find((l) => l.startsWith("advisory:"));
    expect(advisoryLine ?? "").toContain("risk assess reports high");

    // Enabled model: completion adds exactly one advisory scope-watch line (REQ-004).
    await writeFile(
      join(cwd, ".aiw", "settings.yml"),
      "decision:\n  enabled: true\n  model: test-model\n  baseUrl: http://localhost:11434\n",
    );
    await run(["task", "start", "--no-ticket", "--lane=light", "--lane-reason=small"], cwd);
    await run(["task", "evidence", "--validation=ok"], cwd);
    const enabled = await run(["workflow", "complete"], cwd, {
      decisionProvider: {
        available: async () => true,
        decide: async () => ({
          model: "test-model",
          answers: { multi_subsystem: { type: "choice", choice: "yes" } },
        }),
      },
    });
    expect(enabled.exitCode).toBe(0);
    expect(enabled.output).toContain("advisory scope-watch: multi_subsystem=yes (advisory-only)");
  });
});
