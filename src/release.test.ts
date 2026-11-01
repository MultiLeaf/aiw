import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { join, resolve } from "node:path";

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
    const outputDirectory = await mkdtemp(join(tmpdir(), "aiw-release-dist-"));
    try {
      const compile = spawnSync(
        execPath,
        [resolve("node_modules/typescript/bin/tsc"), "--outDir", outputDirectory],
        { cwd: resolve("."), encoding: "utf8" },
      );
      expect(compile.status, `${compile.stdout}\n${compile.stderr}`).toBe(0);

      const files = await readdir(outputDirectory, { recursive: true });
      expect(files.some((path) => path.includes("fixtures"))).toBe(false);
      expect(files.some((path) => /\.test\.(?:js|d\.ts)$/.test(path))).toBe(false);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("publishes tagged releases through a least-privilege provenance workflow", async () => {
    const workflow = await readFile(resolve(".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain('      - "v*.*.*"');
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("actions/setup-node@v5");
    expect(workflow).not.toContain("actions/checkout@v4");
    expect(workflow).not.toContain("actions/setup-node@v4");
    expect(workflow).toContain("npm@11.5.1");
    expect(workflow).toContain("git merge-base --is-ancestor HEAD origin/main");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run release:check");
    expect(workflow).toContain('npm run release:publish-check -- --tag="$TAG"');
    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("TAG: ${{ inputs.tag || github.ref_name }}");
    expect(workflow).toContain("ref: ${{ inputs.tag || github.ref }}");
    expect(workflow).toContain("npm publish --access public --provenance");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).toContain("github-release:");
    expect(workflow).toContain("needs: publish");
    expect(workflow).toContain("gh release create");
  });

  it("auto-tag invokes the release workflow directly (GITHUB_TOKEN events do not trigger workflows)", async () => {
    const autoTag = await readFile(resolve(".github/workflows/auto-tag.yml"), "utf8");
    expect(autoTag).toContain("uses: ./.github/workflows/release.yml");
    expect(autoTag).toContain("tag: ${{ needs.tag.outputs.tag }}");
    expect(autoTag).toContain("secrets: inherit");
    expect(autoTag).toContain("id-token: write");
    expect(autoTag).toContain('created=false" >> "$GITHUB_OUTPUT"');
    expect(autoTag).toContain('created=true" >> "$GITHUB_OUTPUT"');
    expect(autoTag).toContain("needs.tag.outputs.created == 'true'");
  });
});
