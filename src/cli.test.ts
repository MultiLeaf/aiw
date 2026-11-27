import { describe, expect, it } from "vitest";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./cli.js";
import { nodeFileSystem } from "./files.js";
import { runCommand } from "./workflow.js";
import type { FileSystem } from "./types.js";
import type { DashboardHandle } from "./dashboard.js";
import { parseOwnership } from "./ownership.js";
import { project, syncCapabilities, syncWithApproval } from "./fixtures/cli-test-helpers.js";

describe("AI Workflow CLI", () => {
  it("previews and executes an orchestration plan through injected agent adapters", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "orchestration.yml"),
      `schema: 1
id: cli-integration
tasks:
  - id: TASK-001
    agent: codex
    prompt: "Implement the change."
    depends_on: []
  - id: TASK-002
    agent: claude
    prompt: "Review the implementation."
    depends_on: [TASK-001]
`,
    );
    let calls = 0;
    const services = {
      orchestrator: {
        run: async (): Promise<{ success: boolean; detail: string }> => {
          calls += 1;
          return { success: true, detail: "complete" };
        },
      },
    };

    expect(
      (await run(["orchestrate", "--plan=orchestration.yml"], cwd, services)).output,
    ).toContain("tasks: [TASK-001]");
    expect(calls).toBe(0);
    expect(
      (
        await run(
          ["orchestrate", "--plan=orchestration.yml", "--execute", "--max-parallel=2"],
          cwd,
          services,
        )
      ).exitCode,
    ).toBe(0);
    expect(calls).toBe(2);
    await expect(
      readFile(join(cwd, ".aiw/checkpoints/orchestration-cli-integration.yml"), "utf8"),
    ).resolves.toContain("status: passed");
  });

  it("installs only ai-init and the neutral project structure", async () => {
    const cwd = await project();
    const result = await run(["install", "--target", "codex"], cwd);

    expect(result.exitCode).toBe(0);
    await expect(stat(join(cwd, ".aiw", "manifest.yml"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/brainstorming/SKILL.md"))).rejects.toThrow();
    await expect(stat(join(cwd, ".agents/agents"))).rejects.toThrow();
    await expect(stat(join(cwd, ".agents/rules"))).rejects.toThrow();
    await expect(stat(join(cwd, ".agents/hooks"))).rejects.toThrow();
    await expect(stat(join(cwd, ".context/adrs/INDEX.md"))).resolves.toBeTruthy();
    const aiInit = await readFile(join(cwd, ".agents/skills/ai-init/SKILL.md"), "utf8");
    for (const command of [
      "scan",
      "recommend",
      "recommend --select=all",
      "recommend --select=",
      "sync",
      "gate brainstorming",
      "gate specification",
      "gate plan",
      "gate verification",
      "verify",
      "trace",
    ])
      expect(aiInit).toContain(`npx --yes --package=@multileaf/ai-workflow -- aiw ${command}`);
    expect(aiInit).toContain("Install only confirmed selected resources and declared dependencies");
    expect(aiInit).toContain("Present recommendations as concise tables grouped by category");
    expect(aiInit).toContain("short project-specific reason for the recommendation");
    expect(aiInit).toContain("Do not show a flat list without category headings");
    expect(aiInit).toContain("Mandatory interaction checkpoints");
    expect(aiInit).toContain(
      "Do not continue, call tools, run commands, or change files while a widget is awaiting submission",
    );
    expect(aiInit).toContain(
      "Do not launch analysis agents or run `aiw scan` until the widget returns",
    );
    expect(aiInit).toContain("I switched; continue");
    expect(aiInit).toContain("widget must start with no choice selected");
    expect(aiInit).toContain(
      "Before syncing a non-empty selection, show the exact selected resources",
    );
    expect(aiInit).toContain("Run sync only after that confirmation arrives");
    expect(aiInit).toContain("Mandatory human gates between stages");
    expect(aiInit).toContain("a passing result is not human approval");
    expect(aiInit).toContain("Do not invoke the next skill, create its scaffold");
    expect(aiInit).toContain("All generated AI Workflow artifacts must be written in English");
    expect(result.output).toContain("only the ai-init skill");
  });

  it("recommends and syncs only selected project capabilities into the active target", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run", lint: "eslint ." },
        devDependencies: { typescript: "latest", vitest: "latest", eslint: "latest" },
      }),
    );
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src/main.ts"), "export {}\n");

    const recommendation = await run(
      ["recommend", "--select=brainstorming,tdd-development,typescript-quality"],
      cwd,
    );
    expect(recommendation.exitCode).toBe(0);
    expect(recommendation.output).toContain("recommendations generated");
    const sync = await syncWithApproval(cwd);

    expect(sync.exitCode).toBe(0);
    await expect(stat(join(cwd, ".agents/skills/brainstorming/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/tdd-development/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/rules/tdd-policy/tdd-policy.md"))).resolves.toBeTruthy();
    await expect(
      readFile(join(cwd, ".agents/rules/tdd-policy/tdd-policy.md"), "utf8"),
    ).resolves.toContain("Test command: `vitest run`");
    await expect(
      stat(join(cwd, ".agents/agents/test-engineer/test-engineer.md")),
    ).resolves.toBeTruthy();
    await expect(
      readFile(join(cwd, ".agents/rules/project-quality/project-quality.md"), "utf8"),
    ).resolves.toContain("eslint .");
    await expect(stat(join(cwd, ".agents/skills/security-review/SKILL.md"))).rejects.toThrow();
  });

  it("syncs an individual custom resource selection instead of its whole capability bundle", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "latest" } }),
    );
    await run(["scan"], cwd);
    const profilePath = join(cwd, ".aiw/profile.yml");
    const profile = await readFile(profilePath, "utf8");
    await writeFile(
      profilePath,
      profile.replace(
        "project_modules: []",
        'project_modules: [{"path":".","architecture":["modular backend"],"patterns":["controller-service"],"evidence":["apps/api/src/modules"]}]',
      ),
    );
    await run(["recommend"], cwd);

    const selection = await run(
      ["recommend", "--select=skills/verification,rules/tdd-policy,agents/test-engineer"],
      cwd,
    );
    expect(selection.exitCode).toBe(0);
    const recommendations = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(recommendations).toContain("selected_resources: [skills/verification]");
    expect(recommendations).toContain(
      "selected_resources: [rules/tdd-policy, agents/test-engineer]",
    );

    const sync = await syncWithApproval(cwd);
    expect(sync.exitCode).toBe(0);
    await expect(stat(join(cwd, ".agents/skills/verification/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/rules/tdd-policy/tdd-policy.md"))).resolves.toBeTruthy();
    await expect(
      stat(join(cwd, ".agents/agents/test-engineer/test-engineer.md")),
    ).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/tdd-development/SKILL.md"))).rejects.toThrow();
    await expect(stat(join(cwd, ".agents/rules/tdd-policy/tdd-policy.md"))).resolves.toBeTruthy();
    await expect(
      readFile(join(cwd, ".agents/rules/tdd-policy/tdd-policy.md"), "utf8"),
    ).resolves.toContain("patterns: controller-service");
  });

  it.each([
    ["codex", ".agents/skills/brainstorming/SKILL.md"],
    ["claude", ".claude/skills/brainstorming/SKILL.md"],
    ["cursor", ".cursor/skills/brainstorming/SKILL.md"],
    ["gemini", ".gemini/skills/brainstorming/SKILL.md"],
    ["copilot", ".github/skills/brainstorming/SKILL.md"],
    ["universal", ".aiw/resources/skills/brainstorming/SKILL.md"],
  ] as const)("syncs selected bundled resources through the %s adapter", async (target, path) => {
    const cwd = await project();
    await run(["install", "--target", target], cwd);
    await syncCapabilities(cwd, ["brainstorming"]);

    await expect(stat(join(cwd, path))).resolves.toBeTruthy();
    await expect(
      stat(join(cwd, ".aiw/resources/skills/brainstorming/SKILL.md")),
    ).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/security-review/SKILL.md"))).rejects.toThrow();
  });

  it.each(["existing", "dangling"] as const)(
    "rejects a %s symlink in an install destination before writing outside the project",
    async (linkTarget) => {
      const cwd = await project();
      const outside = `${cwd}-outside`;
      if (linkTarget === "existing") await mkdir(outside);
      await symlink(outside, join(cwd, ".agents"), "dir");

      const result = await run(["install", "--target", "codex"], cwd);

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("symbolic link");
      await expect(stat(join(cwd, ".aiw/manifest.yml"))).rejects.toThrow();
      if (linkTarget === "existing") await expect(readdir(outside)).resolves.toEqual([]);
      else await expect(stat(outside)).rejects.toThrow();
      await rm(outside, { recursive: true, force: true });
    },
  );

  it("rolls back files and directories after a first-install write fails, then permits retry", async () => {
    const cwd = await project();
    let writeCount = 0;
    const failingFs: FileSystem = {
      ...nodeFileSystem,
      createExclusive: (path, content) => {
        writeCount += 1;
        if (writeCount === 3) throw new Error("injected install write failure");
        return nodeFileSystem.createExclusive?.(path, content) ?? false;
      },
    };

    const failed = await runCommand(["install", "--target", "codex"], cwd, failingFs);

    expect(failed.exitCode).toBe(1);
    expect(failed.error).toContain("injected install write failure");
    await expect(readdir(cwd)).resolves.toEqual([]);
    const retry = await run(["install", "--target", "codex"], cwd);
    expect(retry.exitCode).toBe(0);
    await expect(stat(join(cwd, ".aiw/manifest.yml"))).resolves.toBeTruthy();
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

  it("leaves an existing optional resource alone during bootstrap install", async () => {
    const cwd = await project();
    const resource = join(cwd, ".agents/skills/brainstorming/SKILL.md");
    await mkdir(join(cwd, ".agents/skills/brainstorming"), { recursive: true });
    await writeFile(resource, "my custom brainstorming workflow\n");

    const result = await run(["install", "--target", "codex"], cwd);

    expect(result.exitCode).toBe(0);
    await expect(readFile(resource, "utf8")).resolves.toBe("my custom brainstorming workflow\n");
    await expect(stat(join(cwd, ".aiw/manifest.yml"))).resolves.toBeTruthy();
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
    expect(skill).toContain(
      target === "copilot" ? "# AI Workflow Initialization" : "name: ai-init",
    );
    expect(skill).toContain("This skill is the bootstrap for AI Workflow");
    expect(skill).toContain("All generated AI Workflow artifacts must be written in English");
    const ownedPaths = parseOwnership(await readFile(join(cwd, ".aiw/ownership.yml"), "utf8")).map(
      ({ path }) => path,
    );
    expect(ownedPaths).toContain(path);
    expect(
      ownedPaths.some((owned) =>
        /\/(?:brainstorming|requirements-specification|tdd-development)\//.test(owned),
      ),
    ).toBe(false);
    expect((await run(["uninstall"], cwd)).exitCode).toBe(0);
    await expect(stat(join(cwd, path))).rejects.toThrow();
    await expect(stat(join(cwd, ".aiw/manifest.yml"))).rejects.toThrow();
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
    await expect(readFile(join(cwd, ".aiw/settings.yml"), "utf8")).resolves.toContain(
      "value: pnpm",
    );
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".claude/skills/ai-init/SKILL.md"))).rejects.toThrow();
  });

  it("keeps telemetry disabled until explicit opt-in and applies privacy controls", async () => {
    const cwd = await project();
    const events: unknown[] = [];
    const services = {
      telemetry: {
        record: async (event: unknown): Promise<void> => void events.push(event),
      },
    };
    await run(["install", "--target", "codex"], cwd, services);
    expect((await run(["telemetry", "status"], cwd, services)).output).toContain(
      "Telemetry is disabled",
    );
    expect(events).toEqual([]);

    expect(
      (
        await run(
          ["telemetry", "enable", "--commands=exclude", "--outcomes=include"],
          cwd,
          services,
        )
      ).exitCode,
    ).toBe(0);
    expect(events).toEqual([{ schema: 1, outcome: "success" }]);
    await run(["unknown-command", "--token=must-not-leak"], cwd, services);
    expect(events.at(-1)).toEqual({ schema: 1, outcome: "success" });

    await run(["telemetry", "disable"], cwd, services);
    const countAfterDisable = events.length;
    await run(["status"], cwd, services);
    expect(events).toHaveLength(countAfterDisable);
  });

  it("does not let telemetry failures affect command results", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["telemetry", "enable"], cwd);
    const result = await run(["status"], cwd, {
      telemetry: {
        record: async () => {
          throw new Error("collector unavailable");
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("schema: 1");
  });

  it("diagnoses and uninstalls malformed or owned telemetry preferences", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(join(cwd, ".aiw/telemetry.yml"), "schema: 2\nenabled: true\n");
    expect((await run(["doctor"], cwd)).error).toContain("Telemetry schema");
    expect((await run(["uninstall", "--dry-run"], cwd)).output).toContain("telemetry.yml");
    await run(["uninstall"], cwd);
    await expect(stat(join(cwd, ".aiw/telemetry.yml"))).rejects.toThrow();
  });

  it.each([
    ["telemetry"],
    ["telemetry", "status", "extra"],
    ["telemetry", "disable", "extra"],
    ["telemetry", "enable", "--commands"],
    ["telemetry", "enable", "--unknown=exclude"],
    ["telemetry", "enable", "--commands=include=secret"],
    ["telemetry", "enable", "--commands=include", "--commands=exclude"],
  ])("rejects invalid telemetry arguments without changing preferences: %j", async (...args) => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["telemetry", "enable", "--commands=exclude", "--outcomes=exclude"], cwd);
    const path = join(cwd, ".aiw/settings.yml");
    const before = await readFile(path, "utf8");
    const result = await run(args, cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Usage: aiw telemetry");
    await expect(readFile(path, "utf8")).resolves.toBe(before);
  });

  it("does not emit telemetry for rejected telemetry administration commands", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["telemetry", "enable"], cwd);
    const events: unknown[] = [];
    const result = await run(["telemetry", "enable", "--commands"], cwd, {
      telemetry: {
        record: async (event: unknown): Promise<void> => void events.push(event),
      },
    });
    expect(result.exitCode).toBe(1);
    expect(events).toEqual([]);
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

  it("creates and validates a plugin package through the CLI", async () => {
    const cwd = await project();
    const created = await run(
      [
        "plugin",
        "create",
        "--directory=plugins/example",
        "--id=acme/example",
        "--version=1.0.0",
        "--description=Provide an example workflow.",
      ],
      cwd,
    );
    expect(created.exitCode).toBe(0);
    const manifest = join(cwd, "plugins/example/package.yaml");
    await expect(readFile(manifest, "utf8")).resolves.toContain("id: acme/example");
    expect((await run(["plugin", "validate", "--directory=plugins/example"], cwd)).output).toBe(
      "Plugin package is valid: acme/example@1.0.0",
    );
    const before = await readFile(manifest, "utf8");
    expect(
      (
        await run(
          [
            "plugin",
            "create",
            "--directory=plugins/example",
            "--id=acme/example",
            "--version=1.0.0",
            "--description=Replacement.",
          ],
          cwd,
        )
      ).exitCode,
    ).toBe(1);
    await expect(readFile(manifest, "utf8")).resolves.toBe(before);
  });

  it("starts the local dashboard through an injected service", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const starts: Array<{ root: string; port: number }> = [];
    const result = await run(["ui", "--port=4173"], cwd, {
      dashboard: {
        start: async (root, port): Promise<DashboardHandle> => {
          starts.push({ root, port });
          return { url: "http://127.0.0.1:4173", close: async () => undefined };
        },
      },
    });
    expect(result).toEqual({
      exitCode: 0,
      output: "AI Workflow dashboard: http://127.0.0.1:4173",
    });
    expect(starts).toEqual([{ root: cwd, port: 4173 }]);
    expect((await run(["ui", "--port=65536"], cwd)).exitCode).toBe(1);
  });

  it("rejects unsafe or malformed plugin authoring arguments atomically", async () => {
    const cwd = await project();
    for (const args of [
      [
        "plugin",
        "create",
        "--directory=../outside",
        "--id=acme/example",
        "--version=1.0.0",
        "--description=Example.",
      ],
      [
        "plugin",
        "create",
        "--directory=plugins/example",
        "--id=INVALID",
        "--version=1.0.0",
        "--description=Example.",
      ],
      [
        "plugin",
        "create",
        "--directory=plugins/example",
        "--id=acme/example",
        "--version=latest",
        "--description=Example.",
      ],
      [
        "plugin",
        "create",
        "--directory=plugins/example",
        "--id=acme/example",
        "--version=1.0.0",
        "--description=Example.",
        "--unknown=value",
      ],
    ]) {
      expect((await run(args, cwd)).exitCode).toBe(1);
    }
    await expect(stat(join(cwd, "plugins/example/package.yaml"))).rejects.toThrow();
  });

  it("blocks plugin symlink escapes and obstructed ancestors before writing", async () => {
    const cwd = await project();
    const outside = await project();
    await symlink(outside, join(cwd, "plugins"));
    const args = [
      "plugin",
      "create",
      "--directory=plugins/example",
      "--id=acme/example",
      "--version=1.0.0",
      "--description=Example.",
    ];
    expect((await run(args, cwd)).exitCode).toBe(1);
    expect(await readdir(outside)).toEqual([]);

    const obstructed = await project();
    await mkdir(join(obstructed, "plugins/example"), { recursive: true });
    await writeFile(join(obstructed, "plugins/example/skills"), "obstruction");
    expect((await run(args, obstructed)).exitCode).toBe(1);
    await expect(stat(join(obstructed, "plugins/example/package.yaml"))).rejects.toThrow();

    const dangling = await project();
    await mkdir(join(dangling, "plugins/example"), { recursive: true });
    await symlink(join(outside, "created.yaml"), join(dangling, "plugins/example/package.yaml"));
    expect((await run(args, dangling)).exitCode).toBe(1);
    await expect(stat(join(outside, "created.yaml"))).rejects.toThrow();
  });

  it("strictly validates plugin identity, versions, syntax, and confined resource files", async () => {
    const cwd = await project();
    const create = [
      "plugin",
      "create",
      "--directory=plugins/example",
      "--id=acme/example",
      "--version=1.0.0",
      "--description=Example.",
    ];
    await run(create, cwd);
    const manifestPath = join(cwd, "plugins/example/package.yaml");
    const original = await readFile(manifestPath, "utf8");
    for (const malformed of [
      original.replace("id: acme/example", "id:"),
      original.replace("id: acme/example", "id: ACME/Example"),
      original.replaceAll("version: 1.0.0", "version: 1.0"),
      original.replace("id: acme/example", "id: acme/example\nid: other/plugin"),
      `${original}broken: [\n`,
      original.replace("dependencies: []", "dependencies: [\n"),
      original.replace("skills/example/SKILL.md", "../outside.md"),
    ]) {
      await writeFile(manifestPath, malformed);
      expect((await run(["plugin", "validate", "--directory=plugins/example"], cwd)).exitCode).toBe(
        1,
      );
    }
  });

  it("skips the telemetry prompt on non-interactive installs", async () => {
    const cwd = await project();
    const result = await run(["install"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("Telemetry");
    expect(existsSync(join(cwd, ".aiw", "settings.yml"))).toBe(false);
  });

  it("shows buffered events with telemetry status --verbose and purges on disable", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, ".aiw"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "telemetry-buffer.jsonl"),
      '{"schema":1,"command":"scan","outcome":"success"}\n{"schema":1,"command":"doctor","outcome":"failure"}\n',
    );
    const verbose = await run(["telemetry", "status", "--verbose"], cwd);
    expect(verbose.exitCode).toBe(0);
    expect(verbose.output).toContain("Local buffer: 2 events");
    expect(verbose.output).toContain('{"schema":1,"command":"scan","outcome":"success"}');
    expect(verbose.output).toContain('{"schema":1,"command":"doctor","outcome":"failure"}');
    const plain = await run(["telemetry", "status"], cwd);
    expect(plain.output).not.toContain("Local buffer");
    const disabled = await run(["telemetry", "disable"], cwd);
    expect(disabled.exitCode).toBe(0);
    expect(disabled.output).toContain("Telemetry disabled.");
    expect(existsSync(join(cwd, ".aiw", "telemetry-buffer.jsonl"))).toBe(false);
    const purged = await run(["telemetry", "status", "--verbose"], cwd);
    expect(purged.output).toContain("Local buffer: 0 events");
  });
});

