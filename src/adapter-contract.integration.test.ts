import { describe, expect, it } from "vitest";
import { describeResource, renderResourcePath } from "./adapter.js";
import { ADAPTER_CONTRACT_FIXTURES } from "./fixtures/adapter-contract.js";
import { RESOURCE_TYPES } from "./package-contract.js";
import { TARGETS } from "./types.js";

describe("adapter migration contract", () => {
  it.each(TARGETS)("renders a skill for %s", (target) => {
    const path = renderResourcePath(target, "skills", "example");
    expect(path).toContain("example");
    expect(path).toMatch(/SKILL\.md$/);
  });

  it.each(TARGETS)("renders every resource category for %s", (target) => {
    for (const type of ["skills", "rules", "agents", "hooks", "templates"] as const)
      expect(renderResourcePath(target, type, "example")).toContain("example");
  });

  it("uses the neutral fallback for unsupported platform-specific behavior", () => {
    expect(renderResourcePath("universal", "rules", "quality")).toMatch(/^\.aiw\/resources\//);
  });

  it.each(ADAPTER_CONTRACT_FIXTURES)(
    "$target renders the exact fixture paths and support levels",
    ({ target, resources }) => {
      for (const type of [...RESOURCE_TYPES, "context"] as const)
        expect(describeResource(target, type, "example")).toEqual(resources[type]);
    },
  );

  it("covers every target and degrades unsupported native concepts explicitly", () => {
    expect(ADAPTER_CONTRACT_FIXTURES.map(({ target }) => target)).toEqual(TARGETS);
    for (const fixture of ADAPTER_CONTRACT_FIXTURES) {
      const support = Object.values(fixture.resources).map((resource) => resource.support);
      if (fixture.target === "universal") expect(new Set(support)).toEqual(new Set(["fallback"]));
      else expect(support).not.toContain("fallback");
    }
  });

  it.each(TARGETS)("rejects an unsupported resource type for %s", (target) => {
    expect(() => describeResource(target, "unsupported" as "context", "example")).toThrow(
      /Unsupported/,
    );
  });
});
