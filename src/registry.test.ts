import { describe, expect, it } from "vitest";
import { CURATED_REGISTRY, searchRegistry, serializeRegistry } from "./registry.js";

describe("curated package registry", () => {
  it("contains versioned entries with provider and permissions", () => {
    expect(CURATED_REGISTRY.every((pkg) => pkg.id && pkg.version && pkg.provider)).toBe(true);
    expect(searchRegistry("vercel")[0]?.permissions).toContain("network:external");
  });

  it("searches deterministically and serializes readable results", () => {
    expect(searchRegistry("react").map((pkg) => pkg.id)).toEqual(["vercel/react-best-practices"]);
    expect(serializeRegistry(searchRegistry("core"))).toContain("multileaf/aiw-self-hosting@0.1.0");
  });
});
