import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vitest test discovery", () => {
  it("runs canonical source tests and ignores nested agent worktree copies", () => {
    const projectRoot = resolve(".");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "aiw-vitest-discovery-"));
    const canonicalTest = join(fixtureRoot, "src/canonical.test.ts");
    const claudeCopy = join(fixtureRoot, ".claude/worktrees/agent/src/copied.test.ts");
    const codexCopy = join(fixtureRoot, ".codex/worktrees/agent/src/copied.test.ts");

    try {
      mkdirSync(join(fixtureRoot, "src"), { recursive: true });
      mkdirSync(join(fixtureRoot, ".claude/worktrees/agent/src"), { recursive: true });
      mkdirSync(join(fixtureRoot, ".codex/worktrees/agent/src"), { recursive: true });
      symlinkSync(
        join(projectRoot, "node_modules"),
        join(fixtureRoot, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      for (const file of [canonicalTest, claudeCopy, codexCopy]) {
        writeFileSync(file, 'import { it } from "vitest"; it("fixture", () => {});\n');
      }

      const discovery = spawnSync(
        process.execPath,
        [
          join(projectRoot, "node_modules/vitest/vitest.mjs"),
          "list",
          "--filesOnly",
          "--json",
          "--root",
          fixtureRoot,
          "--config",
          join(projectRoot, "vitest.config.ts"),
        ],
        { cwd: projectRoot, encoding: "utf8", timeout: 30_000 },
      );

      expect(discovery.error).toBeUndefined();
      expect(discovery.status, `${discovery.stdout}\n${discovery.stderr}`).toBe(0);
      const files = (JSON.parse(discovery.stdout) as Array<{ file: string }>).map(({ file }) =>
        realpathSync(resolve(fixtureRoot, file)),
      );
      expect(files).toContain(realpathSync(canonicalTest));
      expect(files).not.toContain(realpathSync(claudeCopy));
      expect(files).not.toContain(realpathSync(codexCopy));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
