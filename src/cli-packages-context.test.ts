import { describe, expect, it } from "vitest";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./cli.js";
import { checksumPackage } from "./package-integrity.js";
import type { LoadedPackageSource } from "./providers.js";
import { advanceWorkflowTo, project } from "./fixtures/cli-test-helpers.js";

describe("AI Workflow CLI — packages, policy, and context", () => {
  it("validates the package contract through the CLI", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const { copyFile } = await import("node:fs/promises");
    await copyFile(join(process.cwd(), "resources/package.yaml"), join(cwd, "package.yaml"));
    const result = await run(["validate", "--package=package.yaml"], cwd);
    expect(result.exitCode).toBe(0);
  });

  it("lists and searches the curated package registry", async () => {
    const all = await run(["registry"], await project());
    expect(all.exitCode).toBe(0);
    expect(all.output).toContain("multileaf/aiw-self-hosting@0.1.0");
    const result = await run(["registry", "--search=react"], await project());
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("vercel/react-best-practices@latest");
    expect(result.output).toContain("permissions: network:external");
    expect(result.output).not.toContain("multileaf/aiw-self-hosting");
  });

  it("verifies a package checksum through the CLI", async () => {
    const cwd = await project();
    const packagePath = join(cwd, "package.yaml");
    const content = "schema: 1\ntrusted: package\n";
    await writeFile(packagePath, content);
    const verified = await run(
      ["verify-package", "--package=package.yaml", `--checksum=${checksumPackage(content)}`],
      cwd,
    );
    expect(verified.exitCode).toBe(0);
    const rejected = await run(["verify-package", "--package=package.yaml", "--checksum=bad"], cwd);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.error).toContain("checksum mismatch");
  });

  it("stores and composes layered project context", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    expect(
      (await run(["context", "--layer=project", "--content=Project conventions"], cwd)).exitCode,
    ).toBe(0);
    expect((await run(["context", "--layer=task", "--content=Current task"], cwd)).exitCode).toBe(
      0,
    );
    const result = await run(["context"], cwd);
    expect(result.output).toContain("# project context");
    expect(result.output).toContain("Project conventions");
    expect(result.output).toContain("# task context");
    const task = await run(["context", "--task"], cwd);
    expect(task.output).toContain("Current task");
    expect(task.output).not.toContain("# session context");
    const delta = await run(["context", "--delta-from=global"], cwd);
    expect(delta.output).toContain("Project conventions");
    expect(delta.output).toContain("Current task");
    expect(delta.output).not.toContain("session");
    expect(delta.output).not.toContain("# global context");
  });

  it("invalidates stale context summaries", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await run(["context", "--layer=project", "--content=Original context"], cwd);
    expect((await run(["context-summary", "--summary=Original summary"], cwd)).output).toBe(
      "Original summary",
    );
    expect((await run(["context-summary", "--summary=Ignored while fresh"], cwd)).output).toBe(
      "Original summary",
    );
    await run(["context", "--layer=project", "--content=Changed context"], cwd);
    expect((await run(["context-summary", "--summary=Updated summary"], cwd)).output).toBe(
      "Updated summary",
    );
  });

  it("records and reports per-stage token usage", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const recorded = await run(["token-usage", "--stage=scan", "--budget=100", "--used=75"], cwd);
    expect(recorded).toEqual({ exitCode: 0, output: "Token usage recorded: scan (75/100)" });
    const report = await run(["token-usage"], cwd);
    expect(report.output).toContain("scan|100|75");
    expect(
      (await run(["token-usage", "--stage=scan", "--budget=10", "--used=11"], cwd)).error,
    ).toContain("Token budget exceeded");
  });

  it("runs self-validation and records generated-output evidence", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await advanceWorkflowTo(cwd, "brainstorming");
    await run(["brainstorm"], cwd);
    const calls: string[][] = [];
    const result = await run(["self-validate", "--ticket=FND-009"], cwd, {
      selfValidation: {
        execute: async (command): Promise<{ stdout: string; exitCode: number }> => {
          calls.push(command);
          return { stdout: "checks passed", exitCode: 0 };
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([["npm", "--prefix", cwd, "run", "check"]]);
    const evidence = await readFile(
      join(cwd, ".aiw/checkpoints/self-validation-fnd-009.yml"),
      "utf8",
    );
    expect(evidence).toContain("ticket: FND-009");
    expect(evidence).toContain("generated/specs/test-workflow/brainstorm.md");
    expect(evidence).toContain("result: pass");
  });

  it("reports deterministic context quality metrics", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await run(["context", "--layer=project", "--content=Shared line\nProject line"], cwd);
    await run(["context", "--layer=task", "--content=Shared line"], cwd);
    const result = await run(["context-quality"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("non_empty_layers: 2");
    expect(result.output).toContain("duplicate_lines: 1");
    expect(result.output).toBe((await run(["context-quality"], cwd)).output);
  });

  it("reports adapter capabilities through the CLI", async () => {
    const result = await run(["capabilities", "--target=codex"], await project());
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("resources: [skills, rules, agents, hooks, templates]");
    expect(result.output).toContain("events: [install, update, remove, validate]");
  });

  it("resolves a package and generates an exact lockfile", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await cp(join(process.cwd(), "resources"), join(cwd, "resources"), { recursive: true });
    const result = await run(["resolve", "--package=resources/package.yaml"], cwd);

    expect(result.exitCode).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("id: multileaf/aiw-self-hosting");
    expect(lock).toMatch(/integrity: sha256-[a-f0-9]{64}/);
  });

  it("resolves a package from a local provider source", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packageRoot = join(cwd, "local-package");
    await mkdir(join(packageRoot, "skills/example"), { recursive: true });
    await writeFile(join(packageRoot, "skills/example/SKILL.md"), "# Example\n");
    await writeFile(
      join(packageRoot, "package.yaml"),
      "schema: 1\nid: example/local\nversion: 1.0.0\nprovider: placeholder\nsource: placeholder\ndependencies: []\npermissions: []\nprovenance:\n  source: placeholder\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );
    const result = await run(["resolve", "--source=./local-package"], cwd);
    expect(result.exitCode).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("provider: local");
    expect(lock).toContain(`source: ${packageRoot}`);
  });

  it("merges resolved packages and leaves the lock untouched when it is malformed", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const manifest = (id: string, file: string): string =>
      `schema: 1\nid: ${id}\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: []\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: skill, version: 1.0.0, path: ${file} }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
    await writeFile(join(cwd, "a.md"), "A\n");
    await writeFile(join(cwd, "b.md"), "B\n");
    await writeFile(join(cwd, "a.yaml"), manifest("demo/a", "a.md"));
    await writeFile(join(cwd, "b.yaml"), manifest("demo/b", "b.md"));
    expect((await run(["resolve", "--package=a.yaml"], cwd)).exitCode).toBe(0);
    const original = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect((await run(["resolve", "--package=b.yaml"], cwd)).exitCode).toBe(0);
    const merged = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(merged).toContain("id: demo/a");
    expect(merged).toContain("id: demo/b");
    expect(merged).toContain(original.match(/integrity: [^\n]+/)?.[0] ?? "missing-integrity");

    await writeFile(join(cwd, ".aiw/lock.yml"), "broken lock\n");
    const malformed = await run(["resolve", "--package=a.yaml"], cwd);
    expect(malformed.exitCode).toBe(1);
    expect(await readFile(join(cwd, ".aiw/lock.yml"), "utf8")).toBe("broken lock\n");
  });

  it("requires network approval before loading remote sources and still checks manifest permissions", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packageRoot = join(cwd, "remote-package");
    await mkdir(join(packageRoot, "skills/example"), { recursive: true });
    await writeFile(join(packageRoot, "skills/example/SKILL.md"), "# Example\n");
    let loads = 0;
    let releases = 0;
    const source = "git+https://example.test/package.git";
    const services = {
      packageSources: {
        load: (requestedSource: string): LoadedPackageSource => {
          loads += 1;
          return {
            provider: "git" as const,
            source: requestedSource,
            root: packageRoot,
            manifest:
              "schema: 1\nid: example/remote\nversion: 1.0.0\nprovider: placeholder\nsource: placeholder\ndependencies: []\npermissions: [process:execute]\nprovenance:\n  source: placeholder\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
            release: (): void => {
              releases += 1;
            },
          };
        },
      },
    };

    const deniedBeforeLoad = await run(["resolve", `--source=${source}`], cwd, services);
    expect(deniedBeforeLoad.exitCode).toBe(1);
    expect(deniedBeforeLoad.error).toContain("network:external");
    expect(loads).toBe(0);

    const deniedManifestPermission = await run(
      ["resolve", `--source=${source}`, "--allow=network:external"],
      cwd,
      services,
    );
    expect(deniedManifestPermission.error).toContain("process:execute");
    expect(loads).toBe(1);
    expect(releases).toBe(1);

    const approved = await run(
      ["resolve", `--source=${source}`, "--allow=network:external", "--allow=process:execute"],
      cwd,
      services,
    );
    expect(approved.exitCode).toBe(0);
    expect(loads).toBe(2);
    expect(releases).toBe(2);
  });

  it("does not require network consent for a local file Git source", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packageRoot = join(cwd, "file-package");
    await mkdir(join(packageRoot, "skills/example"), { recursive: true });
    await writeFile(join(packageRoot, "skills/example/SKILL.md"), "# Example\n");
    let loads = 0;
    const result = await run(["resolve", `--source=file://${packageRoot}`], cwd, {
      packageSources: {
        load: (source: string): LoadedPackageSource => {
          loads += 1;
          return {
            provider: "git",
            source,
            root: packageRoot,
            manifest:
              "schema: 1\nid: example/file\nversion: 1.0.0\nprovider: placeholder\nsource: placeholder\ndependencies: []\npermissions: []\nprovenance:\n  source: placeholder\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skills/example/SKILL.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
            release: (): void => {},
          };
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(loads).toBe(1);
  });

  it("enforces organization network denials before loading an approved remote source", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, "organization.yml"),
      "schema: 1\nname: Example Org\napproved_sources: [git:git+https://example.test/package.git]\ndenied_permissions: [network:external]\n",
    );
    await run(["organization-policy", "--file=organization.yml"], cwd);
    let loads = 0;

    const result = await run(
      ["resolve", "--source=git+https://example.test/package.git", "--allow=network:external"],
      cwd,
      {
        packageSources: {
          load: (): never => {
            loads += 1;
            throw new Error("Source loader must not run when organization policy denies network.");
          },
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("denied by Example Org: network:external");
    expect(loads).toBe(0);
  });

  it("audits package permissions and rejects unknown permissions atomically", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const packagePath = join(cwd, "package.yaml");
    const contract = (permissions: string): string =>
      `schema: 1\nid: example/audited\nversion: 1.0.0\nprovider: local\nsource: .\ndependencies: []\npermissions: [${permissions}]\nprovenance:\n  source: .\nresources:\n  skills:\n    - { id: example, version: 1.0.0, path: skill.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n`;
    await writeFile(packagePath, contract("filesystem:read, process:execute"));
    const audit = await run(["audit-package", "--package=package.yaml"], cwd);
    expect(audit.output).toContain("filesystem:read (low)");
    expect(audit.output).toContain("process:execute (critical)");
    const lockPath = join(cwd, ".aiw/lock.yml");
    const before = await readFile(lockPath, "utf8");
    await writeFile(packagePath, contract("system:root"));
    const rejected = await run(["resolve", "--package=package.yaml", "--allow=system:root"], cwd);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.error).toContain("Unknown package permissions: system:root");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(before);
  });

  it("enforces organization-approved package sources before external execution", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const policyPath = join(cwd, "organization.yml");
    await writeFile(
      policyPath,
      "schema: 1\nname: Example Org\napproved_sources: [vercel-skills:approved/*, local:./approved/*]\ndenied_permissions: [process:execute]\n",
    );
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).output).toContain(
      "Example Org",
    );
    const persisted = await readFile(join(cwd, ".aiw/organization.yml"), "utf8");
    await writeFile(
      policyPath,
      'schema: 1\nname: "   "\napproved_sources: [local:*]\ndenied_permissions: []\n',
    );
    const invalidReplacement = await run(
      ["organization-policy", "--file=organization.yml", "--replace"],
      cwd,
    );
    expect(invalidReplacement.error).toContain("name is required");
    await expect(readFile(join(cwd, ".aiw/organization.yml"), "utf8")).resolves.toBe(persisted);
    let calls = 0;
    const blocked = await run(
      [
        "skills",
        "install",
        "--source=untrusted/repository",
        "--skill=unsafe",
        "--allow=network:external",
      ],
      cwd,
      {
        externalSkills: {
          execute: async (): Promise<{ stdout: string; exitCode: number }> => {
            calls += 1;
            return { stdout: "installed", exitCode: 0 };
          },
        },
      },
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("not approved by Example Org");
    expect(calls).toBe(0);
    let loads = 0;
    const blockedGit = await run(
      ["resolve", "--source=git+https://example.test/untrusted.git"],
      cwd,
      {
        packageSources: {
          load: () => {
            loads += 1;
            throw new Error("Loader must not be called");
          },
        },
      },
    );
    expect(blockedGit.error).toContain("not approved by Example Org");
    expect(loads).toBe(0);
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).error).toContain(
      "--replace",
    );
    await expect(readFile(join(cwd, ".aiw/organization.yml"), "utf8")).resolves.toBe(persisted);
  });

  it("installs deterministic team presets and private registry references safely", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    await writeFile(
      join(cwd, "preset.yml"),
      "schema: 1\nname: Platform defaults\npackages: [team/testing@^1.0.0, team/lint@2.0.0]\nregistries: [engineering]\n",
    );
    await writeFile(
      join(cwd, "registries.yml"),
      "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test/aiw, token_env: AIW_ENGINEERING_TOKEN }\n",
    );

    expect((await run(["preset", "--file=preset.yml"], cwd)).exitCode).toBe(0);
    expect((await run(["registry", "configure", "--file=registries.yml"], cwd)).exitCode).toBe(0);
    const preset = await readFile(join(cwd, ".aiw/team-preset.yml"), "utf8");
    const registries = await readFile(join(cwd, ".aiw/registries.yml"), "utf8");
    expect(preset).toContain("packages: [team/lint@2.0.0, team/testing@^1.0.0]");
    expect(registries).toContain("token_env: AIW_ENGINEERING_TOKEN");
    expect(registries).not.toContain("secret");
    await writeFile(
      join(cwd, "organization.yml"),
      "schema: 1\nname: Example Org\napproved_sources: [private-registry:https://registry.example.test/aiw]\ndenied_permissions: []\n",
    );
    expect((await run(["organization-policy", "--file=organization.yml"], cwd)).exitCode).toBe(0);

    let receivedToken = "";
    const privateSearch = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      {
        environment: { AIW_ENGINEERING_TOKEN: "runtime-secret" },
        privateRegistries: {
          search: async (_registry, query, token) => {
            expect(query).toBe("quality");
            receivedToken = token;
            return [
              {
                id: "team/quality",
                version: "1.2.0",
                description: "Team quality defaults.",
                permissions: ["filesystem:read"],
              },
            ];
          },
        },
      },
    );
    expect(privateSearch.output).toContain("team/quality@1.2.0 [private-registry]");
    expect(privateSearch.output).not.toContain("runtime-secret");
    expect(receivedToken).toBe("runtime-secret");
    const leakingFailure = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      {
        environment: { AIW_ENGINEERING_TOKEN: "runtime-secret" },
        privateRegistries: {
          search: async () => {
            throw new Error("transport leaked runtime-secret");
          },
        },
      },
    );
    expect(leakingFailure.error).toContain("[REDACTED]");
    expect(leakingFailure.error).not.toContain("runtime-secret");
    const leakingPayload = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      {
        environment: { AIW_ENGINEERING_TOKEN: "runtime-secret" },
        privateRegistries: {
          search: async () => [
            {
              id: "team/quality",
              version: "1.2.0",
              description: "runtime-secret",
              permissions: [],
            },
          ],
        },
      },
    );
    expect(leakingPayload.exitCode).toBe(1);
    expect(leakingPayload.error).not.toContain("runtime-secret");
    for (const escapedToken of ['runtime-"secret', "runtime-\\secret"]) {
      const escapedPayload = await run(
        ["registry", "--private=engineering", "--search=quality"],
        cwd,
        {
          environment: { AIW_ENGINEERING_TOKEN: escapedToken },
          privateRegistries: {
            search: async () => [
              {
                id: "team/quality",
                version: "1.2.0",
                description: escapedToken,
                permissions: [],
              },
            ],
          },
        },
      );
      expect(escapedPayload.exitCode).toBe(1);
      expect(escapedPayload.error).not.toContain(escapedToken);
    }
    const missingCredential = await run(
      ["registry", "--private=engineering", "--search=quality"],
      cwd,
      { environment: {} },
    );
    expect(missingCredential.error).toContain("AIW_ENGINEERING_TOKEN");

    expect((await run(["preset", "--file=preset.yml"], cwd)).error).toContain("--replace");
    await writeFile(
      join(cwd, "registries.yml"),
      "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test, token: secret }\n",
    );
    const rejected = await run(
      ["registry", "configure", "--file=registries.yml", "--replace"],
      cwd,
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.error).toContain("token_env");
    await expect(readFile(join(cwd, ".aiw/registries.yml"), "utf8")).resolves.toBe(registries);
    await writeFile(
      join(cwd, "registries.yml"),
      "schema: 1\nregistries:\n  - { name: replacement, url: https://registry.example.test, token_env: AIW_TOKEN }\n  - malformed-entry\n",
    );
    expect(
      (await run(["registry", "configure", "--file=registries.yml", "--replace"], cwd)).exitCode,
    ).toBe(1);
    await expect(readFile(join(cwd, ".aiw/registries.yml"), "utf8")).resolves.toBe(registries);
    await writeFile(
      join(cwd, ".aiw/registries.yml"),
      "schema: 1\nregistries:\n  - { name: engineering, url: https://user:secret@registry.example.test, token_env: AIW_TOKEN }\n",
    );
    const unhealthy = await run(["doctor"], cwd);
    expect(unhealthy.exitCode).toBe(1);
    expect(unhealthy.error).not.toContain("secret");
  });

  it("updates a package only when the candidate is newer and compatible", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const packagePath = join(cwd, "package.yaml");
    const packageContent = (version: string): string => `schema: 1
id: demo/package
version: ${version}
provider: local
source: ./package
dependencies: []
permissions: []
provenance:
  source: ./package
resources:
  skills:
    - { id: demo-skill, version: ${version}, path: skill.md }
  rules: []
  agents: []
  hooks: []
  templates: []
`;
    await writeFile(packagePath, packageContent("1.0.0"));
    await writeFile(join(cwd, "skill.md"), "# Demo skill\n");
    await run(["resolve", "--package=package.yaml"], cwd);
    const lockedV1 = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    await writeFile(join(cwd, "skill.md"), "# Edited without a version change\n");
    const tampered = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(tampered.exitCode).toBe(1);
    expect(tampered.error).toContain("integrity mismatch");
    expect(await readFile(join(cwd, ".aiw/lock.yml"), "utf8")).toBe(lockedV1);
    await writeFile(join(cwd, "skill.md"), "# Demo skill\n");
    await writeFile(packagePath, packageContent("2.0.0"));
    const updated = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(updated.exitCode).toBe(0);
    expect(updated.output).toContain("demo/package@2.0.0");
    await expect(readFile(join(cwd, ".aiw/lock.yml"), "utf8")).resolves.toContain("version: 2.0.0");
    const current = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(current.exitCode).toBe(1);
    expect(current.error).toContain("already at 2.0.0");

    await writeFile(packagePath, packageContent("3.0.0"));
    const unsupported = await run(
      ["update", "--package=package.yaml", "--target=unsupported"],
      cwd,
    );
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.error).toContain("Unsupported target");

    await writeFile(
      packagePath,
      packageContent("3.0.0").replace("dependencies: []", "dependencies: [demo/base]"),
    );
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `${await readFile(join(cwd, ".aiw/lock.yml"), "utf8")}  - id: demo/base\n    version: 1.0.0\n    provider: local\n    source: ./base\n    integrity: sha256-${"b".repeat(64)}\n`,
    );
    const conflict = await run(["update", "--package=package.yaml", "--target=codex"], cwd);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.error).toContain("incompatible");
  });

  it("preserves unrelated lock permissions while updating a package", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `schema: 1\npackages:\n  - id: demo/package\n    version: 1.0.0\n    provider: local\n    source: ./package\n    integrity: sha256-${"a".repeat(64)}\n    permissions: []\n  - id: unrelated/package\n    version: 1.0.0\n    provider: local\n    source: ./unrelated\n    integrity: sha256-${"b".repeat(64)}\n    permissions: [filesystem:read, network:external]\n`,
    );
    await writeFile(
      join(cwd, "package.yaml"),
      "schema: 1\nid: demo/package\nversion: 2.0.0\nprovider: local\nsource: ./package\ndependencies: []\npermissions: []\nprovenance:\n  source: ./package\nresources:\n  skills:\n    - { id: demo-skill, version: 2.0.0, path: skill.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );
    await writeFile(join(cwd, "skill.md"), "# Demo skill\n");

    expect((await run(["update", "--package=package.yaml", "--target=codex"], cwd)).exitCode).toBe(
      0,
    );
    expect(await readFile(join(cwd, ".aiw/lock.yml"), "utf8")).toContain(
      "permissions: [filesystem:read, network:external]",
    );
  });

  it("enforces the configured organization policy as a CI gate", async () => {
    const cwd = await project();
    const services = { policyTracking: { isTracked: (): boolean => true } };
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw/organization.yml"),
      "schema: 1\nname: Engineering\napproved_sources: [local:./resources]\ndenied_permissions: [process:execute]\n",
    );
    await writeFile(
      join(cwd, "package.yaml"),
      "schema: 1\nid: team/base\nversion: 1.0.0\nprovider: local\nsource: ./resources\ndependencies: []\npermissions: []\nprovenance:\n  source: ./resources\nresources:\n  skills:\n    - { id: base, version: 1.0.0, path: skills/base.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );

    expect((await run(["policy-check", "--package=package.yaml"], cwd, services)).exitCode).toBe(0);
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `schema: 1\npackages:\n  - id: unknown/package\n    version: 1.0.0\n    provider: git\n    source: https://unapproved.example.test/package.git\n    integrity: sha256-${"c".repeat(64)}\n`,
    );
    const unapprovedLock = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(unapprovedLock.exitCode).toBe(1);
    expect(unapprovedLock.error).toContain("not approved");
    await writeFile(
      join(cwd, ".aiw/lock.yml"),
      `schema: 1\npackages:\n  - id: unknown/package\n    version: 1.0.0\n    provider: local\n    source: ./resources\n    integrity: sha256-${"d".repeat(64)}\n    permissions: [process:execute]\n`,
    );
    const deniedLock = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(deniedLock.exitCode).toBe(1);
    expect(deniedLock.error).toContain("denied by Engineering");
    await writeFile(join(cwd, ".aiw/lock.yml"), "schema: 1\npackages:\n");
    await writeFile(
      join(cwd, "package.yaml"),
      (await readFile(join(cwd, "package.yaml"), "utf8")).replace(
        "permissions: []",
        "permissions: [process:execute]",
      ),
    );
    const denied = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(denied.exitCode).toBe(1);
    expect(denied.error).toContain("denied by Engineering");
  });

  it("records an externally installed Vercel skill in the AIW lockfile", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cwd, "skills-lock.json"),
      '{"skills":{"vercel-react-best-practices":{"computedHash":"hash-123"}}}',
    );
    const calls: string[][] = [];
    const blocked = await run(["generate", "--select=react-best-practices"], cwd, {
      externalSkills: {
        execute: async () => ({ stdout: "installed", exitCode: 0 }),
      },
    });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("network:external");
    const result = await run(
      ["generate", "--select=react-best-practices", "--allow=network:external"],
      cwd,
      {
        externalSkills: {
          execute: async (command) => {
            calls.push(command);
            return { stdout: "installed", exitCode: 0 };
          },
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toContain("vercel-labs/agent-skills@vercel-react-best-practices");
    await expect(readFile(join(cwd, ".aiw/lock.yml"), "utf8")).resolves.toContain(
      "integrity: hash-123",
    );
  });

  it.each(["check", "update"])(
    "enforces organization policy before skills %s accesses an external provider",
    async (action) => {
      const cwd = await project();
      await run(["install", "--target", "codex"], cwd);
      await writeFile(
        join(cwd, ".aiw/organization.yml"),
        "schema: 1\nname: Engineering\napproved_sources: [vercel-skills:vercel-labs/agent-skills]\ndenied_permissions: [network:external]\n",
      );
      await writeFile(
        join(cwd, ".aiw/lock.yml"),
        "schema: 1\npackages:\n  - id: vercel-labs/agent-skills/react-best-practices\n    version: latest\n    provider: vercel-skills\n    source: vercel-labs/agent-skills\n    integrity: hash-v1\n    permissions: [network:external]\n",
      );
      let calls = 0;
      const result = await run(["skills", action, "--allow=network:external"], cwd, {
        externalSkills: {
          execute: async () => {
            calls += 1;
            return { stdout: "completed", exitCode: 0 };
          },
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("denied by Engineering");
      expect(calls).toBe(0);
    },
  );

  it("searches, inspects, installs, and updates Vercel skills through AIW", async () => {
    const cwd = await project();
    await run(["install", "--target", "codex"], cwd);
    const calls: string[][] = [];
    const services = {
      externalSkills: {
        execute: async (command: string[]): Promise<{ stdout: string; exitCode: number }> => {
          calls.push(command);
          return { stdout: command.includes("find") ? "react result" : "completed", exitCode: 0 };
        },
      },
    };
    expect((await run(["skills", "search", "--query=react"], cwd, services)).output).toBe(
      "react result",
    );
    expect(
      (await run(["skills", "inspect", "--source=vercel-labs/agent-skills"], cwd, services))
        .exitCode,
    ).toBe(0);
    await writeFile(
      join(cwd, "skills-lock.json"),
      '{"skills":{"react-best-practices":{"computedHash":"hash-v1"}}}',
    );
    const installed = await run(
      [
        "skills",
        "install",
        "--source=vercel-labs/agent-skills",
        "--skill=react-best-practices",
        "--allow=network:external",
      ],
      cwd,
      services,
    );
    expect(installed.exitCode).toBe(0);
    await expect(readFile(join(cwd, ".aiw/lock.yml"), "utf8")).resolves.toContain(
      "integrity: hash-v1",
    );
    await writeFile(
      join(cwd, "skills-lock.json"),
      '{"skills":{"react-best-practices":{"computedHash":"hash-v2"}}}',
    );
    expect(
      (await run(["skills", "update", "--allow=network:external"], cwd, services)).exitCode,
    ).toBe(0);
    const lock = await readFile(join(cwd, ".aiw/lock.yml"), "utf8");
    expect(lock).toContain("provider: vercel-skills");
    expect(lock).toContain("integrity: hash-v2");
    expect(calls).toContainEqual(["npx", "skills", "find", "react"]);
    expect(calls).toContainEqual(["npx", "skills", "add", "vercel-labs/agent-skills", "--list"]);
    expect(calls).toContainEqual(["npx", "skills", "update"]);
  });

  it("rejects unknown Vercel skill approvals before executing or changing state", async () => {
    const cwd = await project();
    await run(["install"], cwd);
    const lockPath = join(cwd, ".aiw/lock.yml");
    const before = await readFile(lockPath, "utf8");
    let calls = 0;
    const result = await run(["skills", "update", "--allow=network:external,system:root"], cwd, {
      externalSkills: {
        execute: async (): Promise<{ stdout: string; exitCode: number }> => {
          calls += 1;
          return { stdout: "updated", exitCode: 0 };
        },
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Unknown package permissions: system:root");
    expect(calls).toBe(0);
    await expect(readFile(lockPath, "utf8")).resolves.toBe(before);
  });
});
