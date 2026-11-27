import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-policy-rules-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "t"], { cwd, stdio: "ignore" });
  await run(["install"], cwd);
  await writeFile(
    join(cwd, ".aiw/organization.yml"),
    `schema: 1
name: Engineering
approved_sources: [local:./resources]
denied_permissions: [process:execute]
rules:
  - id: auth-human
    paths: [src/auth/*]
    decision: require-approval
    always-require-human: true
  - id: billing-human
    paths: [src/billing/*]
    decision: require-approval
  - id: deny-experimental
    paths: [experimental/*]
    decision: deny
`,
  );
  await writeFile(
    join(cwd, "package.yaml"),
    "schema: 1\nid: team/base\nversion: 1.0.0\nprovider: local\nsource: ./resources\ndependencies: []\npermissions: []\nprovenance:\n  source: ./resources\nresources:\n  skills:\n    - { id: base, version: 1.0.0, path: skills/base.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
  );
  // Baseline commit so the diff has a base.
  await writeFile(join(cwd, "README.md"), "# repo\n");
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "base"], { cwd, stdio: "ignore" });
  return cwd;
}

async function change(cwd: string, files: Record<string, string>, commit = false): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(join(cwd, file, ".."), { recursive: true });
    await writeFile(join(cwd, file), content);
  }
  if (commit) {
    execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "change"], { cwd, stdio: "ignore" });
  }
}

