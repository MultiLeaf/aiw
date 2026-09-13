import { describe, expect, it } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./cli.js";
import { nodeFileSystem } from "./files.js";
import { runCommand } from "./workflow.js";
import type { FileSystem } from "./types.js";
import type { Interpreter } from "./interpreter.js";
import { checksumPackage } from "./package-integrity.js";
import { parseOwnership } from "./ownership.js";
import { parseProjectProfile } from "./profile.js";
import type { DashboardHandle } from "./dashboard.js";
import type { LoadedPackageSource } from "./providers.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-test-"));
}

async function syncCapabilities(cwd: string, ids: string[]): Promise<void> {
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "latest" } }),
  );
  const recommendation = await run(["recommend", `--select=${ids.join(",")}`], cwd);
  expect(recommendation.exitCode).toBe(0);
  const result = await syncWithApproval(cwd);
  expect(result.exitCode).toBe(0);
}

async function syncWithApproval(
  cwd: string,
  options: string[] = [],
  services?: Parameters<typeof run>[2],
): Promise<Awaited<ReturnType<typeof run>>> {
  const preview = await run(["sync", "--preview", ...options], cwd, services);
  const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
  if (!fingerprint)
    return { exitCode: 1, error: preview.error ?? "Sync preview did not produce a fingerprint." };
  return run(["sync", `--approve-plan=${fingerprint}`, ...options], cwd, services);
}

