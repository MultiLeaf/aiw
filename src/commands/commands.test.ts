import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFileSystem } from "../files.js";
import { HELP_OUTPUT, REGISTERED_COMMANDS, runCommand } from "../workflow.js";
import {
  containsCredential,
  EMPTY_LOCKFILE,
  escapeRegExp,
  formatConfidence,
  formatNoul,
  installationRequired,
  isInsidePath,
  parseApprovedPermissions,
  parseNamedOptions,
  parsePrivateRegistryPackages,
  safeProjectFile,
  stateMismatch,
} from "./shared.js";
import { nextAdrStamp, normalizeCommand } from "./workflow-state.js";

describe("workflow command dispatcher contract", () => {
  it.each(["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"])(
    "ignores Object.prototype key %s and falls back to help output",
    async (protoKey) => {
      const cwd = mkdtempSync(join(tmpdir(), "aiw-cmd-proto-"));
      const result = await runCommand([protoKey], cwd, nodeFileSystem);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("aiw install");
      expect(result.error).toBeUndefined();
    },
  );

  it.each(["--version", "-v"])("prints the package.json version for %s", async (flag) => {
    const cwd = mkdtempSync(join(tmpdir(), "aiw-cmd-ver-"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const result = await runCommand([flag], cwd, nodeFileSystem);
    expect(result).toEqual({ exitCode: 0, output: pkg.version });
  });

  it("documents every registered command in HELP_OUTPUT", () => {
    const missing = REGISTERED_COMMANDS.filter(
      (command) => !new RegExp(`\\b${command.replace(/-/g, "\\-")}\\b`).test(HELP_OUTPUT),
    );
    expect(missing).toEqual([]);
  });
});

describe("src/commands/shared helpers", () => {
  it("parses valid named options and rejects duplicates, unknowns, or extra equals", () => {
    expect(parseNamedOptions(["--title=Hello", "--id=abc"], ["title", "id"])).toEqual({
      title: "Hello",
      id: "abc",
    });
    expect(parseNamedOptions(["--title=a", "--title=b"], ["title"])).toBeUndefined();
    expect(parseNamedOptions(["--unknown=1"], ["title"])).toBeUndefined();
    expect(parseNamedOptions(["--title=a=b"], ["title"])).toBeUndefined();
    expect(parseNamedOptions(["--title="], ["title"])).toBeUndefined();
  });

  it("enforces project-relative path confinement in safeProjectFile and isInsidePath", () => {
    const root = mkdtempSync(join(tmpdir(), "aiw-cmd-safe-"));
    mkdirSync(join(root, "plans"), { recursive: true });
    const planPath = join(root, "plans/plan.yml");
    writeFileSync(planPath, "schema: 1\n");

    expect(safeProjectFile(root, "plans/plan.yml", nodeFileSystem)).toBe(planPath);
    expect(() => safeProjectFile(root, "../escape.yml", nodeFileSystem)).toThrow(
      "safe project-relative file",
    );
    expect(() => safeProjectFile(root, "/etc/passwd", nodeFileSystem)).toThrow(
      "safe project-relative file",
    );
    expect(() => safeProjectFile(root, "plans/bad\u0000.yml", nodeFileSystem)).toThrow(
      "safe project-relative file",
    );
    expect(() => safeProjectFile(root, "plans/missing.yml", nodeFileSystem)).toThrow(
      "does not exist or is not a file",
    );

    expect(isInsidePath(root, planPath)).toBe(true);
    expect(isInsidePath(root, root)).toBe(true);
    expect(isInsidePath(root, join(root, "..", "outside"))).toBe(false);
  });

  it("validates private registry payloads and detects credentials in nested or cyclic objects", () => {
    const packages = parsePrivateRegistryPackages(
      [
        {
          id: "team/pkg",
          version: "1.2.0",
          description: "Team workflow pack",
          permissions: ["filesystem:read"],
        },
      ],
      "https://registry.example.test",
    );
    expect(packages).toEqual([
      {
        id: "team/pkg",
        version: "1.2.0",
        description: "Team workflow pack",
        provider: "private-registry",
        source: "https://registry.example.test/team/pkg",
        permissions: ["filesystem:read"],
      },
    ]);
    expect(() => parsePrivateRegistryPackages({}, "https://registry.example.test")).toThrow(
      "must be an array",
    );
    expect(() =>
      parsePrivateRegistryPackages(
        [{ id: "bad\nid", version: "1.0.0", description: "desc", permissions: [] }],
        "https://registry.example.test",
      ),
    ).toThrow("unsafe text");

    const cyclic: Record<string, unknown> = { nested: { ok: "value" } };
    cyclic.self = cyclic;
    expect(containsCredential(cyclic, "secret-token")).toBe(false);
    expect(
      containsCredential({ a: [cyclic, { header: "Bearer secret-token" }] }, "secret-token"),
    ).toBe(true);
  });

  it("formats scalar helpers, permissions, regex escaping, and typed blocking results", () => {
    expect(EMPTY_LOCKFILE).toBe("schema: 1\npackages:\n");
    expect(formatConfidence(undefined)).toBe("unknown");
    expect(formatConfidence(0.8754)).toBe("0.875");
    expect(formatNoul(undefined)).toBe("unknown");
    expect(formatNoul(0.25)).toBe("0.250");
    expect(
      parseApprovedPermissions(["--allow=network:external, git:read", "--allow=fs:write"]),
    ).toEqual(["network:external", "git:read", "fs:write"]);
    expect(new RegExp(escapeRegExp("a.b+c?")).test("a.b+c?")).toBe(true);
    expect(new RegExp(escapeRegExp("a.b+c?")).test("axb+c?")).toBe(false);

    const installErr = installationRequired();
    expect(installErr.exitCode).toBe(1);
    expect(installErr.error).toContain("installation_required");

    const mismatchErr = stateMismatch("ledger diverged");
    expect(mismatchErr.exitCode).toBe(1);
    expect(mismatchErr.error).toContain("state_mismatch");
    expect(mismatchErr.error).toContain("ledger diverged");
  });
});

describe("src/commands/workflow-state helpers", () => {
  it("generates strictly monotonic ADR timestamps and normalizes validation commands", () => {
    const stamps = Array.from({ length: 5 }, () => nextAdrStamp());
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index]).toBeGreaterThan(stamps[index - 1]);
    }
    expect(normalizeCommand("  NPM   Run   Test  ")).toBe("npm run test");
  });
});
