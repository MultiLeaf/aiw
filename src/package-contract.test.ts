import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validatePackageContract } from "./package-contract.js";

describe("package contract", () => {
  it("validates the self-hosting package contract", () => {
    const contract = validatePackageContract(readFileSync("resources/package.yaml", "utf8"));
    expect(contract.version).toBe("0.1.0");
    expect(contract.resources.skills.length).toBeGreaterThan(0);
    expect(contract.policies).toEqual([]);
    expect(contract.engines?.ai_workflow).toBeUndefined();
  });

  it("represents policies, engines, provenance, and every resource collection", () => {
    const contract = validatePackageContract(`schema: 1
id: demo
version: 1.0.0
provider: local
source: ./resources
engines:
  ai_workflow: ">=0.1.0"
dependencies: [base]
permissions: [filesystem:read]
provenance:
  source: registry
  checksum: abc
policies:
  - { id: safety, value: required }
resources:
  skills:
    - { id: skill, version: 1.0.0, path: skills/skill.md }
  rules: []
  agents: []
  hooks: []
  templates: []
`);
    expect(contract.policies).toEqual([{ id: "safety", value: "required" }]);
    expect(contract.provenance.checksum).toBe("abc");
    expect(contract.engines?.ai_workflow).toBeUndefined();
    expect(contract.resources.rules).toEqual([]);
  });

  it("rejects packages without provenance and permissions", () => {
    expect(() =>
      validatePackageContract(
        "schema: 1\nid: demo\nversion: 1.0.0\nprovider: local\nsource: .\nresources:\ndependencies: []\n",
      ),
    ).toThrow("permissions");
  });
});
