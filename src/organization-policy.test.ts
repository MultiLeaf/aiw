import { describe, expect, it } from "vitest";
import {
  enforceOrganizationPolicy,
  parseOrganizationPolicy,
  serializeOrganizationPolicy,
} from "./organization-policy.js";

const content =
  "schema: 1\nname: Multileaf\napproved_sources: [git:https://github.com/MultiLeaf/*, local:/project/packages/*]\ndenied_permissions: [process:execute]\n";

describe("organization policy", () => {
  it("parses and serializes a deterministic versioned policy", () => {
    const policy = parseOrganizationPolicy(content);
    expect(serializeOrganizationPolicy(policy)).toBe(content);
  });

  it("allows approved sources and rejects sources or permissions outside policy", () => {
    const policy = parseOrganizationPolicy(content);
    expect(() =>
      enforceOrganizationPolicy(policy, {
        provider: "git",
        source: "https://github.com/MultiLeaf/skills.git",
        permissions: ["filesystem:read"],
      }),
    ).not.toThrow();
    expect(() =>
      enforceOrganizationPolicy(policy, {
        provider: "git",
        source: "https://example.com/untrusted.git",
        permissions: [],
      }),
    ).toThrow("not approved");
    expect(() =>
      enforceOrganizationPolicy(policy, {
        provider: "local",
        source: "/project/packages/private",
        permissions: ["process:execute"],
      }),
    ).toThrow("denied by Multileaf");
  });

  it("rejects invalid or empty policies", () => {
    expect(() => parseOrganizationPolicy(content.replace("schema: 1", "schema: 2"))).toThrow(
      "version 1",
    );
    expect(() => parseOrganizationPolicy(content.replace(/\[[^\]]+\]/, "[]"))).toThrow(
      "approved_sources",
    );
  });
});
