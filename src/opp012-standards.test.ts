import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./cli.js";
import { extractStandards } from "./standards.js";
import { nodeFileSystem } from "./files.js";

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-opp012-"));
  const git = (args: string[]): void =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "t@e.c"]);
  git(["config", "user.name", "t"]);
  await writeFile(join(cwd, "README.md"), "# project\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  await run(["install"], cwd);
  return cwd;
}

describe("OPP-012 standards discovery (deterministic floor)", () => {
  it("extracts testing, error-handling and naming standards with evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "aiw-std-"));
    mkdirSync(join(root, "src", "auth"), { recursive: true });
    writeFileSync(
      join(root, "src", "auth", "token-service.ts"),
      "export class TokenError extends Error {}\nexport class AuthError extends Error {}\n",
    );
    writeFileSync(join(root, "src", "auth", "token-service.test.ts"), "test();\n");
    const documents = extractStandards(root, nodeFileSystem);
    const byTopic = new Map(documents.map((document) => [document.topic, document]));
    const testing = byTopic.get("testing")!;
    expect(testing.status).toBe("inferred");
    expect(testing.statements[0].convention).toContain("beside the sources");
    const errors = byTopic.get("error-handling")!;
    expect(errors.statements[0].occurrences).toBe(2);
    expect(errors.statements[0].evidence[0].path).toContain("token-service.ts");
    expect(errors.statements[0].evidence[0].line).toBe(1);
    const naming = byTopic.get("naming")!;
    expect(naming.statements[0].convention).toContain("kebab-case");
  });

  it("extract → list → confirm lifecycle updates status and persists", async () => {
    const cwd = await project();
    const extracted = await run(["standards", "extract"], cwd);
    expect(extracted.output).toContain("inferred");
    const listed = await run(["standards", "list"], cwd);
    expect(listed.output).toContain("- testing: inferred");
    const confirmed = await run(["standards", "confirm", "testing"], cwd);
    expect(confirmed.output).toContain("confirmed");
    const index = await readFile(join(cwd, ".aiw", "standards", "index.yml"), "utf8");
    expect(index).toContain("testing:");
    expect(index).toContain("status: confirmed");
    const document = await readFile(join(cwd, ".aiw", "standards", "testing.md"), "utf8");
    expect(document).toContain("Status: confirmed");
    expect(document).toContain("Evidence:");
  });

  it("rejected standards are recorded and never confirmed silently", async () => {
    const cwd = await project();
    await run(["standards", "extract"], cwd);
    const rejected = await run(["standards", "reject", "naming"], cwd);
    expect(rejected.output).toContain("never rendered");
    const index = await readFile(join(cwd, ".aiw", "standards", "index.yml"), "utf8");
    expect(index).toContain("status: rejected");
    const unknown = await run(["standards", "confirm", "nonexistent"], cwd);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.error).toContain("standards extract");
  });

  it("fails clearly before installation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aiw-std-noinstall-"));
    const result = await run(["standards", "extract"], cwd);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("[reason: installation_required]");
  });
});
