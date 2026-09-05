import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

describe("release package", () => {
  it("declares stable public package metadata", async () => {
    const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    expect(manifest.name).toBe("@multileaf/ai-workflow");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.bin).toEqual({ aiw: "dist/cli.js" });
    expect(manifest.publishConfig).toEqual({ access: "public", provenance: true });
    expect(manifest.license).toBe("MIT");
    expect(manifest.files).toEqual([
      "dist",
      "resources",
      "docs",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
    ]);
  });

  it("keeps tests and fixtures out of the compiled distribution", async () => {
    const files = await readdir(resolve("dist"), { recursive: true });
    expect(files.some((path) => path.includes("fixtures"))).toBe(false);
    expect(files.some((path) => /\.test\.(?:js|d\.ts)$/.test(path))).toBe(false);
  });

  it("publishes tagged releases through a least-privilege provenance workflow", async () => {
    const workflow = await readFile(resolve(".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain('      - "v*.*.*"');
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("npm@11.5.1");
    expect(workflow).toContain("git merge-base --is-ancestor HEAD origin/main");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run release:check");
    expect(workflow).toContain('npm run release:publish-check -- --tag="$GITHUB_REF_NAME"');
    expect(workflow).toContain("npm publish --access public --provenance");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  });
});
