import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("CLI package entrypoint", () => {
  it("supports the npm bin name used by node_modules/.bin", () => {
    expect(readFileSync("src/cli.ts", "utf8")).toContain('process.argv[1]?.endsWith("/aiw")');
  });

  it("initializes lock packages as a valid multiline YAML list", () => {
    expect(readFileSync("src/workflow.ts", "utf8")).toContain('"schema: 1\\npackages:\\n"');
  });
});
