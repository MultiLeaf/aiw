import { describe, expect, it } from "vitest";
import { createOwnedFile, parseOwnership, serializeOwnership } from "./ownership.js";

describe("installation ownership inventory", () => {
  it("serializes deterministically and validates every path and digest", () => {
    const files = [
      createOwnedFile(".agents/skills/demo/SKILL.md", "skill"),
      createOwnedFile(".aiw/resources/skills/demo.md", "neutral"),
    ];
    const serialized = serializeOwnership(files);
    expect(serializeOwnership([...files].reverse())).toBe(serialized);
    expect(parseOwnership(serialized)).toEqual(
      [...files].sort((a, b) => a.path.localeCompare(b.path)),
    );
  });

  it.each(["../outside.txt", "/tmp/outside.txt", "a\\..\\outside.txt", "a/../outside.txt"])(
    "rejects unsafe inventory path %s",
    (path) => {
      const unsafe = `schema: 1\nfiles:\n  - path: ${JSON.stringify(path)}\n    checksum: sha256-${"a".repeat(64)}\n`;
      expect(() => parseOwnership(unsafe)).toThrow("project-relative");
    },
  );

  it("rejects duplicate paths and malformed checksums", () => {
    const duplicate = `schema: 1\nfiles:\n  - { path: a.txt, checksum: sha256-${"a".repeat(64)} }\n  - { path: a.txt, checksum: sha256-${"b".repeat(64)} }\n`;
    const malformed = `schema: 1\nfiles:\n  - { path: a.txt, checksum: sha256-short }\n`;
    expect(() => parseOwnership(duplicate)).toThrow("unique");
    expect(() => parseOwnership(malformed)).toThrow("checksum");
  });
});
