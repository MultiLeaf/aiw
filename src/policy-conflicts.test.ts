import { describe, expect, it } from "vitest";
import {
  applyAutomatedResult,
  resolvePolicy,
  strictnessOf,
  type PolicyRule,
} from "./policy-gate.js";

const rules: PolicyRule[] = [
  { id: "default", paths: ["*"], decision: "allow" },
  { id: "reviewed", paths: ["src/*"], decision: "require-approval" },
  {
    id: "auth-human",
    paths: ["src/auth/*"],
    decision: "require-approval",
    alwaysRequireHuman: true,
  },
  { id: "deny-experimental", paths: ["experimental/*"], decision: "deny" },
];

describe("policy conflict semantics (REQ-006)", () => {
  it("orders strictness deterministically", () => {
    expect(strictnessOf("allow")).toBeLessThan(strictnessOf("require-approval"));
    expect(strictnessOf("require-approval")).toBeLessThan(strictnessOf("always-require-human"));
    expect(strictnessOf("always-require-human")).toBeLessThan(strictnessOf("deny"));
  });

  it("lets the strictest matching rule win", () => {
    // src/auth/login.ts matches default (allow), reviewed (require-approval), and auth-human.
    const resolved = resolvePolicy(rules, "src/auth/login.ts");
    expect(resolved?.decision).toBe("always-require-human");
    expect(resolved?.matchedRules).toContain("auth-human");
    expect(resolved?.matchedRules).toContain("reviewed");
  });

  it("resolves equal strictness to the same decision", () => {
    const resolved = resolvePolicy(rules, "src/main.ts");
    expect(resolved?.decision).toBe("require-approval");
    // experimental/foo matches default (allow) and deny-experimental (deny).
    expect(resolvePolicy(rules, "experimental/foo.ts")?.decision).toBe("deny");
  });

  it("returns undefined when no rule matches", () => {
    const withoutDefault = rules.filter((rule) => rule.id !== "default");
    expect(resolvePolicy(withoutDefault, "docs/readme.md")).toBeUndefined();
  });

  it("never lets an automated result override always-require-human or deny", () => {
    const humanRequired = resolvePolicy(rules, "src/auth/login.ts")!;
    expect(applyAutomatedResult(humanRequired, "allow").decision).toBe("always-require-human");
    const denied = resolvePolicy(rules, "experimental/foo.ts")!;
    expect(applyAutomatedResult(denied, "allow").decision).toBe("deny");
  });

  it("caps automated results at require-approval", () => {
    const resolved = resolvePolicy(rules, "src/main.ts")!;
    expect(applyAutomatedResult(resolved, "allow").decision).toBe("allow");
    // A classifier claiming deny would itself be an automated escalation: capped.
    expect(applyAutomatedResult(resolved, "deny").decision).toBe("require-approval");
  });
});