describe("root context rendering", () => {
  it("renders the generated context to the target root file during sync and migrates it", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run", lint: "eslint ." },
        devDependencies: { vitest: "1", eslint: "1", typescript: "1" },
      }),
    );
    await run(["scan"], cwd);
    await run(["recommend", "--select=brainstorming"], cwd);
    const preview = await run(["sync", "--preview"], cwd);
    const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
    expect(fingerprint).toBeTruthy();
    const applied = await run(["sync", `--approve-plan=${fingerprint}`], cwd);
    expect(applied.exitCode).toBe(0);
    const agents = await readFile(join(cwd, "AGENTS.md"), "utf8");
    expect(agents).toContain("AI Workflow Project Context");
    expect(agents).toContain("Lint: `eslint .`");
    expect(agents).toContain(".aiw/profile.yml");

    const migrated = await run(["target", "claude"], cwd);
    expect(migrated.exitCode).toBe(0);
    const claude = await readFile(join(cwd, "CLAUDE.md"), "utf8");
    expect(claude).toContain("AI Workflow Project Context");
    await expect(stat(join(cwd, "AGENTS.md"))).rejects.toThrow();
  });

  it("reports a conflict instead of overwriting an existing root context file", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "1" } }),
    );
    await writeFile(join(cwd, "AGENTS.md"), "# Hand-written instructions\n");
    await run(["scan"], cwd);
    await run(["recommend", "--select=brainstorming"], cwd);
    const preview = await run(["sync", "--preview"], cwd);
    expect(preview.exitCode).toBe(0);
    const conflicts = JSON.parse(preview.output ?? "{}").plan.conflicts as string[];
    expect(conflicts).toContain("AGENTS.md");
    const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
    const blocked = await run(["sync", `--approve-plan=${fingerprint}`], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("AGENTS.md");
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe("# Hand-written instructions\n");
  });
});

describe("telemetry show", () => {
  it("summarizes buffered events by command with outcomes", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, ".aiw"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "telemetry-buffer.jsonl"),
      '{"schema":1,"command":"scan","outcome":"success"}\n{"schema":1,"command":"scan","outcome":"failure"}\n{"schema":1,"command":"doctor","outcome":"success"}\n',
    );
    const summary = await run(["telemetry", "show"], cwd);
    expect(summary.exitCode).toBe(0);
    expect(summary.output).toContain("Buffered events: 3/200");
    expect(summary.output).toContain("- doctor: 1 success, 0 failure");
    expect(summary.output).toContain("- scan: 1 success, 1 failure");
    expect(summary.output).not.toContain('"schema":1');
    const detailed = await run(["telemetry", "show", "--verbose"], cwd);
    expect(detailed.output).toContain('{"schema":1,"command":"scan","outcome":"success"}');
  });

  it("reports an empty buffer without a command table", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const result = await run(["telemetry", "show"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Buffered events: 0/200");
    expect(result.output).not.toContain("By command:");
  });
});
