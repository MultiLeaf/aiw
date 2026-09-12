import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validatePackageContract } from "./package-contract.js";

describe("package contract", () => {
  it("validates the self-hosting package contract", () => {
    const contract = validatePackageContract(readFileSync("resources/package.yaml", "utf8"));
    expect(contract.version).toBe("0.1.0");
    expect(contract.resources.skills.length).toBeGreaterThan(0);
    expect(contract.policies).toEqual([]);
    expect(contract.engines?.ai_workflow).toBe(">=0.1.0");
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
    expect(contract.engines?.ai_workflow).toBe(">=0.1.0");
    expect(contract.resources.rules).toEqual([]);
  });

  it.each(["id", "version", "path"])("rejects a resource without %s", (missing) => {
    const resource = { id: "skill", version: "1.0.0", path: "skills/skill.md" };
    delete resource[missing as keyof typeof resource];
    expect(() =>
      validatePackageContract(
        `schema: 1\nid: demo\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { ${Object.entries(
          resource,
        )
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ")} }\n`,
      ),
    ).toThrow("resources.skills[0]");
  });

  it("rejects incomplete package structure rather than returning a partial contract", () => {
    expect(() =>
      validatePackageContract(
        "schema: 1\nid: demo\nversion: 1.0.0\nprovider: local\nsource: .\nresources: {}\ndependencies: []\n",
      ),
    ).toThrow("resource section 'skills' is required");
  });

  it("rejects duplicate YAML keys, unknown fields, and escaping resource paths", () => {
    const valid = `schema: 1\nid: demo\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: skill, version: 1.0.0, path: skill.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
    expect(() =>
      validatePackageContract(valid.replace("id: demo", "id: demo\nid: duplicate")),
    ).toThrow("YAML is invalid");
    expect(() =>
      validatePackageContract(valid.replace("id: demo", "id: demo\nextra: value")),
    ).toThrow("not supported");
    expect(() =>
      validatePackageContract(valid.replace("path: skill.md", "path: ../outside.md")),
    ).toThrow("normalized relative path");
  });
});