async function advanceWorkflowTo(cwd: string, target: string): Promise<void> {
  const stages = [
    "brainstorming",
    "specification",
    "technical-design",
    "plan",
    "implementation",
    "verification",
    "review",
    "traceability",
  ];
  const targetIndex = stages.indexOf(target);
  if (targetIndex < 0) throw new Error(`Unknown test workflow stage: ${target}`);
  await run(["workflow", "start", "--id=test-workflow"], cwd);
  for (const stage of stages.slice(0, targetIndex)) {
    if (stage === "brainstorming" || stage === "technical-design") {
      await run(["skip", stage, "--reason=Not needed by this test"], cwd);
      continue;
    }
    if (stage === "specification") {
      await run(["spec"], cwd);
      await writeFile(
        join(cwd, ".aiw/generated/specs/specification.md"),
        "## Requirements\nREQ-001\n## Acceptance criteria\nGiven a user\nWhen they act\nThen it works\n",
      );
    } else if (stage === "plan") {
      await run(["plan"], cwd);
      await writeFile(
        join(cwd, ".aiw/generated/plans/implementation-plan.md"),
        "TASK-001\nRequirement: REQ-001\nCode: src/main.ts\nTests: src/main.test.ts\nValidation: npm test\nEvidence: test output\n",
      );
    } else if (stage === "implementation") {
      await mkdir(join(cwd, ".aiw/generated/reports"), { recursive: true });
      await writeFile(
        join(cwd, ".aiw/generated/reports/implementation-report.md"),
        "## Changed Files\nsrc/main.ts\n## Tests\nmain.test.ts\n## Validation\nnpm test\n## Deviations\nNone\n",
      );
    } else if (stage === "verification") {
      await writeFile(
        join(cwd, ".aiw/generated/reports/verification-report.md"),
        "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
      );
    } else if (stage === "review") {
      await writeFile(
        join(cwd, ".aiw/generated/reports/code-review.md"),
        "## Scope\nFeature\n## Findings\nNone\n## Checks\nTests reviewed\n## Residual Risks\nNone\n## Decision\nAccept\n",
      );
    } else if (stage === "traceability") {
      await run(["trace"], cwd);
    }
    const gate = await run(["gate", stage], cwd);
    if (gate.exitCode !== 0) throw new Error(gate.error ?? `Gate failed: ${stage}`);
    const approval = await run(["approve", stage], cwd);
    if (approval.exitCode !== 0) throw new Error(approval.error ?? `Approval failed: ${stage}`);
  }
}

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
    await expect(readFile(join(cwd, ".aiw/overrides.yml"), "utf8")).resolves.toContain(
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
    const path = join(cwd, ".aiw/telemetry.yml");
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

  it("uses a changed neutral ai-init as source when migrating to universal", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const neutral = join(cwd, ".aiw/resources/skills/ai-init.md");
    await mkdir(join(cwd, ".aiw/resources/skills"), { recursive: true });
    await writeFile(neutral, "# Conflicting neutral content\n");
    const result = await run(["target", "universal"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Target changed to universal");
    await expect(readFile(neutral, "utf8")).resolves.toBe("# Conflicting neutral content\n");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: universal",
    );
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).rejects.toThrow();
  });

  it("blocks malformed neutral inputs before writing any target resources", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    const unsupported = join(cwd, ".aiw/resources/skills/broken/notes.md");
    const malformed = join(cwd, ".aiw/resources/rules/broken/broken.md");
    await mkdir(join(unsupported, ".."), { recursive: true });
    await mkdir(join(malformed, ".."), { recursive: true });
    await writeFile(unsupported, "unsupported private-token-value\n");
    await writeFile(malformed, "malformed private-token-value\n");
    const preview = await run(["target", "claude", "--dry-run"], cwd);
    expect(preview.exitCode).toBe(1);
    expect(preview.output).toContain("invalid: skills/broken/notes.md");
    expect(preview.output).toContain("invalid: rules/broken/broken.md");
    expect(preview.output).not.toContain("private-token-value");
    const result = await run(["target", "claude"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Migration blocked");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: universal",
    );
    await expect(stat(join(cwd, ".claude/skills/brainstorming/SKILL.md"))).rejects.toThrow();
  });

  it("blocks removal of modified old-target resources", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await syncCapabilities(cwd, ["brainstorming"]);
    const edited = join(cwd, ".agents/skills/brainstorming/SKILL.md");
    await writeFile(edited, "# User customization\n");
    const result = await run(["target", "claude"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("conflict: .agents/skills/brainstorming/SKILL.md");
    await expect(readFile(edited, "utf8")).resolves.toBe("# User customization\n");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: codex",
    );
    await expect(stat(join(cwd, ".claude/skills/brainstorming/SKILL.md"))).rejects.toThrow();
  });

  it.each([
    ["destination write", "write", ".claude/skills/brainstorming/SKILL.md"],
    ["ownership write", "write", ".aiw/ownership.yml"],
    ["manifest write", "write", ".aiw/manifest.yml"],
    ["obsolete resource removal", "remove", ".agents/skills/brainstorming/SKILL.md"],
  ] as const)("rolls back after an injected %s failure", async (_stage, operation, suffix) => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await syncCapabilities(cwd, ["brainstorming"]);
    const manifest = await readFile(join(cwd, ".aiw/manifest.yml"), "utf8");
    const ownership = await readFile(join(cwd, ".aiw/ownership.yml"), "utf8");
    let triggered = false;
    const matches = (path: string): boolean => path.replaceAll("\\", "/").endsWith(suffix);
    const failingFs: FileSystem = {
      ...nodeFileSystem,
      writeBytes(path, bytes): void {
        if (!triggered && operation === "write" && matches(path)) {
          triggered = true;
          throw new Error("injected migration mutation failure");
        }
        nodeFileSystem.writeBytes?.(path, bytes);
      },
      remove(path): void {
        if (!triggered && operation === "remove" && matches(path)) {
          triggered = true;
          throw new Error("injected migration mutation failure");
        }
        nodeFileSystem.remove?.(path);
      },
    };
    const result = await runCommand(["target", "claude"], cwd, failingFs);
    expect(triggered).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("injected migration mutation failure");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toBe(manifest);
    await expect(readFile(join(cwd, ".aiw/ownership.yml"), "utf8")).resolves.toBe(ownership);
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".claude/skills/brainstorming/SKILL.md"))).rejects.toThrow();
    await expect(stat(join(cwd, ".aiw/checkpoints/migration-backup.yml"))).rejects.toThrow();
  });

  it("renders all neutral resource categories when changing target", async () => {
    const cwd = await project();
    await run(["install", "--target", "universal"], cwd);
    await syncCapabilities(cwd, ["brainstorming"]);
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
      await writeFile(join(resources, source), `# ${source}\n\nMigration fixture.\n`);
    }
    const result = await run(["target", "claude"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("rendered");
    for (const [source, destination] of fixtures)
      await expect(readFile(join(cwd, destination), "utf8")).resolves.toBe(
        `# ${source}\n\nMigration fixture.\n`,
      );
    await expect(
      readFile(join(cwd, ".claude/skills/brainstorming/SKILL.md"), "utf8"),
    ).resolves.toContain("Brainstorming");
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
    const bytes = Buffer.from("# Binary Resource\r\n\r\nUTF-8 text: ñ\r\n", "utf8");
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
    expect(preview.output).toContain("keep: .aiw/resources/skills/ai-init.md (neutral source)");
    const { writeFile } = await import("node:fs/promises");
    await mkdir(join(cwd, ".cursor/skills/ai-init"), { recursive: true });
    await writeFile(join(cwd, ".cursor/skills/ai-init/SKILL.md"), "# Manual content\n");
    const result = await run(["target", "cursor"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Migration blocked");
  });

  it("preserves user changes to an unowned target file during rollback", async () => {
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
      "# Changed\n",
    );
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: universal",
    );
  });

  it("preserves edited migration paths while restoring untouched rollback paths", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const previous = join(cwd, ".agents/skills/ai-init/SKILL.md");
    const original = await readFile(previous, "utf8");
    const destination = join(cwd, ".claude/skills/ai-init/SKILL.md");
    expect((await run(["target", "claude"], cwd)).exitCode).toBe(0);
    await writeFile(destination, "# User changed destination\n");

    const result = await run(["rollback"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Migration rollback preserved modified/conflicting files");
    expect(result.error).toContain(".claude/skills/ai-init/SKILL.md");
    await expect(readFile(destination, "utf8")).resolves.toBe("# User changed destination\n");
    await expect(readFile(previous, "utf8")).resolves.toBe(original);
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toContain(
      "active: codex",
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

  it("keeps the migrated state and checkpoint if a rollback mutation fails", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    expect((await run(["target", "claude"], cwd)).exitCode).toBe(0);
    const backupPath = join(cwd, ".aiw/checkpoints/migration-backup.yml");
    const backup = await readFile(backupPath, "utf8");
    const manifest = await readFile(join(cwd, ".aiw/manifest.yml"), "utf8");
    const ownership = await readFile(join(cwd, ".aiw/ownership.yml"), "utf8");
    const claudeSkill = join(cwd, ".claude/skills/ai-init/SKILL.md");
    const codexSkill = join(cwd, ".agents/skills/ai-init/SKILL.md");
    const claudeContent = await readFile(claudeSkill, "utf8");
    let triggered = false;
    const failingFs: FileSystem = {
      ...nodeFileSystem,
      writeBytes(path, bytes): void {
        if (!triggered && path.replaceAll("\\", "/").endsWith(".agents/skills/ai-init/SKILL.md")) {
          triggered = true;
          throw new Error("injected rollback write failure");
        }
        nodeFileSystem.writeBytes?.(path, bytes);
      },
    };

    const failed = await runCommand(["rollback"], cwd, failingFs);

    expect(triggered).toBe(true);
    expect(failed.exitCode).toBe(1);
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toBe(manifest);
    await expect(readFile(join(cwd, ".aiw/ownership.yml"), "utf8")).resolves.toBe(ownership);
    await expect(readFile(backupPath, "utf8")).resolves.toBe(backup);
    await expect(readFile(claudeSkill, "utf8")).resolves.toBe(claudeContent);
    await expect(stat(codexSkill)).rejects.toThrow();

    expect((await run(["rollback"], cwd)).exitCode).toBe(0);
    await expect(readFile(codexSkill, "utf8")).resolves.toContain("aiw gate");
    await expect(stat(claudeSkill)).rejects.toThrow();
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
    await advanceWorkflowTo(cwd, "brainstorming");
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
    await advanceWorkflowTo(cwd, "brainstorming");
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
    await advanceWorkflowTo(cwd, "specification");
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
    await advanceWorkflowTo(cwd, "technical-design");
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
    await advanceWorkflowTo(cwd, "plan");
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

  it("requires an active approved workflow before verification", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["verify"], cwd)).error).toContain("No SDD workflow is active");
    await advanceWorkflowTo(cwd, "verification");
    const result = await run(["verify"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Verification passed");
  });

  it("blocks specification approval when acceptance criteria are incomplete", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "specification");
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "# Spec\n\nREQ-001\n\nREQ-002\n\nAcceptance criteria\n",
    );
    await writeFile(
      join(cwd, ".aiw/generated/plans/implementation-plan.md"),
      "# Plan\n\nREQ-001\n\nValidation: npm test\n",
    );
    const result = await run(["gate", "specification"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Given");
  });

  it("creates a queryable requirement traceability artifact", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "traceability");
    const result = await run(["trace"], cwd);
    expect(result.exitCode).toBe(0);
    const trace = await readFile(join(cwd, ".aiw/generated/artifacts/traceability.yml"), "utf8");
    expect(trace).toContain("requirement: REQ-001");
    expect(trace).toContain("tasks: [TASK-001]");
    expect(trace).toContain("decisions:");
    expect(trace).toContain("code:");
    expect(trace).toContain("tests:");
    expect(trace).toContain("evidence:");
    expect(trace).toContain("npm test");

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
    await advanceWorkflowTo(cwd, "plan");
    expect((await run(["gate", "plan"], cwd)).error).toContain("Quality gate blocked");
    await writeFile(
      join(cwd, ".aiw/generated/plans/implementation-plan.md"),
      "TASK-001\nRequirement: REQ-001\nCode: src/main.ts\nTests: src/main.test.ts\nValidation: npm test\nEvidence: test output\n",
    );
    expect((await run(["gate", "plan"], cwd)).output).toContain("Quality gate passed");
    expect((await run(["gate", "unknown"], cwd)).error).toContain("Usage");
    expect((await run(["gate", "toString"], cwd)).error).toContain("Usage");
  });

  it("persists workflow sessions and requires human approval before stage transitions", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    expect((await run(["spec"], cwd)).error).toContain("No SDD workflow is active");
    expect((await run(["workflow", "start", "--id=approval-test"], cwd)).exitCode).toBe(0);

    expect((await run(["spec"], cwd)).error).toContain("brainstorming");
    expect((await run(["skip", "brainstorming", "--reason=Not needed"], cwd)).exitCode).toBe(0);
    await run(["spec"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they start setup\nThen setup completes\n",
    );
    expect((await run(["gate", "specification"], cwd)).exitCode).toBe(0);
    expect((await run(["plan"], cwd)).error).toContain("specification");
    expect((await run(["approve", "specification"], cwd)).exitCode).toBe(0);
    await mkdir(join(cwd, ".aiw/generated/reports"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw/generated/reports/technical-design.md"),
      "## Context\nNeed\n## Proposed Design\nModule\n## Alternatives\nA or B\n## Interfaces\nAPI\n## Risks\nMigration\n## Validation\nTests\n",
    );
    expect((await run(["gate", "technical-design"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "technical-design"], cwd)).exitCode).toBe(0);
    expect((await run(["plan"], cwd)).exitCode).toBe(0);

    const status = await run(["workflow", "status"], cwd);
    expect(status.output).toContain("Workflow approval-test (active)");
    expect(status.output).toContain("Next action:");
    expect(status.output).toContain("specification: approved");
    expect((await run(["workflow", "complete"], cwd)).error).toContain("implementation");
  });

  it("invalidates downstream approvals when reviewed evidence changes", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=stale-test"], cwd);
    await run(["skip", "brainstorming", "--reason=Not needed"], cwd);
    await run(["spec"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they start setup\nThen setup completes\n",
    );
    await run(["gate", "specification"], cwd);
    const specification = join(cwd, ".aiw/generated/specs/specification.md");
    await writeFile(specification, `${await readFile(specification, "utf8")}Updated.\n`);
    expect((await run(["approve", "specification"], cwd)).error).toContain("changed after review");
    expect((await run(["workflow", "status"], cwd)).output).toContain("specification: stale");
  });

  it("completes every workflow stage only after its gate and explicit approval", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=full-stage-run"], cwd);

    expect((await run(["approve", "brainstorming"], cwd)).error).toContain(
      "Approval evidence is missing",
    );
    await run(["brainstorm"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/brainstorm.md"),
      "## Goal\nDeliver the feature\n## Users\nProject users\n## Constraints\nExisting APIs\n## Risks\nRegression\n## Non-goals\nUnrelated work\n",
    );
    expect((await run(["gate", "brainstorming"], cwd)).exitCode).toBe(0);
    expect((await run(["spec"], cwd)).error).toContain("awaiting human approval");
    expect((await run(["approve", "brainstorming"], cwd)).exitCode).toBe(0);

    await run(["spec"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen the feature works\n",
    );
    expect((await run(["gate", "specification"], cwd)).exitCode).toBe(0);
    expect((await run(["plan"], cwd)).error).toContain("specification");
    expect((await run(["approve", "specification"], cwd)).exitCode).toBe(0);

    await mkdir(join(cwd, ".aiw/generated/reports"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw/generated/reports/technical-design.md"),
      "## Context\nRequirement context\n## Proposed Design\nA modular implementation\n## Alternatives\nAlternative A\n## Interfaces\nStable API\n## Risks\nRegression risk\n## Validation\nAutomated tests\n",
    );
    expect((await run(["gate", "technical-design"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "technical-design"], cwd)).exitCode).toBe(0);

    await run(["plan"], cwd);
    expect((await run(["gate", "plan"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "plan"], cwd)).exitCode).toBe(0);
    await writeFile(
      join(cwd, ".aiw/generated/reports/implementation-report.md"),
      "## Changed Files\nsrc/feature.ts\n## Tests\nsrc/feature.test.ts\n## Validation\nnpm test passed\n## Deviations\nNone\n",
    );
    expect((await run(["gate", "implementation"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "implementation"], cwd)).exitCode).toBe(0);
    await writeFile(
      join(cwd, ".aiw/generated/reports/verification-report.md"),
      "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
    );
    expect((await run(["gate", "verification"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "verification"], cwd)).exitCode).toBe(0);
    await writeFile(
      join(cwd, ".aiw/generated/reports/code-review.md"),
      "## Scope\nFeature implementation\n## Findings\nNone\n## Checks\nTests and diff reviewed\n## Residual Risks\nNone\n## Decision\nAccept\n",
    );
    expect((await run(["gate", "review"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "review"], cwd)).exitCode).toBe(0);

    expect((await run(["trace"], cwd)).exitCode).toBe(0);
    expect((await run(["gate", "traceability"], cwd)).exitCode).toBe(0);
    expect((await run(["workflow", "complete"], cwd)).error).toContain("traceability");
    expect((await run(["approve", "traceability"], cwd)).exitCode).toBe(0);
    expect((await run(["workflow", "complete"], cwd)).exitCode).toBe(0);
    expect((await run(["workflow", "status"], cwd)).output).toContain(
      "Workflow full-stage-run (complete)",
    );
  });

  it("records a human rejection before revising and re-gating the current stage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=rejection-run"], cwd);
    await run(["skip", "brainstorming", "--reason=Scope is already clear"], cwd);
    await run(["spec"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen it works\n",
    );
    await run(["gate", "specification"], cwd);
    expect((await run(["reject", "specification"], cwd)).error).toContain("Usage");
    expect(
      (await run(["reject", "specification", "--reason=Clarify the outcome"], cwd)).exitCode,
    ).toBe(0);
    expect((await run(["workflow", "status"], cwd)).output).toContain(
      "Next action: revise specification",
    );
    await run(["spec"], cwd);
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a member\nWhen they request setup\nThen setup completes\n",
    );
    expect((await run(["gate", "specification"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "specification"], cwd)).exitCode).toBe(0);
  });

  it("does not inherit approvals when starting a workflow in legacy project state", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await mkdir(join(cwd, ".aiw/generated/specs"), { recursive: true });
    await mkdir(join(cwd, ".aiw/generated/plans"), { recursive: true });
    await writeFile(join(cwd, ".aiw/generated/specs/specification.md"), "REQ-001 already exists\n");
    await writeFile(
      join(cwd, ".aiw/generated/plans/implementation-plan.md"),
      "TASK-001 already exists\n",
    );

    expect((await run(["workflow", "start", "--id=legacy-state"], cwd)).exitCode).toBe(0);
    const status = await run(["status"], cwd);
    expect(status.output).toContain("SDD workflow legacy-state (active)");
    expect(status.output).toContain("Next action: prepare brainstorming evidence.");
    expect((await run(["plan"], cwd)).error).toContain("brainstorming");
    const approvalLedger = await readFile(join(cwd, ".aiw/approvals.yml"), "utf8");
    expect(approvalLedger).toContain("stages: {}\n");
  });

  it("blocks existing but incomplete SDD artifacts with actionable feedback", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "brainstorming");
    await run(["brainstorm"], cwd);
    const result = await run(["gate", "brainstorming"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Brainstorm section Goal must contain content");
  });

  it("validates specifications and verification reports at their matching gates", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "specification");
    await writeFile(
      join(cwd, ".aiw/generated/specs/specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they start setup\nThen setup completes\n",
    );
    expect((await run(["gate", "specification"], cwd)).output).toContain("Quality gate passed");

    const verificationCwd = await project();
    await run(["install"], verificationCwd);
    await advanceWorkflowTo(verificationCwd, "verification");
    await mkdir(join(verificationCwd, ".aiw/generated/reports"), { recursive: true });
    await writeFile(
      join(verificationCwd, ".aiw/generated/reports/verification-report.md"),
      "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
    );
    expect((await run(["gate", "verification"], verificationCwd)).output).toContain(
      "Quality gate passed",
    );
  });

  it("installs prerequisite workflow skills when a custom stage is selected", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "jest" }, devDependencies: { jest: "latest" } }),
    );
    const recommendation = await run(["recommend", "--select=skills/tdd-development"], cwd);
    expect(recommendation.exitCode).toBe(0);
    const persisted = await readFile(join(cwd, ".aiw/recommendations.yml"), "utf8");
    expect(persisted).toContain(
      "id: requirements-specification\n    provider: multileaf\n    confidence: 0.9\n    selected: true",
    );
    expect(persisted).toContain("id: implementation-planning");
    expect(persisted).toContain("id: verification");

    const sync = await syncWithApproval(cwd);
    expect(sync.exitCode).toBe(0);
    for (const skill of [
      "requirements-specification",
      "implementation-planning",
      "verification",
      "tdd-development",
    ])
      await expect(stat(join(cwd, `.agents/skills/${skill}/SKILL.md`))).resolves.toBeTruthy();
  });

  it("resolves a package and generates an exact lockfile", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await cp(join(process.cwd(), "resources"), join(cwd, "resources"), { recursive: true });
    const result = await run(["resolve", "--package=resources/package.yaml"], cwd);

    expect(result.exitCode).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("id: multileaf/aiw-self-hosting");
    expect(lock).toMatch(/integrity: sha256-[a-f0-9]{64}/);
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

  it("merges resolved packages and leaves the lock untouched when it is malformed", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const manifest = (id: string, file: string): string =>
      `schema: 1\nid: ${id}\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: skill, version: 1.0.0, path: ${file} }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
    await writeFile(join(cwd, "a.md"), "A\n");
    await writeFile(join(cwd, "b.md"), "B\n");
    await writeFile(join(cwd, "a.yaml"), manifest("demo/a", "a.md"));
    await writeFile(join(cwd, "b.yaml"), manifest("demo/b", "b.md"));
    expect((await run(["resolve", "--package=a.yaml"], cwd)).exitCode).toBe(0);
    const original = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect((await run(["resolve", "--package=b.yaml"], cwd)).exitCode).toBe(0);
    const merged = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(merged).toContain("id: demo/a");
    expect(merged).toContain("id: demo/b");
    expect(merged).toContain(original.match(/integrity: [^\n]+/)?.[0] ?? "missing-integrity");

    await writeFile(join(cwd, ".aiw/lock.yml"), "broken lock\n");
    const malformed = await run(["resolve", "--package=a.yaml"], cwd);
    expect(malformed.exitCode).toBe(1);
    expect(await readFile(join(cwd, ".aiw/lock.yml"), "utf8")).toBe("broken lock\n");
  });

  it("requires network approval before loading remote sources and still checks manifest permissions", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packageRoot = join(cwd, "remote-package");
    await mkdir(join(packageRoot, "skills/example"), { recursive: true });
    await writeFile(join(packageRoot, "skills/example/SKILL.md"), "# Example\n");
    let loads = 0;
    let releases = 0;
    const source = "git+https://example.test/package.git";
    const services = {
      packageSources: {
        load: (requestedSource: string): LoadedPackageSource => {
          loads += 1;
          return {
            provider: "git" as const,
            source: requestedSource,
            root: packageRoot,
            manifest:
              "schema: 1\nid: example/remote\nversion: 1.0.0\nprovider: placeholder\nsource: placeholder\ndependencies: []\npermissions: [process:execute]\nprovenance:\n  source: placeholder\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
            release: (): void => {
              releases += 1;
            },
          };
        },
      },
    };

    const deniedBeforeLoad = await run(["resolve", `--source=${source}`], cwd, services);
    expect(deniedBeforeLoad.exitCode).toBe(1);
    expect(deniedBeforeLoad.error).toContain("network:external");
    expect(loads).toBe(0);

    const deniedManifestPermission = await run(
      ["resolve", `--source=${source}`, "--allow=network:external"],
      cwd,
      services,
    );
    expect(deniedManifestPermission.error).toContain("process:execute");
    expect(loads).toBe(1);
    expect(releases).toBe(1);

    const approved = await run(
      ["resolve", `--source=${source}`, "--allow=network:external", "--allow=process:execute"],
      cwd,
      services,
    );
    expect(approved.exitCode).toBe(0);
    expect(loads).toBe(2);
    expect(releases).toBe(2);
  });

  it("does not require network consent for a local file Git source", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packageRoot = join(cwd, "file-package");
    await mkdir(join(packageRoot, "skills/example"), { recursive: true });
    await writeFile(join(packageRoot, "skills/example/SKILL.md"), "# Example\n");
    let loads = 0;
    const result = await run(["resolve", `--source=file://${packageRoot}`], cwd, {
      packageSources: {
        load: (source: string): LoadedPackageSource => {
          loads += 1;
          return {
            provider: "git",
            source,
            root: packageRoot,
            manifest:
              "schema: 1\nid: example/file\nversion: 1.0.0\nprovider: placeholder\nsource: placeholder\ndependencies: []\npermissions: []\nprovenance:\n  source: placeholder\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
            release: (): void => {},
          };
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(loads).toBe(1);
  });

  it("enforces organization network denials before loading an approved remote source", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, "organization.yml"),
      "schema: 1\nname: Example Org\napproved_sources: [git:git+https://example.test/package.git]\ndenied_permissions: [network:external]\n",
    );
    await run(["organization-policy", "--file=organization.yml"], cwd);
    let loads = 0;

    const result = await run(
      ["resolve", "--source=git+https://example.test/package.git", "--allow=network:external"],
      cwd,
      {
        packageSources: {
          load: (): never => {
            loads += 1;
            throw new Error("Source loader must not run when organization policy denies network.");
          },
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("denied by Example Org: network:external");
    expect(loads).toBe(0);
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
    await writeFile(
      policyPath,
      'schema: 1\nname: "   "\napproved_sources: [local:*]\ndenied_permissions: []\n',
    );
    const invalidReplacement = await run(
      ["organization-policy", "--file=organization.yml", "--replace"],
      cwd,
    );
    expect(invalidReplacement.error).toContain("name is required");
    await expect(readFile(join(cwd, ".aiw/organization.yml"), "utf8")).resolves.toBe(persisted);
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
    let loads = 0;
    const blockedGit = await run(
      ["resolve", "--source=git+https://example.test/untrusted.git"],
      cwd,
      {
        packageSources: {
          load: () => {
            loads += 1;
            throw new Error("Loader must not be called");
          },
        },
      },
    );
    expect(blockedGit.error).toContain("not approved by Example Org");
    expect(loads).toBe(0);
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).error).toContain(
      "--replace",
    );
    await expect(readFile(join(cwd, ".aiw/organization.yml"), "utf8")).resolves.toBe(persisted);
  });

  it("installs deterministic team presets and private registry references safely", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, "preset.yml"),
      "schema: 1\nname: Platform defaults\npackages: [team/testing@^1.0.0, team/lint@2.0.0]\nregistries: [engineering]\n",
    );
    await writeFile(
      join(cwd, "registries.yml"),
      "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test/aiw, token_env: AIW_ENGINEERING_TOKEN }\n",
    );

    expect((await run(["preset", "--file=preset.yml"], cwd)).exitCode).toBe(0);
    expect((await run(["registry", "configure", "--file=registries.yml"], cwd)).exitCode).toBe(0);
    const preset = await readFile(join(cwd, ".aiw/team-preset.yml"), "utf8");
    const registries = await readFile(join(cwd, ".aiw/registries.yml"), "utf8");
    expect(preset).toContain("packages: [team/lint@2.0.0, team/testing@^1.0.0]");
    expect(registries).toContain("token_env: AIW_ENGINEERING_TOKEN");
    expect(registries).not.toContain("secret");
    await writeFile(
      join(cwd, "organization.yml"),
      "schema: 1\nname: Example Org\napproved_sources: [private-registry:https://registry.example.test/aiw]\ndenied_permissions: []\n",
    );
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).exitCode).toBe(0);

    let receivedToken = "";
    const privateSearch = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      {
        environment: { AIW_ENGINEERING_TOKEN: "runtime-secret" },
        privateRegistries: {
          search: async (_registry, query, token) => {
            expect(query).toBe("quality");
            receivedToken = token;
            return [
              {
                id: "team/quality",
                version: "1.2.0",
                description: "Team quality defaults.",
                permissions: ["filesystem:read"],
              },
            ];
          },
        },
      },
    );
    expect(privateSearch.output).toContain("team/quality@1.2.0 [private-registry]");
    expect(privateSearch.output).not.toContain("runtime-secret");
    expect(receivedToken).toBe("runtime-secret");
    const leakingFailure = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      {
        environment: { AIW_ENGINEERING_TOKEN: "runtime-secret" },
        privateRegistries: {
          search: async () => {
            throw new Error("transport leaked runtime-secret");
          },
        },
      },
    );
    expect(leakingFailure.error).toContain("[REDACTED]");
    expect(leakingFailure.error).not.toContain("runtime-secret");
    const leakingPayload = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      {
        environment: { AIW_ENGINEERING_TOKEN: "runtime-secret" },
        privateRegistries: {
          search: async () => [
            {
              id: "team/quality",
              version: "1.2.0",
              description: "runtime-secret",
              permissions: [],
            },
          ],
        },
      },
    );
    expect(leakingPayload.exitCode).toBe(1);
    expect(leakingPayload.error).not.toContain("runtime-secret");
    for (const escapedToken of ['runtime-"secret', "runtime-\\secret"]) {
      const escapedPayload = await run(
        ["registry", "--private=engineering", "--search=quality"],
        cwd,
        {
          environment: { AIW_ENGINEERING_TOKEN: escapedToken },
          privateRegistries: {
            search: async () => [
              {
                id: "team/quality",
                version: "1.2.0",
                description: escapedToken,
                permissions: [],
              },
            ],
          },
        },
      );
      expect(escapedPayload.exitCode).toBe(1);
      expect(escapedPayload.error).not.toContain(escapedToken);
    }
    const missingCredential = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      { environment: {} },
    );
    expect(missingCredential.error).toContain("AIW_ENGINEERING_TOKEN");

    expect((await run(["preset", "--file=preset.yml"], cwd)).error).toContain("--replace");
    await writeFile(
      join(cwd, "registries.yml"),
      "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test, token: secret }\n",
    );
    const rejected = await run(
      ["registry", "configure", "--file=registries.yml", "--replace"],
      cwd,
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.error).toContain("token_env");
    await expect(readFile(join(cwd, ".aiw/registries.yml"), "utf8")).resolves.toBe(registries);
    await writeFile(
      join(cwd, "registries.yml"),
      "schema: 1\nregistries:\n  - { name: replacement, url: https://registry.example.test, token_env: AIW_TOKEN }\n  - malformed-entry\n",
    );
    expect(
      (await run(["registry", "configure", "--file=registries.yml", "--replace"], cwd)).exitCode,
    ).toBe(1);
    await expect(readFile(join(cwd, ".aiw/registries.yml"), "utf8")).resolves.toBe(registries);
    await writeFile(
      join(cwd, ".aiw/registries.yml"),
      "schema: 1\nregistries:\n  - { name: engineering, url: https://user:secret@registry.example.test, token_env: AIW_TOKEN }\n",
    );
    const unhealthy = await run(["doctor"], cwd);
    expect(unhealthy.exitCode).toBe(1);
    expect(unhealthy.error).not.toContain("secret");
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
    await writeFile(join(cwd, "skill.md"), "# Demo skill\n");
    await run(["resolve", "--package=package.yaml"], cwd);
    const lockedV1 = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    await writeFile(join(cwd, "skill.md"), "# Edited without a version change\n");
    const tampered = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(tampered.exitCode).toBe(1);
    expect(tampered.error).toContain("integrity mismatch");
    expect(await readFile(join(cwd, ".aiw/lock.yml"), "utf8")).toBe(lockedV1);
    await writeFile(join(cwd, "skill.md"), "# Demo skill\n");
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
      `${await readFile(join(cwd, ".aiw/lock.yml"), "utf8")}  - id: demo/base\n    version: 1.0.0\n    provider: local\n    source: ./base\n    integrity: sha256-${"b".repeat(64)}\n`,
    );
    const conflict = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.error).toContain("incompatible");
  });

  it("preserves unrelated lock permissions while updating a package", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `schema: 1\npackages:\n  - id: demo/package\n    version: 1.0.0\n    provider: local\n    source: ./package\n    integrity: sha256-${"a".repeat(64)}\n    permissions: []\n  - id: unrelated/package\n    version: 1.0.0\n    provider: local\n    source: ./unrelated\n    integrity: sha256-${"b".repeat(64)}\n    permissions: [filesystem:read, network:external]\n`,
    );
    await writeFile(
      join(cwd, "package.yaml"),
      "schema: 1\nid: demo/package\nversion: 2.0.0\nprovider: local\nsource: ./package\ndependencies: []\npermissions: []\nprovenance:\n  source: ./package\nresources:\n  skills:\n    - { id: demo-skill, version: 2.0.0, path: skill.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );
    await writeFile(join(cwd, "skill.md"), "# Demo skill\n");

    expect((await run(["update", "--package=package.yaml", "--target=codex"], cwd)).exitCode).toBe(
      0,
    );
    expect(await readFile(join(cwd, ".aiw/lock.yml"), "utf8")).toContain(
      "permissions: [filesystem:read, network:external]",
    );
  });

  it("enforces the configured organization policy as a CI gate", async () => {
    const cwd = await project();
    const services = { policyTracking: { isTracked: (): boolean => true } };
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw/organization.yml"),
      "schema: 1\nname: Engineering\napproved_sources: [local:./resources]\ndenied_permissions: [process:execute]\n",
    );
    await writeFile(
      join(cwd, "package.yaml"),
      "schema: 1\nid: team/base\nversion: 1.0.0\nprovider: local\nsource: ./resources\ndependencies: []\npermissions: []\nprovenance:\n  source: ./resources\nresources:\n  skills:\n    - { id: base, version: 1.0.0, path: skills/base.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );

    expect((await run(["policy-check", "--package=package.yaml"], cwd, services)).exitCode).toBe(0);
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `schema: 1\npackages:\n  - id: unknown/package\n    version: 1.0.0\n    provider: git\n    source: https://unapproved.example.test/package.git\n    integrity: sha256-${"c".repeat(64)}\n`,
    );
    const unapprovedLock = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(unapprovedLock.exitCode).toBe(1);
    expect(unapprovedLock.error).toContain("not approved");
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `schema: 1\npackages:\n  - id: unknown/package\n    version: 1.0.0\n    provider: local\n    source: ./resources\n    integrity: sha256-${"d".repeat(64)}\n    permissions: [process:execute]\n`,
    );
    const deniedLock = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(deniedLock.exitCode).toBe(1);
    expect(deniedLock.error).toContain("denied by Engineering");
    await writeFile(join(cwd, ".aiw/lock.yml"), "schema: 1\npackages:\n");
    await writeFile(
      join(cwd, "package.yaml"),
      (await readFile(join(cwd, "package.yaml"), "utf8")).replace(
        "permissions: []",
        "permissions: [process:execute]",
      ),
    );
    const denied = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(denied.exitCode).toBe(1);
    expect(denied.error).toContain("denied by Engineering");
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

  it.each(["check", "update"])(
    "enforces organization policy before skills %s accesses an external provider",
    async (action) => {
      const cwd = await project();
      await run(["install", "--target", "codex"], cwd);
      await writeFile(
        join(cwd, ".aiw/organization.yml"),
        "schema: 1\nname: Engineering\napproved_sources: [vercel-skills:vercel-labs/agent-skills]\ndenied_permissions: [network:external]\n",
      );
      await writeFile(
        join(cwd, ".aiw/lock.yml"),
        "schema: 1\npackages:\n  - id: vercel-labs/agent-skills/react-best-practices\n    version: latest\n    provider: vercel-skills\n    source: vercel-labs/agent-skills\n    integrity: hash-v1\n    permissions: [network:external]\n",
      );
      let calls = 0;
      const result = await run(["skills", action, "--allow=network:external"], cwd, {
        externalSkills: {
          execute: async () => {
            calls += 1;
            return { stdout: "completed", exitCode: 0 };
          },
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("denied by Engineering");
      expect(calls).toBe(0);
    },
  );

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
    await expect(stat(join(cwd, ".agents/skills/brainstorming/SKILL.md"))).rejects.toThrow();
    await expect(stat(join(cwd, ".aiw/resources/skills/brainstorming/SKILL.md"))).rejects.toThrow();
  });

  it("removes the migration checkpoint during uninstall and prevents rollback resurrection", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    expect((await run(["target", "claude"], cwd)).exitCode).toBe(0);
    const checkpoint = join(cwd, ".aiw/checkpoints/migration-backup.yml");
    await expect(stat(checkpoint)).resolves.toBeTruthy();
    const dryRun = await run(["uninstall", "--dry-run"], cwd);
    expect(dryRun.output).toContain(".aiw/checkpoints/migration-backup.yml");
    expect((await run(["uninstall"], cwd)).exitCode).toBe(0);
    await expect(stat(checkpoint)).rejects.toThrow();
    expect((await run(["rollback"], cwd)).exitCode).toBe(1);
    expect((await run(["rollback"], cwd)).error).toContain("No migration backup");
  });

  it("preserves and reports an edited installed resource during uninstall", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await syncCapabilities(cwd, ["brainstorming"]);
    const editedResource = join(cwd, ".agents/skills/brainstorming/SKILL.md");
    await writeFile(editedResource, "user-edited skill\n");
    const before = await readFile(join(cwd, ".aiw/manifest.yml"), "utf8");
    const dryRun = await run(["uninstall", "--dry-run"], cwd);
    expect(dryRun.exitCode).toBe(1);
    expect(dryRun.output).toContain("Would preserve modified/conflicting files");
    expect(dryRun.output).toContain(".agents/skills/brainstorming/SKILL.md");
    await expect(readFile(join(cwd, ".aiw/manifest.yml"), "utf8")).resolves.toBe(before);

    const result = await run(["uninstall"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Preserved modified/conflicting files");
    await expect(readFile(editedResource, "utf8")).resolves.toBe("user-edited skill\n");
    await expect(stat(join(cwd, ".aiw/manifest.yml"))).rejects.toThrow();
  });

  it("refuses unsafe ownership inventory paths before uninstall mutates state", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const inventoryPath = join(cwd, ".aiw/ownership.yml");
    const inventory = await readFile(inventoryPath, "utf8");
    await writeFile(
      inventoryPath,
      inventory.replace(/path: \.agents\/skills\/ai-init\/SKILL\.md/, "path: ../../outside.txt"),
    );
    const result = await run(["uninstall"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("project-relative");
    await expect(stat(join(cwd, ".aiw/manifest.yml"))).resolves.toBeTruthy();
    await expect(stat(join(cwd, ".agents/skills/ai-init/SKILL.md"))).resolves.toBeTruthy();
  });

  it("does not follow or remove a symlink substituted for an owned resource", async () => {
    const cwd = await project();
    const outsideRoot = await project();
    const outside = join(outsideRoot, "outside.md");
    await writeFile(outside, "outside user content\n");
    await run(["install", "--target", "codex"], cwd);
    await syncCapabilities(cwd, ["brainstorming"]);
    const owned = join(cwd, ".agents/skills/brainstorming/SKILL.md");
    await rm(owned);
    await symlink(outside, owned);

    const result = await run(["uninstall"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(".agents/skills/brainstorming/SKILL.md");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside user content\n");
    await expect(stat(owned)).resolves.toBeTruthy();
    await rm(outsideRoot, { recursive: true, force: true });
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
    const result = await syncWithApproval(cwd);
    expect(result.exitCode).toBe(0);
    await expect(stat(join(cwd, ".aiw/generated/rules/project-quality.md"))).resolves.toBeTruthy();
  });
});
