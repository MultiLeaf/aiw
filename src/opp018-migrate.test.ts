import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./cli.js";

async function legacyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-opp018-"));
  const git = (args: string[]): void =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "t@e.c"]);
  git(["config", "user.name", "t"]);
  await writeFile(join(cwd, "README.md"), "# project\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  // 0.7-era layout: manifest + lock + recommendations, NO ownership.yml
  await mkdir(join(cwd, ".aiw"), { recursive: true });
  await writeFile(
    join(cwd, ".aiw", "manifest.yml"),
    "schema: 1\nproject:\n  name: legacy-app\ntarget:\n  active: codex\n",
  );
  await writeFile(join(cwd, ".aiw", "lock.yml"), "schema: 1\npackages: []\n");
  await writeFile(join(cwd, ".aiw", "recommendations.yml"), "schema: 1\nrecommendations: []\n");
  await writeFile(join(cwd, ".aiw", "profile.yml"), "schema: 1\nproject:\n  name: legacy-app\n");
  await writeFile(join(cwd, ".aiw", "decision.yml"), "decision:\n  enabled: false\n");
  await mkdir(join(cwd, ".aiw", "checkpoints"), { recursive: true });
  await writeFile(join(cwd, ".aiw", "checkpoints", "old-evidence.yml"), "schema: 1\nold: true\n");
  await mkdir(join(cwd, ".aiw", "generated", "specs"), { recursive: true });
  await writeFile(join(cwd, ".aiw", "generated", "specs", "brainstorm.md"), "# old\n");
  await mkdir(join(cwd, ".agents", "skills", "ai-init"), { recursive: true });
  await writeFile(
    join(cwd, ".agents", "skills", "ai-init", "SKILL.md"),
    "---\nname: ai-init\ndescription: old skill\n---\n\n# AI Init (legacy)\n",
  );
  return cwd;
}

describe("OPP-018 legacy migration", () => {
  it("doctor detects the legacy signature and names the migrate continuation", async () => {
    const cwd = await legacyProject();
    const result = await run(["doctor"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: migration_required]");
    expect(result.error).toContain("`aiw migrate --dry-run`");
  });

  it("dry-run lists preserved and rebuilt without writing anything", async () => {
    const cwd = await legacyProject();
    const result = await run(["migrate", "--dry-run"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Migration plan (dry-run)");
    expect(result.output).toContain("Preserved byte-identical");
    expect(result.output).toContain("decision.yml");
    expect(result.output).toContain("ownership inventory");
    // fail-safe: nothing written
    expect(existsSync(join(cwd, ".aiw", "ownership.yml"))).toBe(false);
    expect(
      readdirSync(join(cwd, ".aiw", "checkpoints")).filter((entry) =>
        entry.startsWith("migration-"),
      ),
    ).toHaveLength(0);
  });

  it("apply archives superseded state, rebuilds ownership, preserves user config and history", async () => {
    const cwd = await legacyProject();
    const decisionBefore = await readFile(join(cwd, ".aiw", "decision.yml"), "utf8");
    const checkpointBefore = await readFile(
      join(cwd, ".aiw", "checkpoints", "old-evidence.yml"),
      "utf8",
    );
    const result = await run(["migrate"], cwd);
    expect(result.exitCode).toBe(0);
    // ownership rebuilt → doctor passes
    const doctor = await run(["doctor"], cwd);
    console.log("DOCTOR:", JSON.stringify(doctor));
    expect(doctor.exitCode, doctor.error ?? doctor.output ?? "").toBe(0);
    // live machine files stay in place: their owning commands refresh them
    expect(existsSync(join(cwd, ".aiw", "lock.yml"))).toBe(true);
    expect(existsSync(join(cwd, ".aiw", "recommendations.yml"))).toBe(true);
    const migrationDir = readdirMigrationDir(cwd);
    expect(migrationDir).toBeDefined();
    expect(
      existsSync(join(cwd, ".aiw", "checkpoints", migrationDir!, "original", "decision.yml")),
    ).toBe(true);
    // user config and history preserved byte-identical
    expect(await readFile(join(cwd, ".aiw", "decision.yml"), "utf8")).toBe(decisionBefore);
    expect(await readFile(join(cwd, ".aiw", "checkpoints", "old-evidence.yml"), "utf8")).toBe(
      checkpointBefore,
    );
    // sync now produces a plan (ownership present)
    const sync = await run(["sync", "--preview"], cwd);
    expect(sync.exitCode, sync.error ?? sync.output ?? "").toBe(0);
    // migration report written
    expect(existsSync(join(cwd, ".aiw", "migration-report.yml"))).toBe(true);
  });

  it("rollback restores the original legacy state atomically", async () => {
    const cwd = await legacyProject();
    await run(["migrate"], cwd);
    const rollback = await run(["migrate", "--rollback"], cwd);
    expect(rollback.exitCode).toBe(0);
    expect(existsSync(join(cwd, ".aiw", "lock.yml"))).toBe(true);
    expect(existsSync(join(cwd, ".aiw", "ownership.yml"))).toBe(false);
    const doctor = await run(["doctor"], cwd);
    expect(doctor.exitCode).toBe(1);
    expect(doctor.error).toContain("[reason: migration_required]");
  });

  it("modern installations have nothing to migrate", async () => {
    const cwd = await legacyProject();
    await run(["migrate"], cwd); // migrates to modern
    const result = await run(["migrate"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Nothing to migrate");
  });

  it("fails closed naming ambiguous files as manual actions", async () => {
    const cwd = await legacyProject();
    await writeFile(join(cwd, ".aiw", "mystery.yml"), "exotic: true\n");
    const dry = await run(["migrate", "--dry-run"], cwd);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("manual");
    expect(dry.output).toContain("mystery.yml");
    const applied = await run(["migrate"], cwd);
    expect(applied.exitCode).toBe(1);
    expect(applied.error).toContain("mystery.yml");
    expect(existsSync(join(cwd, ".aiw", "ownership.yml"))).toBe(false);
  });

  it("install on legacy state suggests the migration", async () => {
    const cwd = await legacyProject();
    const result = await run(["install", "--target=codex"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("aiw migrate --dry-run");
  });
});

function readdirMigrationDir(cwd: string): string | undefined {
  const base = join(cwd, ".aiw", "checkpoints");
  if (!existsSync(base)) return undefined;
  const entries = readdirSync(base);
  return entries.find((entry) => entry.startsWith("migration-"));
}
