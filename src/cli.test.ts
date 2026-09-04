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
    ["gemini", ".gemini/skills/ai-init/SKILL.md"],
    ["copilot", ".github/copilot-instructions.md"],
    ["universal", ".aiw/resources/skills/ai-init.md"],
  ])("installs the base ai-init skill for %s", async (target, path) => {
    const cwd = await project();
    const result = await run(["install", "--target", target], cwd);

    expect(result.exitCode).toBe(0);
    const skill = await readFile(join(cwd, path), "utf8");
    expect(skill).toContain(target === "copilot" ? "# AI Init" : "name: ai-init");
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

  it("does not overwrite a user-edited target skill on reinstall", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const skillPath = join(cwd, ".agents/skills/ai-init/SKILL.md");
    await writeFile(skillPath, "user override\n");
    const result = await run(["install", "--target", "codex"], cwd);
    expect(result.output).toContain("Existing state preserved");
    await expect(readFile(skillPath, "utf8")).resolves.toBe("user override\n");
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
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).rejects.toThrow();
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

  it("uses the same Copilot ai-init path for installation and migration", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    await writeFile(join(cwd, ".aiw/resources/skills/ai-init.md"), "# Copilot AI Init\n");
    expect((await run(["target", "copilot"], cwd)).exitCode).toBe(0);
    await expect(readFile(join(cwd, ".github/copilot-instructions.md"), "utf8")).resolves.toBe(
      "# Copilot AI Init\n",
    );
    await expect(stat(join(cwd, ".github/skills/ai-init/SKILL.md"))).rejects.toThrow();
  });

  it("blocks a conflicting universal resource without overwriting it", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const neutral = join(cwd, ".aiw/resources/skills/ai-init.md");
    await mkdir(join(cwd, ".aiw/resources/skills"), { recursive: true });
    await writeFile(neutral, "# Conflicting neutral content\n");
    const result = await run(["target", "universal"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Migration conflict");
    await expect(readFile(neutral, "utf8")).resolves.toBe("# Conflicting neutral content\n");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: codex",
    );
    expect((await run(["rollback"], cwd)).error).toContain("No migration backup");
  });

  it("renders all neutral resource categories when changing target", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const resources = join(cwd, ".aiw/resources");
    const fixtures = [
      ["skills/review/SKILL.md", ".claude/skills/review/SKILL.md"],
      ["rules/quality/quality.md", ".claude/rules/quality.md"],
      ["agents/reviewer/reviewer.md", ".claude/agents/reviewer.md"],
      ["hooks/check/check.md", ".claude/aiw/hooks/check.md"],
      ["templates/spec/spec.md", ".claude/aiw/templates/spec.md"],
    ];
    for (const [source] of fixtures) {
      await mkdir(join(resources, source, ".."), { recursive: true });
      await writeFile(join(resources, source), `content:${source}\n`);
    }
    const result = await run(["target", "claude"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("rendered 5 neutral resources");
    for (const [source, destination] of fixtures)
      await expect(readFile(join(cwd, destination), "utf8")).resolves.toBe(`content:${source}\n`);
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: claude",
    );
    expect((await run(["rollback"], cwd)).exitCode).toBe(0);
    for (const [, destination] of fixtures)
      await expect(stat(join(cwd, destination))).rejects.toThrow();
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: universal",
    );
  });

  it("preserves resource bytes during migration and rollback", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const source = join(cwd, ".aiw/resources/templates/binary/binary.md");
    const destination = join(cwd, ".claude/aiw/templates/binary.md");
    const bytes = Buffer.from([0x42, 0x00, 0xff, 0x43, 0x0a]);
    await mkdir(join(source, ".."), { recursive: true });
    await writeFile(source, bytes);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, bytes);
    expect((await run(["target", "claude"], cwd)).exitCode).toBe(0);
    await expect(readFile(destination)).resolves.toEqual(bytes);
    expect((await run(["rollback"], cwd)).exitCode).toBe(0);
    await expect(readFile(destination)).resolves.toEqual(bytes);
  });

  it("supports migration preview and blocks conflicting target content", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const preview = await run(["target", "cursor", "--dry-run"], cwd);
    expect(preview.exitCode).toBe(0);
    expect(preview.output).toContain("Migration preview for cursor");
    expect(preview.output).toContain("remove: previous target ai-init");
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
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: universal",
    );
  });

  it("rollback restores a removed previous target and removes a newly created destination", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const previous = join(cwd, ".agents/skills/ai-init/SKILL.md");
    const original = await readFile(previous, "utf8");
    await run(["target", "claude"], cwd);
    await expect(stat(previous)).rejects.toThrow();
    expect((await run(["rollback"], cwd)).exitCode).toBe(0);
    await expect(readFile(previous, "utf8")).resolves.toBe(original);
    await expect(stat(join(cwd, ".claude/skills/ai-init/SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: codex",
    );
    const recreated = join(cwd, ".claude/skills/ai-init/SKILL.md");
    await writeFile(recreated, "# User recreated\n");
    expect((await run(["rollback"], cwd)).error).toContain("No migration backup");
    await expect(readFile(recreated, "utf8")).resolves.toBe("# User recreated\n");
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
    const task = await run(["context", "--task"], cwd);
    expect(task.output).toContain("Current task");
    expect(task.output).not.toContain("# session context");
    const delta = await run(["context", "--delta-from=global"], cwd);
    expect(delta.output).toContain("Project conventions");
    expect(delta.output).toContain("Current task");
    expect(delta.output).not.toContain("session");
    expect(delta.output).not.toContain("# global context");
  });

  it("invalidates stale context summaries", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await run(["context", "--layer=project", "--content=Original context"], cwd);
    expect((await run(["context-summary", "--summary=Original summary"], cwd)).output).toBe(
      "Original summary",
    );
    expect((await run(["context-summary", "--summary=Ignored while fresh"], cwd)).output).toBe(
      "Original summary",
    );
    await run(["context", "--layer=project", "--content=Changed context"], cwd);
    expect((await run(["context-summary", "--summary=Updated summary"], cwd)).output).toBe(
      "Updated summary",
    );
  });

  it("records and reports per-stage token usage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const recorded = await run(["token-usage", "--stage=scan", "--budget=100", "--used=75"], cwd);
    expect(recorded).toEqual({ exitCode: 0, output: "Token usage recorded: scan (75/100)" });
    const report = await run(["token-usage"], cwd);
    expect(report.output).toContain("scan|100|75");
    expect(
      (await run(["token-usage", "--stage=scan", "--budget=10", "--used=11"], cwd)).error,
    ).toContain("Token budget exceeded");
  });

  it("runs self-validation and records generated-output evidence", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["brainstorm"], cwd);
    const calls: string[][] = [];
    const result = await run(["self-validate", "--ticket=FND-009"], cwd, {
      selfValidation: {
        execute: async (command): Promise<{ stdout: string; exitCode: number }> => {
          calls.push(command);
          return { stdout: "checks passed", exitCode: 0 };
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([["npm", "--prefix", cwd, "run", "check"]]);
    const evidence = await readFile(
      join(cwd, ".aiw/checkpoints/self-validation-fnd-009.yml"),
      "utf8",
    );
    expect(evidence).toContain("ticket: FND-009");
    expect(evidence).toContain("generated/specs/brainstorm.md");
    expect(evidence).toContain("result: pass");
  });

  it("reports deterministic context quality metrics", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["context", "--layer=project", "--content=Shared line\nProject line"], cwd);
    await run(["context", "--layer=task", "--content=Shared line"], cwd);
    const result = await run(["context-quality"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("non_empty_layers: 2");
    expect(result.output).toContain("duplicate_lines: 1");
    expect(result.output).toBe((await run(["context-quality"], cwd)).output);
  });

  it("reports adapter capabilities through the CLI", async () => {
    const result = await run(["capabilities", "--target=codex"], await project());
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("resources: [skills, rules, agents, hooks, templates]");
    expect(result.output).toContain("events: [install, update, remove, validate]");
  });

  it("creates an English brainstorming artifact with required sections", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["brainstorm", "--title=Portable Workflow"], cwd);
    expect(result.exitCode).toBe(0);
    const artifact = await readFile(join(cwd, ".aiw/generated/specs/brainstorm.md"), "utf8");
    expect(artifact).toContain("# Portable Workflow");
    for (const section of [
      "Goal",
      "Users",
      "Assumptions",
      "Hypotheses",
      "Constraints",
      "Risks",
      "Open Questions",
    ])
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
    expect(artifact).toContain("## Constraints");
    expect(artifact).toContain("## Open Questions");
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
    expect(artifact).toContain("## Risks and Dependencies");
    expect(artifact).toContain("## Completion Evidence");
    expect(artifact).toContain("Code: src/");
    expect(artifact).toContain("Tests: src/**/*.test.ts");
    expect(artifact).toContain("Link code changes, test results, and validation output");
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

  it("reports each requirement without linked validation coverage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "# Spec\n\nREQ-001\n\nREQ-002\n\nAcceptance criteria\n",
    );
    await writeFile(
      join(cwd, ".aiw/generated/plans/implementation-plan.md"),
      "# Plan\n\nREQ-001\n\nValidation: npm test\n",
    );
    const result = await run(["verify"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Untested requirements: REQ-002");
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
    expect(trace).toContain("decisions:");
    expect(trace).toContain("code:");
    expect(trace).toContain("tests:");
    expect(trace).toContain("evidence:");
    expect(trace).toContain("npm run check");

    const query = await run(["trace", "--requirement=REQ-001"], cwd);
    expect(query.exitCode).toBe(0);
    expect(query.output).toContain("requirement: REQ-001");
    expect((await run(["trace", "--requirement=REQ-999"], cwd)).error).toContain(
      "Requirement not found: REQ-999",
    );
  });

  it("blocks SDD progression until the previous artifact exists", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["gate", "plan"], cwd)).error).toContain("Quality gate blocked");
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "REQ-001\nAcceptance criteria\nGiven a project\nWhen planned\nThen it is testable\n",
    );
    expect((await run(["gate", "plan"], cwd)).output).toContain("Quality gate passed");
    expect((await run(["gate", "unknown"], cwd)).error).toContain("Usage");
  });

  it("blocks existing but incomplete SDD artifacts with actionable feedback", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["brainstorm"], cwd);
    const result = await run(["gate", "specification"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Brainstorm section Goal must contain content");
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

  it("resolves a package from a local provider source", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packageRoot = join(cwd, "local-package");
    await mkdir(join(packageRoot, "skills/example"), { recursive: true });
    await writeFile(join(packageRoot, "skills/example/SKILL.md"), "# Example\n");
    await writeFile(
      join(packageRoot, "package.yaml"),
      "schema: 1\nid: example/local\nversion: 1.0.0\nprovider: placeholder\nsource: placeholder\ndependencies: []\npermissions: []\nprovenance:\n  source: placeholder\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );
    const result = await run(["resolve", "--source=./local-package"], cwd);
    expect(result.exitCode).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("provider: local");
    expect(lock).toContain(`source: ${packageRoot}`);
  });

  it("audits package permissions and rejects unknown permissions atomically", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packagePath = join(cwd, "package.yaml");
    const contract = (permissions: string): string =>
      `schema: 1\nid: example/audited\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: [${permissions}]\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skill.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
    await writeFile(packagePath, contract("filesystem:read, process:execute"));
    const audit = await run(["audit-package", "--package=package.yaml"], cwd);
    expect(audit.output).toContain("filesystem:read (low)");
    expect(audit.output).toContain("process:execute (critical)");
    const lockPath = join(cwd, ".aiw/lock.yml");
    const before = await readFile(lockPath, "utf8");
    await writeFile(packagePath, contract("system:root"));
    const rejected = await run(["resolve", "--package=package.yaml", "--allow=system:root"], cwd);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.error).toContain("Unknown package permissions: system:root");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(before);
  });

  it("enforces organization-approved package sources before external execution", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const policyPath = join(cwd, "organization.yml");
    await writeFile(
      policyPath,
      "schema: 1\nname: Example Org\napproved_sources: [vercel-skills:approved/*, local:./approved/*]\ndenied_permissions: [process:execute]\n",
    );
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).output).toContain(
      "Example Org",
    );
    const persisted = await readFile(join(cwd, ".aiw/organization.yml"), "utf8");
    let calls = 0;
    const blocked = await run(
      [
        "skills",
        "install",
        "--source=untrusted/repository",
        "--skill=unsafe",
        "--allow=network:external",
      ],
      cwd,
      {
        externalSkills: {
          execute: async (): Promise<{ stdout: string; exitCode: number }> => {
            calls += 1;
            return { stdout: "installed", exitCode: 0 };
          },
        },
      },
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("not approved by Example Org");
    expect(calls).toBe(0);
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).error).toContain(
      "--replace",
    );
    await expect(readFile(join(cwd, ".aiw/organization.yml"), "utf8")).resolves.toBe(persisted);
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

  it("searches, inspects, installs, and updates Vercel skills through AIW", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const calls: string[][] = [];
    const services = {
      externalSkills: {
        execute: async (command: string[]): Promise<{ stdout: string; exitCode: number }> => {
          calls.push(command);
          return { stdout: command.includes("find") ? "react result" : "completed", exitCode: 0 };
        },
      },
    };
    expect((await run(["skills", "search", "--query=react"], cwd, services)).output).toBe(
      "react result",
    );
    expect(
      (await run(["skills", "inspect", "--source=vercel-labs/agent-skills"], cwd, services))
        .exitCode,
    ).toBe(0);
    await writeFile(
      join(cwd, "skills-lock.json"),
      '{"skills":{"react-best-practices":{"computedHash":"hash-v1"}}}',
    );
    const installed = await run(
      [
        "skills",
        "install",
        "--source=vercel-labs/agent-skills",
        "--skill=react-best-practices",
        "--allow=network:external",
      ],
      cwd,
      services,
    );
    expect(installed.exitCode).toBe(0);
    await expect(readFile(join(cwd, ".aiw/lock.yml"), "utf8")).resolves.toContain(
      "integrity: hash-v1",
    );
    await writeFile(
      join(cwd, "skills-lock.json"),
      '{"skills":{"react-best-practices":{"computedHash":"hash-v2"}}}',
    );
    expect(
      (await run(["skills", "update", "--allow=network:external"], cwd, services)).exitCode,
    ).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("provider: vercel-skills");
    expect(lock).toContain("integrity: hash-v2");
    expect(calls).toContainEqual(["npx", "skills", "find", "react"]);
    expect(calls).toContainEqual(["npx", "skills", "add", "vercel-labs/agent-skills", "--list"]);
    expect(calls).toContainEqual(["npx", "skills", "update"]);
  });

  it("rejects unknown Vercel skill approvals before executing or changing state", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const lockPath = join(cwd, ".aiw/lock.yml");
    const before = await readFile(lockPath, "utf8");
    let calls = 0;
    const result = await run(["skills", "update", "--allow=network:external,system:root"], cwd, {
      externalSkills: {
        execute: async (): Promise<{ stdout: string; exitCode: number }> => {
          calls += 1;
          return { stdout: "updated", exitCode: 0 };
        },
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Unknown package permissions: system:root");
    expect(calls).toBe(0);
    await expect(readFile(lockPath, "utf8")).resolves.toBe(before);
  });

  it("reports actionable diagnostics with doctor", async () => {
    const cwd = await project();
    expect((await run(["doctor"], cwd)).error).toContain("Missing AI Workflow files");
    await run(["install"], cwd);
    expect((await run(["doctor"], cwd)).output).toContain("health check passed");
  });

  it("reports an unsupported manifest target through doctor", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw/manifest.yml"),
      "schema: 1\nproject:\n  name: demo\ntarget:\n  active: unknown\npolicies:\n  artifact_language: en\n",
    );
    const result = await run(["doctor"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("unsupported");
  });

  it("reports invalid manifest state through status", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(join(cwd, ".aiw/manifest.yml"), "schema: 2\n");
    const result = await run(["status"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("schema");
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

  it("does not remove unrelated project files during uninstall", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const userFile = join(cwd, ".aiw", "generated", "docs", "user.md");
    await writeFile(userFile, "user content\n");
    await run(["uninstall"], cwd);
    await expect(readFile(userFile, "utf8")).resolves.toBe("user content\n");
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
