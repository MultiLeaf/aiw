import { describe, expect, it } from "vitest";
import { parseLock, resolvePackage, serializeLock } from "./lockfile.js";
import type { PackageContract } from "./package-contract.js";

const pkg: PackageContract = {
  schema: 1,
  id: "demo/package",
  version: "1.0.0",
  provider: "local",
  source: "./resources",
  resources: {
    skills: [],
    rules: [],
    agents: [],
    hooks: [],
    templates: [{ id: "spec", version: "1.0.0", path: "spec.md" }],
  },
  dependencies: [],
  permissions: [],
  provenance: { source: "./resources" },
};
const integrity = `sha256-${"a".repeat(64)}`;

describe("lockfile resolution", () => {
  it("resolves exact package metadata with integrity", () => {
    expect(resolvePackage(pkg, integrity)).toMatchObject({
      id: "demo/package",
      version: "1.0.0",
      integrity,
      permissions: [],
    });
  });

  it("serializes packages deterministically regardless of input order", () => {
    const first = resolvePackage(pkg, integrity);
    const second = { ...first, id: "another/package" };
    expect(serializeLock([first, second])).toBe(serializeLock([second, first]));
  });

  it("produces the same lockfile for the same resolved package set", () => {
    const first = serializeLock([resolvePackage(pkg, integrity)]);
    const second = serializeLock([resolvePackage({ ...pkg }, integrity)]);
    expect(first).toBe(second);
  });

  it("strictly parses current and legacy lock entries", () => {
    const serialized = serializeLock([resolvePackage(pkg, integrity)]);
    expect(parseLock(serialized)).toEqual([resolvePackage(pkg, integrity)]);
    expect(
      parseLock(serialized.replace("    permissions: []\n", ""))[0].permissions,
    ).toBeUndefined();
    expect(() => parseLock("not: [valid\n")).toThrow("schema");
    expect(() => parseLock(serialized.replace("schema: 1", "schema: 9"))).toThrow("schema");
    expect(() =>
      parseLock(serialized.replace("permissions: []", "permissions: [process:execute")),
    ).toThrow("permissions");
    expect(() =>
      parseLock(serialized.replace("permissions: []", "permissions: [, filesystem:read]")),
    ).toThrow("permissions");
    expect(() =>
      parseLock(serialized.replace(new RegExp(`sha256-${"a".repeat(64)}`), "sha256-invalid")),
    ).toThrow("integrity");
  });
});
