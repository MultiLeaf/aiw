import { describe, expect, it } from "vitest";
import { enforcePolicyGate } from "./policy-gate.js";

const policy = {
  schema: 1 as const,
  name: "Engineering",
  approvedSources: ["local:./resources", "private-registry:https://registry.example.test"],
  deniedPermissions: ["process:execute"],
};

describe("policy gate", () => {
  it("accepts approved package, lock, and registry subjects", () => {
    expect(() =>
      enforcePolicyGate(policy, [
        { provider: "local", source: "./resources", permissions: [] },
        {
          provider: "private-registry",
          source: "https://registry.example.test",
          permissions: ["network:external"],
        },
      ]),
    ).not.toThrow();
  });

  it("rejects unapproved sources and denied permissions", () => {
    expect(() =>
      enforcePolicyGate(policy, [
        { provider: "git", source: "https://other.test/x", permissions: [] },
      ]),
    ).toThrow("not approved");
    expect(() =>
      enforcePolicyGate(policy, [
        { provider: "local", source: "./resources", permissions: ["process:execute"] },
      ]),
    ).toThrow("denied");
  });
});
