import { describe, expect, it } from "vitest";
import { loadBundledResources } from "./bundled-resources.js";
import { TARGETS } from "./types.js";

describe("bundled resources loader", () => {
  it.each(TARGETS)("loads all bundled resources with non-empty content for %s", (target) => {
    const resources = loadBundledResources(target);
    expect(resources.length).toBeGreaterThan(50);
    const skillIds = resources.filter((r) => r.type === "skills").map((r) => r.id);
    expect(skillIds).toContain("brainstorming");
    expect(skillIds).toContain("pr-submission");
    for (const resource of resources) {
      expect(resource.path.length).toBeGreaterThan(0);
      expect(resource.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("rejects unsupported targets clearly", () => {
    expect(() =>
      loadBundledResources("unsupported-target" as unknown as (typeof TARGETS)[number]),
    ).toThrow("do not support target: unsupported-target");
  });
});