describe("policy-check path rules (workflow abbfcf16)", () => {
  it("passes allow paths and reports the summary", async () => {
    const cwd = await project();
    await change(cwd, { "src/main.ts": "ok\n" }, true);
    const result = await run(["policy-check", "--package=package.yaml"], cwd, {
      policyTracking: { isTracked: (): boolean => true },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("paths: 1 changed");
    expect(result.output).toContain("allow 1");
  });

  it("blocks deny paths with an actionable message that approvals cannot satisfy", async () => {
    const cwd = await project();
    await change(cwd, { "experimental/new-thing.ts": "x\n" }, true);
    const result = await run(["policy-check", "--package=package.yaml"], cwd, {
      policyTracking: { isTracked: (): boolean => true },
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("blocked by path rules");
    expect(result.error).toContain("experimental/new-thing.ts");
    expect(result.error).toContain("deny-experimental");
    expect(result.error).toContain("deny is not satisfiable by approval");

    // Even a recorded approval cannot satisfy deny.
    await run(["policy", "approve", "--paths=experimental/*"], cwd);
    const still = await run(["policy-check", "--package=package.yaml"], cwd, {
      policyTracking: { isTracked: (): boolean => true },
    });
    expect(still.exitCode).toBe(1);
    expect(still.error).toContain("deny is not satisfiable");
  });

  it("requires scoped recorded approval for strict paths (REQ-002/003)", async () => {
    const cwd = await project();
    await change(cwd, { "src/auth/login.ts": "auth\n", "src/billing/pay.ts": "pay\n" }, true);
    const services = { policyTracking: { isTracked: (): boolean => true } };

    const blocked = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("requiring recorded human approval");
    expect(blocked.error).toContain("src/auth/login.ts (always-require-human");
    expect(blocked.error).toContain("src/billing/pay.ts (require-approval");
    expect(blocked.error).toContain("aiw policy approve --paths=src/auth/login.ts");

    // Approving auth does not satisfy billing (scoped patterns).
    const approveAuth = await run(["policy", "approve", "--paths=src/auth/*"], cwd);
    expect(approveAuth.exitCode).toBe(0);
    expect(approveAuth.output).toContain("Human approval recorded");
    const partial = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(partial.exitCode).toBe(1);
    expect(partial.error).toContain("src/billing/pay.ts");
    expect(partial.error).not.toContain("src/auth/login.ts");

    // Approving the rest passes.
    await run(["policy", "approve", "--paths=src/billing/*"], cwd);
    const passed = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(passed.exitCode).toBe(0);
    expect(passed.output).toContain("paths: 2 changed");

    // A new change invalidates the fingerprint: approval no longer applies.
    await change(cwd, { "src/auth/session.ts": "s\n" }, true);
    const invalidated = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(invalidated.exitCode).toBe(1);
    expect(invalidated.error).toContain("src/auth/session.ts");
  });

  it("applies advisory results without changing the verdict (REQ-004)", async () => {
    const cwd = await project();
    await change(cwd, { "src/billing/pay.ts": "pay\n" }, true);
    const services = { policyTracking: { isTracked: (): boolean => true } };

    // Unapproved path: the advisory cannot make the check pass.
    const blockedAdvisory = await run(
      ["policy-check", "--package=package.yaml", "--advisory=allow"],
      cwd,
      services,
    );
    expect(blockedAdvisory.exitCode).toBe(1);
    expect(blockedAdvisory.error).toContain("requiring recorded human approval");

    // With the approval recorded, the advisory reports the delta allow would make.
    await run(["policy", "approve", "--paths=src/billing/*"], cwd);
    const advisory = await run(
      ["policy-check", "--package=package.yaml", "--advisory=allow"],
      cwd,
      services,
    );
    expect(advisory.exitCode).toBe(0);
    expect(advisory.output).toContain("Advisory (allow)");
    expect(advisory.output).toContain("require-approval → allow");
    expect(advisory.output).toContain("verdict unchanged");

    // An advisory deny cannot raise above require-approval and never touches deny paths.
    const denyAdvisory = await run(
      ["policy-check", "--package=package.yaml", "--advisory=deny"],
      cwd,
      services,
    );
    expect(denyAdvisory.exitCode).toBe(0);
    expect(denyAdvisory.output).not.toContain("→ deny");
    // Invalid advisory values are rejected.
    const bad = await run(["policy-check", "--package=package.yaml", "--advisory=maybe"], cwd, {
      policyTracking: { isTracked: (): boolean => true },
    });
    expect(bad.exitCode).toBe(1);
    expect(bad.error).toContain("--advisory must be one of");
  });

  it("keeps flat policies byte-identical and advises when no paths exist", async () => {
    const cwd = await project();
    await writeFile(
      join(cwd, ".aiw/organization.yml"),
      "schema: 1\nname: Engineering\napproved_sources: [local:./resources]\ndenied_permissions: [process:execute]\n",
    );
    const flat = await run(["policy-check", "--package=package.yaml"], cwd, {
      policyTracking: { isTracked: (): boolean => true },
    });
    expect(flat.exitCode).toBe(0);
    expect(flat.output).toContain("Organization policy gate passed: Engineering");
    expect(flat.output).not.toContain("paths:");
  });

  it("falls back to package manifest paths outside git", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-policy-nogit-"));
    await run(["install"], cwd);
    await writeFile(
      join(cwd, ".aiw/organization.yml"),
      `schema: 1
name: Engineering
approved_sources: [local:./resources]
denied_permissions: [process:execute]
rules:
  - id: skills-human
    paths: [skills/*]
    decision: require-approval
`,
    );
    await writeFile(
      join(cwd, "package.yaml"),
      "schema: 1\nid: team/base\nversion: 1.0.0\nprovider: local\nsource: ./resources\ndependencies: []\npermissions: []\nprovenance:\n  source: ./resources\nresources:\n  skills:\n    - { id: base, version: 1.0.0, path: skills/base.md }\n  rules: []\n  agents: []\n  hooks: []\n  templates: []\n",
    );
    const services = { policyTracking: { isTracked: (): boolean => true } };

    // The declared skills/base.md path requires approval in a non-git repo.
    const blocked = await run(["policy-check", "--package=package.yaml"], cwd, services);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("skills/base.md");
    expect(blocked.error).toContain("requiring recorded human approval");
  });
});
