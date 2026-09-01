import { describe, expect, it } from "vitest";
import { resolveProvider } from "./providers.js";

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

  it("rejects unsupported source protocols", () => {
    expect(() => resolveProvider("npm:example", "/project")).toThrow("Unsupported package source");
  });
});
