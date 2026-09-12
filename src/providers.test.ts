import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodePackageSourceLoader, requiresExternalNetwork, resolveProvider } from "./providers.js";

async function packageFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aiw-provider-test-"));
  await mkdir(join(root, "skills/example"), { recursive: true });
  await writeFile(join(root, "skills/example/SKILL.md"), "# Example\n");
  await writeFile(
    join(root, "package.yaml"),
    "schema: 1\nid: example/package\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
  );
  return root;
}

describe("package providers", () => {
  it("resolves local package sources relative to the project", () => {
    expect(resolveProvider("./packages/core", "/project")).toEqual({
      provider: "local",
      source: "/project/packages/core",
    });
  });

  it("resolves Git sources without network access", () => {
    expect(resolveProvider("git+https://github.com/example/pkg.git", "/project")).toEqual({
      provider: "git",
      source: "git+https://github.com/example/pkg.git",
    });
  });

  it.each([
    ["git+https://github.com/example/pkg.git", true],
    ["https://github.com/example/pkg.git", true],
    ["ssh://git@example.test/example/pkg.git", true],
    ["git@example.test:example/pkg.git", true],
    ["file:///tmp/pkg.git", false],
    ["git+file:///tmp/pkg.git", false],
    ["./packages/local.git", false],
  ])("classifies source %s for network consent", (input, expected) => {
    expect(requiresExternalNetwork(resolveProvider(input, "/project"))).toBe(expected);
  });

  it("rejects unsupported source protocols", () => {
    expect(() => resolveProvider("npm:example", "/project")).toThrow("Unsupported package source");
    expect(() => resolveProvider("git+exec://example.test/pkg.git", "/project")).toThrow(
      "Unsupported package source",
    );
  });

  it("loads a local package directory without requiring cleanup", async () => {
    const root = await packageFixture();
    const loaded = nodePackageSourceLoader.load(root, "/project");
    expect(loaded.provider).toBe("local");
    expect(loaded.manifest).toContain("id: example/package");
    loaded.release();
    await expect(stat(root)).resolves.toBeDefined();
  });

  it("clones a Git package and removes its temporary checkout", async () => {
    const root = await packageFixture();
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=AIW",
      "-c",
      "user.email=aiw@example.test",
      "commit",
      "-qm",
      "fixture",
    ]);
    const loaded = nodePackageSourceLoader.load(`file://${root}`, "/project");
    expect(loaded.provider).toBe("git");
    expect(loaded.manifest).toContain("id: example/package");
    const checkout = loaded.root;
    loaded.release();
    await expect(stat(checkout)).rejects.toThrow();
  });
});
