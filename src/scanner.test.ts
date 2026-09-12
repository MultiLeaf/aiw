import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "./scanner.js";

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-scanner-"));
}

describe("project scanner", () => {
  it("returns deterministic structural facts without reading file contents", async () => {
    const root = await fixture();
    await writeFile(join(root, "package.json"), '{"scripts":{"test":"vitest"}}');
    await writeFile(join(root, "eslint.config.js"), "export default [];");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "const secret = 'do-not-return';");

    const result = await scanProject(root);

    expect(result.files).toEqual(["eslint.config.js", "package.json", "src/main.ts"]);
    expect(result.files.join(" ")).not.toContain("do-not-return");
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        { fact: "language.typescript", source: "src/main.ts" },
        { fact: "tool.eslint", source: "eslint.config.js" },
        { fact: "package-manager.npm", source: "package.json" },
      ]),
    );
  });

  it("respects gitignore patterns and excludes sensitive files", async () => {
    const root = await fixture();
    await writeFile(join(root, ".gitignore"), "dist\n*.log\n");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "bundle.js"), "generated");
    await writeFile(join(root, "debug.log"), "private");
    await writeFile(join(root, ".env"), "TOKEN=secret");
    await writeFile(join(root, "README.md"), "Project");

    const result = await scanProject(root);

    expect(result.files).toEqual([".gitignore", "README.md"]);
  });

  it("matches git check-ignore for anchored, nested, globstar, escaped, and negated rules", async () => {
    const root = await fixture();
    await writeFile(
      join(root, ".gitignore"),
      "/root-only.txt\n*.tmp\ncache/\ndocs/**/draft?.md\nliteral\\[1\\].txt\nsrc/*.tmp\ngenerated/\n!generated/keep.txt\n",
    );
    await mkdir(join(root, "src/generated"), { recursive: true });
    await mkdir(join(root, "docs/api"), { recursive: true });
    await mkdir(join(root, "cache"));
    await mkdir(join(root, "generated"));
    await writeFile(join(root, "src/.gitignore"), "!keep.tmp\n");
    const candidates = [
      "root-only.txt",
      "nested/root-only.txt",
      "src/keep.tmp",
      "src/drop.tmp",
      "docs/api/draft1.md",
      "docs/api/draft.md",
      "literal[1].txt",
      "cache/data.txt",
      "generated/keep.txt",
      "generated/drop.txt",
    ];
    for (const candidate of candidates) {
      const path = join(root, candidate);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "fixture");
    }
    execFileSync("git", ["init", "-q"], { cwd: root });

    const scan = await scanProject(root);
    const scanned = new Set(scan.files);
    for (const candidate of candidates) {
      const git = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", candidate], {
        cwd: root,
      });
      expect(git.error).toBeUndefined();
      expect([0, 1]).toContain(git.status);
      expect(scanned.has(candidate)).toBe(git.status === 1);
    }
  });

  it("keeps mandatory sensitive-file exclusions stronger than ignore negation", async () => {
    const root = await fixture();
    await writeFile(join(root, ".gitignore"), "!.env\n!private.key\n");
    await writeFile(join(root, ".env"), "TOKEN=secret");
    await writeFile(join(root, "private.key"), "private key");

    expect((await scanProject(root)).files).toEqual([".gitignore"]);
  });

  it("does not escape the project root through symbolic links", async () => {
    const root = await fixture();
    await writeFile(join(root, "README.md"), "Project");
    const result = await scanProject(root);
    expect(result.files.every((file) => !file.startsWith(".."))).toBe(true);
  });
});
