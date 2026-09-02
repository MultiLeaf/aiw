import { describe, expect, it } from "vitest";
import { compareVersions, planPackageUpdate } from "./package-updates.js";
import type { PackageContract } from "./package-contract.js";

const pkg = (version: string, targets?: string[]): PackageContract =>
  ({
    schema: 1,
    id: "demo/package",
    version,
    provider: "local",
    source: "./package",
    resources: {
      skills: [{ id: "skill", version, path: "skill.md" }],
      rules: [],
      agents: [],
      hooks: [],
      templates: [],
    },
    dependencies: [],
    permissions: [],
    provenance: { source: "./package" },
    ...(targets ? { targets } : {}),
  }) as PackageContract;

describe("package update planning", () => {
  it("compares semantic versions", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
  });
  it("rejects unsupported targets and reports dependency conflicts", () => {
    expect(planPackageUpdate(undefined, pkg("2.0.0", ["claude"]), "codex").status).toBe(
      "incompatible",
    );
    const candidate = { ...pkg("2.0.0"), dependencies: ["demo/base"] };
    expect(
      planPackageUpdate(undefined, candidate, "codex", new Map([["demo/base", "1.0.0"]])).status,
    ).toBe("conflict");
  });
  it("plans only newer versions", () => {
    expect(
      planPackageUpdate({ id: "demo/package", version: "2.0.0" }, pkg("1.0.0"), "codex").status,
    ).toBe("current");
    expect(
      planPackageUpdate({ id: "demo/package", version: "1.0.0" }, pkg("2.0.0"), "codex").status,
    ).toBe("update");
  });
});
