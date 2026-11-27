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

  it("parses, validates, and round-trips optional path rules (REQ-001)", () => {
    const withRules = `${content}rules:
  - id: auth-human
    paths: [src/auth/*]
    decision: require-approval
    always-require-human: true
  - id: docs-allow
    paths: [docs/*]
    decision: allow
`;
    const policy = parseOrganizationPolicy(withRules);
    expect(policy.rules).toHaveLength(2);
    expect(policy.rules?.[0]).toMatchObject({
      id: "auth-human",
      paths: ["src/auth/*"],
      decision: "always-require-human",
      alwaysRequireHuman: true,
    });
    // Round-trip.
    const roundTripped = parseOrganizationPolicy(serializeOrganizationPolicy(policy));
    expect(roundTripped.rules).toEqual(policy.rules);
    // Flat behavior unchanged without rules.
    const flat = parseOrganizationPolicy(content);
    expect(flat.rules).toBeUndefined();
    expect(serializeOrganizationPolicy(flat)).toBe(
      serializeOrganizationPolicy(parseOrganizationPolicy(content)),
    );
  });

  it("rejects invalid rules with actionable errors (REQ-001)", () => {
    expect(() =>
      parseOrganizationPolicy(
        `${content}rules:\n  - id: bad\n    paths: [src/*]\n    decision: maybe\n`,
      ),
    ).toThrow("invalid decision: maybe");
    expect(() =>
      parseOrganizationPolicy(
        `${content}rules:\n  - id: dup\n    paths: [a/*]\n    decision: allow\n  - id: dup\n    paths: [b/*]\n    decision: deny\n`,
      ),
    ).toThrow("duplicated: dup");
    expect(() =>
      parseOrganizationPolicy(`${content}rules:\n  - id: no-paths\n    decision: allow\n`),
    ).toThrow("non-empty paths list");
    expect(() =>
      parseOrganizationPolicy(
        `${content}rules:\n${Array.from({ length: 65 }, (_, i) => `  - id: r${i}\n    paths: [p${i}]\n    decision: allow\n`).join("")}`,
      ),
    ).toThrow("cannot exceed 64 rules");
    expect(() => parseOrganizationPolicy(`${content}rules: [not, a, block]\n`)).toThrow(
      "rules must be a block list",
    );
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
    for (const name of ["", '""', '"   "', "'   '"])
      expect(() =>
        parseOrganizationPolicy(content.replace("name: Multileaf", `name: ${name}`)),
      ).toThrow("name is required");
  });
});
