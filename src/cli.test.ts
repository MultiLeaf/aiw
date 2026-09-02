import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";
import type { Interpreter } from "./interpreter.js";
import { checksumPackage } from "./package-integrity.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-test-"));
}

describe("AI Workflow CLI", () => {
  it("installs the neutral structure and the selected Codex target", async () => {
    const cwd = await project();
    const result = await run(["install", "--target", "codex"], cwd);

    expect(result.exitCode).toBe(0);
    await expect(stat(join(cwd, ".aiw", "manifest.yml"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".context/adrs/INDEX.md"))).resolves.toBeTruthy();
    await expect(readFile(join(cwd, ".agents/skills/ai-init/SKILL.md"), "utf8")).resolves.toContain(
      "All generated AI Workflow artifacts must be written in English",
    );
  });

  it("detects an existing target when no target override is provided", async () => {
    const cwd = await project();
    await mkdir(join(cwd, ".claude"));
    const result = await run(["install"], cwd);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("claude");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: claude",
    );
  });

  it.each([
    ["codex", ".agents/skills/ai-init/SKILL.md"],
    ["claude", ".claude/skills/ai-init/SKILL.md"],
    ["cursor", ".cursor/skills/ai-init/SKILL.md"],
    ["universal", ".aiw/resources/skills/ai-init.md"],
  ])("installs the base ai-init skill for %s", async (target, path) => {
    const cwd = await project();
    const result = await run(["install", "--target", target], cwd);

    expect(result.exitCode).toBe(0);
    const skill = await readFile(join(cwd, path), "utf8");
    expect(skill).toContain("name: ai-init");
    expect(skill).toContain("Analyze the repository safely");
    expect(skill).toContain("All generated AI Workflow artifacts must be written in English");
  });

  it("makes repeated installation idempotent and preserves existing state", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await run(["confirm", "--edit", "package-manager=pnpm"], cwd);
    const manifestBefore = await readFile(join(cwd, ".aiw/manifest.yml"), "utf8");
    const result = await run(["install", "--target", "claude"], cwd);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Existing state preserved");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toBe(manifestBefore);
    await expect(readFile(join(cwd, ".aiw/overrides.yml"), "utf8")).resolves.toContain(
      "value: pnpm",
    );
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".claude/skills/ai-init/SKILL.md"))).rejects.toThrow();
  });

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

  it("migrates the generated target and updates the manifest", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);

    expect((await run(["target", "claude"], cwd)).exitCode).toBe(0);
    await expect(stat(join(cwd, ".claude/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: claude",
    );
  });

  it("migrates a neutral ai-init resource to the selected target", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const neutral = join(cwd, ".aiw/resources/skills/ai-init.md");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(neutral, "# Neutral AI Init\n");
    expect((await run(["target", "cursor"], cwd)).exitCode).toBe(0);
    await expect(readFile(join(cwd, ".cursor/skills/ai-init/SKILL.md"), "utf8")).resolves.toBe(
      "# Neutral AI Init\n",
    );
  });

  it("supports migration preview and blocks conflicting target content", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const preview = await run(["target", "cursor", "--dry-run"], cwd);
    expect(preview.exitCode).toBe(0);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, ".cursor/skills/ai-init"), { recursive: true });
    await writeFile(join(cwd, ".cursor/skills/ai-init/SKILL.md"), "# Manual content\n");
    const result = await run(["target", "cursor"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Migration conflict");
  });

  it("restores a target resource from a migration backup", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const neutral = join(cwd, ".aiw/resources/skills/ai-init.md");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(neutral, "# Original\n");
    await mkdir(join(cwd, ".cursor/skills/ai-init"), { recursive: true });
    await writeFile(join(cwd, ".cursor/skills/ai-init/SKILL.md"), "# Original\n");
    await run(["target", "cursor"], cwd);
    await writeFile(join(cwd, ".cursor/skills/ai-init/SKILL.md"), "# Changed\n");
    expect((await run(["rollback"], cwd)).exitCode).toBe(0);
    await expect(readFile(join(cwd, ".cursor/skills/ai-init/SKILL.md"), "utf8")).resolves.toBe(
      "# Original\n",
    );
  });

  it("rejects unsupported targets without changing the manifest", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["target", "unknown"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Unsupported target");
  });

  it("reports actionable errors when validating an invalid manifest", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, ".aiw/manifest.yml"),
      "schema: 1\nproject:\n  name: demo\ntarget:\n  active: unsupported\npolicies:\n  artifact_language: en\n",
    );

    const result = await run(["validate"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Manifest target.active is unsupported");
  });

  it("validates the package contract through the CLI", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { copyFile } = await import("node:fs/promises");
    await copyFile(join(process.cwd(), "resources/package.yaml"), join(cwd, "package.yaml"));
    const result = await run(["validate", "--package=package.yaml"], cwd);
    expect(result.exitCode).toBe(0);
  });

  it("lists and searches the curated package registry", async () => {
    const all = await run(["registry"], await project());
    expect(all.exitCode).toBe(0);
    expect(all.output).toContain("multileaf/aiw-self-hosting@0.1.0");
    const result = await run(["registry", "--search=react"], await project());
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("vercel/react-best-practices@latest");
    expect(result.output).toContain("permissions: network:external");
    expect(result.output).not.toContain("multileaf/aiw-self-hosting");
  });

  it("verifies a package checksum through the CLI", async () => {
    const cwd = await project();
    const packagePath = join(cwd, "package.yaml");
    const content = "schema: 1\ntrusted: package\n";
    await writeFile(packagePath, content);
    const verified = await run(
      ["verify-package", "--package=package.yaml", `--checksum=${checksumPackage(content)}`],
      cwd,
    );
    expect(verified.exitCode).toBe(0);
    const rejected = await run(["verify-package", "--package=package.yaml", "--checksum=bad"], cwd);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.error).toContain("checksum mismatch");
  });

  it("stores and composes layered project context", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    expect(
      (await run(["context", "--layer=project", "--content=Project conventions"], cwd)).exitCode,
    ).toBe(0);
    expect((await run(["context", "--layer=task", "--content=Current task"], cwd)).exitCode).toBe(
      0,
    );
    const result = await run(["context"], cwd);
    expect(result.output).toContain("# project context");
    expect(result.output).toContain("Project conventions");
    expect(result.output).toContain("# task context");
  });

  it("creates an English brainstorming artifact with required sections", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["brainstorm", "--title=Portable Workflow"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(join(cwd, ".aiw/generated/specs/brainstorm.md"), "utf8");
    expect(artifact).toContain("# Portable Workflow");
    for (const section of ["Goal", "Users", "Hypotheses", "Constraints", "Open Questions"])
      expect(artifact).toContain(`## ${section}`);
  });

  it("creates a specification with stable requirement IDs and acceptance criteria", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["spec", "--title=Workflow Specification"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(join(cwd, ".aiw/generated/specs/specification.md"), "utf8");
    expect(artifact).toContain("# Workflow Specification");
    expect(artifact).toContain("REQ-001");
    expect(artifact).toContain("Acceptance criteria");
    expect(artifact).toContain("Given");
    expect(artifact).toContain("When");
    expect(artifact).toContain("Then");
  });

  it("creates an ADR with alternatives, decision, rationale, and links", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["adr", "--id=007", "--title=Use Neutral Adapters"], cwd);
    expect(result.exitCode).toBe(0);
    const path = join(cwd, ".context/adrs/ADR-007-use-neutral-adapters.md");
    const artifact = await readFile(path, "utf8");
    expect(artifact).toContain("## Alternatives");
    expect(artifact).toContain("## Decision");
    expect(artifact).toContain("## Rationale");
    expect(artifact).toContain(".aiw/generated/specs/");
  });

  it("creates an implementation plan linked to requirements and validation commands", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["plan", "--title=First Increment"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(
      join(cwd, ".aiw/generated/plans/implementation-plan.md"),
      "utf8",
    );
    expect(artifact).toContain("REQ-001");
    expect(artifact).toContain("TASK-001");
    expect(artifact).toContain("npm run check");
  });

  it("reports missing verification evidence and passes after required artifacts exist", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["verify"], cwd)).error).toContain("Specification artifact is missing");
    await run(["spec"], cwd);
    await run(["plan"], cwd);
    const result = await run(["verify"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Verification passed");
  });

  it("creates a queryable requirement traceability artifact", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["spec"], cwd);
    await run(["plan"], cwd);
    const result = await run(["trace"], cwd);
    expect(result.exitCode).toBe(0);
    const trace = await readFile(join(cwd, ".aiw/generated/artifacts/traceability.yml"), "utf8");
    expect(trace).toContain("requirement: REQ-001");
    expect(trace).toContain("tasks: [TASK-001]");
    expect(trace).toContain("npm run check");
  });

  it("blocks SDD progression until the previous artifact exists", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["gate", "plan"], cwd)).error).toContain("Quality gate blocked");
    await run(["spec"], cwd);
    expect((await run(["gate", "plan"], cwd)).output).toContain("Quality gate passed");
    expect((await run(["gate", "unknown"], cwd)).error).toContain("Usage");
  });

  it("resolves a package and generates an exact lockfile", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { copyFile } = await import("node:fs/promises");
    await copyFile(join(process.cwd(), "resources/package.yaml"), join(cwd, "package.yaml"));
    const result = await run(["resolve", "--package=package.yaml"], cwd);

    expect(result.exitCode).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("id: multileaf/aiw-self-hosting");
    expect(lock).toContain("integrity: sha256-multileaf/aiw-self-hosting@0.1.0");
  });

  it("updates a package only when the candidate is newer and compatible", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const packagePath = join(cwd, "package.yaml");
    const packageContent = (version: string): string => `schema: 1
id: demo/package
version: ${version}
provider: local
source: ./package
dependencies: []
permissions: []
provenance:
  source: ./package
resources:
  skills:
    - { id: demo-skill, version: ${version}, path: skill.md }
  rules: []
  agents: []
  hooks: []
  templates: []
`;
    await writeFile(packagePath, packageContent("1.0.0"));
    await run(["resolve", "--package=package.yaml"], cwd);
    await writeFile(packagePath, packageContent("2.0.0"));
    const updated = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(updated.exitCode).toBe(0);
    expect(updated.output).toContain("demo/package@2.0.0");
    await expect(readFile(join(cwd, ".aiw/lock.yml"), "utf8")).resolves.toContain("version: 2.0.0");
    const current = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(current.exitCode).toBe(1);
    expect(current.error).toContain("already at 2.0.0");

    await writeFile(packagePath, packageContent("3.0.0"));
    const unsupported = await run(
      ["update", "--package=package.yaml", "--target=unsupported"],
      cwd,
    );
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.error).toContain("Unsupported target");

    await writeFile(
      packagePath,
      packageContent("3.0.0").replace("dependencies: []", "dependencies: [demo/base]"),
    );
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `${await readFile(join(cwd, ".aiw/lock.yml"), "utf8")}  - id: demo/base\n    version: 1.0.0\n    provider: local\n    source: ./base\n    integrity: sha256-demo/base@1.0.0\n`,
    );
    const conflict = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.error).toContain("incompatible");
  });

  it("records an externally installed Vercel skill in the AIW lockfile", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "skills-lock.json"),
      '{"skills":{"vercel-react-best-practices":{"computedHash":"hash-123"}}}',
    );
    const calls: string[][] = [];
    const blocked = await run(["generate", "--select=react-best-practices"], cwd, {
      externalSkills: {
        execute: async () => ({ stdout: "installed", exitCode: 0 }),
      },
    });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("network:external");
    const result = await run(
      ["generate", "--select=react-best-practices", "--allow=network:external"],
      cwd,
      {
        externalSkills: {
          execute: async (command) => {
            calls.push(command);
            return { stdout: "installed", exitCode: 0 };
          },
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toContain("vercel-labs/agent-skills@vercel-react-best-practices");
    await expect(readFile(join(cwd, ".aiw/lock.yml"), "utf8")).resolves.toContain(
      "integrity: hash-123",
    );
  });

  it("reports actionable diagnostics with doctor", async () => {
    const cwd = await project();
    expect((await run(["doctor"], cwd)).error).toContain("Missing AI Workflow files");
    await run(["install"], cwd);
    expect((await run(["doctor"], cwd)).output).toContain("health check passed");
  });

  it("repairs missing structure and uninstalls only owned files", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const dryRun = await run(["uninstall", "--dry-run"], cwd);
    expect(dryRun.output).toContain("Would remove");
    expect(await stat(join(cwd, ".aiw/manifest.yml"))).toBeTruthy();
    const repaired = await run(["repair"], cwd);
    expect(repaired.output).toContain("repaired");
    const removed = await run(["uninstall"], cwd);
    expect(removed.output).toContain("removed");
    await expect(stat(join(cwd, ".aiw/manifest.yml"))).rejects.toThrow();
  });

  it("persists an accepted fact override", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["confirm", "--accept", "package-manager"], cwd);
    expect(result.exitCode).toBe(0);
    await expect(readFile(join(cwd, ".aiw/overrides.yml"), "utf8")).resolves.toContain(
      "action: accept",
    );
  });

  it("persists an edited fact override", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["confirm", "--edit", "package-manager=pnpm"], cwd);
    await expect(readFile(join(cwd, ".aiw/overrides.yml"), "utf8")).resolves.toContain(
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

  it("generates and selects recommendations through the CLI", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "latest", typescript: "latest" } }),
    );
    const result = await run(["recommend", "--select=vitest-testing"], cwd);
    expect(result.exitCode).toBe(0);
    const output = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(output).toContain("id: vitest-testing");
    expect(output).toContain("selected: true");
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
    const result = await run(["sync"], cwd);
    expect(result.exitCode).toBe(0);
    await expect(stat(join(cwd, ".aiw/generated/rules/project-quality.md"))).resolves.toBeTruthy();
  });
});
