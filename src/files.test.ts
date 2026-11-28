import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafeProjectPath,
  nodeFileSystem,
  withSafeProjectWrites,
  writeProjectFilesAtomically,
} from "./files.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "aiw-files-test-"));
}

describe("nodeFileSystem and project path safety", () => {
  it("supports exclusive file/directory creation and pathType classification", () => {
    const root = tempDir();
    try {
      const dir = join(root, "sub");
      expect(nodeFileSystem.pathType?.(dir)).toBe("missing");
      expect(nodeFileSystem.mkdirExclusive?.(dir)).toBe(true);
      expect(nodeFileSystem.mkdirExclusive?.(dir)).toBe(false);
      expect(nodeFileSystem.pathType?.(dir)).toBe("directory");

      const file = join(dir, "lock.yml");
      expect(nodeFileSystem.createExclusive?.(file, "v1")).toBe(true);
      expect(nodeFileSystem.createExclusive?.(file, "v2")).toBe(false);
      expect(nodeFileSystem.read(file)).toBe("v1");
      expect(nodeFileSystem.pathType?.(file)).toBe("file");

      const link = join(root, "link.yml");
      symlinkSync(file, link);
      expect(nodeFileSystem.pathType?.(link)).toBe("symlink");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks paths outside the project root and symlink traversal in withSafeProjectWrites", () => {
    const root = tempDir();
    const outside = tempDir();
    try {
      const safeFs = withSafeProjectWrites(nodeFileSystem, root);
      const validFile = join(root, "ok/data.txt");
      safeFs.write(validFile, "hello");
      expect(nodeFileSystem.read(validFile)).toBe("hello");

      expect(() => safeFs.write(join(outside, "escape.txt"), "bad")).toThrow(
        "must stay inside the project",
      );

      const linkDir = join(root, "linked");
      symlinkSync(outside, linkDir);
      expect(() => assertSafeProjectPath(nodeFileSystem, root, join(linkDir, "file.txt"))).toThrow(
        "symbolic link",
      );
      expect(() => safeFs.write(join(linkDir, "file.txt"), "bad")).toThrow("symbolic link");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("writes files atomically and rolls back created files/directories on failure", () => {
    const root = tempDir();
    try {
      const first = join(root, "a/one.txt");
      const second = join(root, "b/two.txt");
      writeProjectFilesAtomically(
        nodeFileSystem,
        root,
        [
          { path: first, content: "1" },
          { path: second, content: "2" },
        ],
        [join(root, "c/empty")],
      );
      expect(nodeFileSystem.read(first)).toBe("1");
      expect(nodeFileSystem.read(second)).toBe("2");
      expect(nodeFileSystem.pathType?.(join(root, "c/empty"))).toBe("directory");

      // Duplicate path rejected before writing anything.
      const dup = join(root, "dup/file.txt");
      expect(() =>
        writeProjectFilesAtomically(nodeFileSystem, root, [
          { path: dup, content: "x" },
          { path: dup, content: "y" },
        ]),
      ).toThrow("Duplicate installation path");
      expect(nodeFileSystem.exists(dup)).toBe(false);

      // Existing file rejected before writing anything.
      const existing = join(root, "existing.txt");
      writeFileSync(existing, "keep");
      expect(() =>
        writeProjectFilesAtomically(nodeFileSystem, root, [
          { path: join(root, "new/a.txt"), content: "a" },
          { path: existing, content: "overwrite" },
        ]),
      ).toThrow("already exists");
      expect(nodeFileSystem.exists(join(root, "new/a.txt"))).toBe(false);

      // Mid-transaction failure rolls back earlier created files and directories.
      mkdirSync(join(root, "rollback"), { recursive: true });
      const flakyFs = {
        ...nodeFileSystem,
        createExclusive: (path: string, content: string): boolean => {
          if (path.endsWith("fail.txt")) throw new Error("disk full");
          return nodeFileSystem.createExclusive!(path, content);
        },
      };
      expect(() =>
        writeProjectFilesAtomically(flakyFs, root, [
          { path: join(root, "rollback/sub/ok.txt"), content: "ok" },
          { path: join(root, "rollback/sub/fail.txt"), content: "fail" },
        ]),
      ).toThrow("disk full");
      expect(nodeFileSystem.exists(join(root, "rollback/sub/ok.txt"))).toBe(false);
      expect(nodeFileSystem.exists(join(root, "rollback/sub"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
