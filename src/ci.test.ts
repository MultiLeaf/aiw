import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("continuous integration", () => {
  it("runs the complete quality pipeline on pushes and pull requests", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("npm run policy:check");
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("actions/checkout@v5");
    expect(workflow).toContain("actions/setup-node@v5");
    expect(workflow).not.toContain("actions/checkout@v4");
    expect(workflow).not.toContain("actions/setup-node@v4");
    expect(workflow).toContain("cache: npm");
  });
});
