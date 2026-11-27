import { describe, expect, it } from "vitest";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./cli.js";
import { nodeFileSystem } from "./files.js";
import { runCommand } from "./workflow.js";
import type { FileSystem } from "./types.js";
import { project, syncCapabilities } from "./fixtures/cli-test-helpers.js";

describe("AI Workflow CLI — target migration and health", () => {
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

  it("reports actionable diagnostics with doctor", async () => {
    const cwd = await project();
    expect((await run(["doctor"], cwd)).error).toContain("Missing AI Workflow files");
    await run(["install"], cwd);
    const result = await run(["doctor"], cwd);
    expect(result.output).toContain("health check passed");
    expect(result.output).not.toContain("Telemetry enabled");
    // Non-interactive doctor never prompts; telemetry consent stays unrecorded.
    await expect(stat(join(cwd, ".aiw", "telemetry.yml"))).rejects.toThrow();
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
});
