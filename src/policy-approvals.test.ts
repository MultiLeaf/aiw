import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "./types.js";
import { nodeFileSystem } from "./files.js";
import {
  changeFingerprint,
  isPathApproved,
  parsePolicyApprovals,
  recordPolicyApproval,
} from "./policy-approvals.js";

const fs: FileSystem = nodeFileSystem;

describe("policy approvals (REQ-003)", () => {
  it("fingerprints are deterministic and path-set sensitive", () => {
    const a = changeFingerprint(["src/a.ts", "src/b.ts"]);
    expect(a).toBe(changeFingerprint(["src/b.ts", "src/a.ts"]));
    expect(a).not.toBe(changeFingerprint(["src/a.ts"]));
  });

  it("records approvals with a cap and evaluates scoped coverage", async () => {
    const aiw = await mkdtemp(join(tmpdir(), "aiw-approvals-"));
    await mkdir(join(aiw, "checkpoints"), { recursive: true });
    const fingerprint = changeFingerprint(["src/auth/login.ts", "src/billing/pay.ts"]);

    const path = recordPolicyApproval(fs, aiw, {
      paths: ["src/auth/*"],
      fingerprint,
      approvedAt: "2026-11-27T00:00:00.000Z",
    });
    const approvals = parsePolicyApprovals(await readFile(path, "utf8"));
    expect(approvals).toHaveLength(1);

    // Coverage: exact pattern + exact fingerprint.
    expect(isPathApproved(approvals, fingerprint, "src/auth/login.ts")).toBe(true);
    expect(isPathApproved(approvals, fingerprint, "src/auth/session.ts")).toBe(true);
    // Different pattern: not covered (approving auth does not satisfy billing).
    expect(isPathApproved(approvals, fingerprint, "src/billing/pay.ts")).toBe(false);
    // Different fingerprint (tree changed): approval no longer applies.
    expect(
      isPathApproved(approvals, changeFingerprint(["src/auth/login.ts"]), "src/auth/login.ts"),
    ).toBe(false);
  });

  it("caps stored records at 50", async () => {
    const aiw = await mkdtemp(join(tmpdir(), "aiw-approvals-cap-"));
    await mkdir(join(aiw, "checkpoints"), { recursive: true });
    for (let i = 0; i < 55; i += 1) {
      recordPolicyApproval(fs, aiw, {
        paths: [`p${i}`],
        fingerprint: `sha256-${i}`,
        approvedAt: `2026-11-27T00:00:${String(i).padStart(2, "0")}.000Z`,
      });
    }
    const approvals = parsePolicyApprovals(
      await readFile(join(aiw, "checkpoints/policy-approvals.yml"), "utf8"),
    );
    expect(approvals).toHaveLength(50);
    // Oldest dropped, newest kept.
    expect(approvals.some((record) => record.paths.includes("p54"))).toBe(true);
    expect(approvals.some((record) => record.paths.includes("p0"))).toBe(false);
  });

  it("rejects invalid approval files", () => {
    expect(() => parsePolicyApprovals("not: a list")).toThrow("must be a YAML list");
  });

  it("rejects writes with empty path patterns", async () => {
    const aiw = await mkdtemp(join(tmpdir(), "aiw-approvals-empty-"));
    await mkdir(join(aiw, "checkpoints"), { recursive: true });
    expect(() =>
      recordPolicyApproval(fs, aiw, { paths: [], fingerprint: "f", approvedAt: "t" }),
    ).toThrow("at least one non-empty path pattern");
    expect(() =>
      recordPolicyApproval(fs, aiw, { paths: [""], fingerprint: "f", approvedAt: "t" }),
    ).toThrow("at least one non-empty path pattern");
  });
});
