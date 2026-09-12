import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "./files.js";
import {
  checksumPackage,
  checksumPackageSnapshot,
  verifyPackageProvenance,
} from "./package-integrity.js";
import { validatePackageContract } from "./package-contract.js";

describe("package integrity", () => {
  it("creates a reproducible SHA-256 checksum", () => {
    expect(checksumPackage("package")).toBe(checksumPackage("package"));
    expect(checksumPackage("package")).toHaveLength(64);
  });

  it("rejects tampered content and verifies optional signatures", () => {
    const content = "trusted package";
    const checksum = checksumPackage(content);
    expect(() => verifyPackageProvenance("tampered", { checksum })).toThrow("checksum mismatch");
    expect(() => verifyPackageProvenance(content, { checksum, signature: "sig" })).toThrow(
      "configured verifier",
    );
    expect(() =>
      verifyPackageProvenance(content, { checksum, signature: "sig" }, () => true),
    ).not.toThrow();
    expect(() =>
      verifyPackageProvenance(content, { checksum, signature: "sig" }, () => false),
    ).toThrow("signature verification");
  });

  it("hashes exact manifest and declared resource bytes deterministically", () => {
    const root = mkdtempSync(join(tmpdir(), "aiw-integrity-test-"));
    try {
      const manifest = Buffer.from("schema: 1\nid: demo/package\n");
      const resource = "skill.md";
      writeFileSync(join(root, resource), "original bytes\n");
      const pkg = validatePackageContract(
        `schema: 1\nid: demo/package\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: skill, version: 1.0.0, path: skill.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`,
      );
      const first = checksumPackageSnapshot(manifest, pkg, root, nodeFileSystem);
      expect(first).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(checksumPackageSnapshot(manifest, pkg, root, nodeFileSystem)).toBe(first);
      writeFileSync(join(root, resource), "changed bytes\n");
      expect(checksumPackageSnapshot(manifest, pkg, root, nodeFileSystem)).not.toBe(first);
      expect(
        checksumPackageSnapshot(
          Buffer.from(`${manifest.toString()}# changed`),
          pkg,
          root,
          nodeFileSystem,
        ),
      ).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
