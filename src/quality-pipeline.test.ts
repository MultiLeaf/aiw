import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("quality pipeline", () => {
  it("includes formatting, linting, build, tests, and security checks", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.check).toContain("format:check");
    expect(packageJson.scripts.check).toContain("lint");
    expect(packageJson.scripts.check).toContain("typecheck");
    expect(packageJson.scripts.check).toContain("build");
    expect(packageJson.scripts.check).toContain("test");
    expect(packageJson.scripts.check).toContain("security:check");
    expect(packageJson.scripts["security:check"]).toContain("npm audit");
  });
});
