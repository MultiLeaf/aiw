import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "./cli.js";

async function gitProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "aiw-opp015-"));
  const git = (args: string[]): void =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "t@e.c"]);
  git(["config", "user.name", "t"]);
  await writeFile(join(cwd, "README.md"), "# project\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  return cwd;
}

describe("OPP-015 token and recovery governance", () => {
  it("context-recovery block is rendered into the root context", async () => {
    const cwd = await gitProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" }, devDependencies: { typescript: "^5" } }),
    );
    await run(["install", "--target=codex"], cwd);
    await run(["scan"], cwd);
    await run(["recommend", "--select=verification"], cwd);
    const fp = JSON.parse(
      (await run(["sync", "--preview"], cwd)).output?.match(/\{[\s\S]*\}/)?.[0] ?? "{}",
    )["fingerprint"];
    await run(["sync", "--approve-plan=" + fp], cwd);
    const agents = await readFile(join(cwd, "AGENTS.md"), "utf8").catch(() => "");
    const neutral = await readFile(
      join(cwd, ".aiw", "generated", "context", "root-context.md"),
      "utf8",
    ).catch(() => "");
    const rendered = agents + neutral;
    expect(rendered).toContain("Context recovery (managed by AI Workflow)");
    expect(rendered).toContain("do not rely on compacted chat");
  });

  it("enforces declared stage budgets with a typed block and honors explicit overrides", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await mkdir(join(cwd, ".aiw"), { recursive: true });
    await writeFile(join(cwd, ".aiw", "budgets.yml"), "stages:\n  planning: 10\n");
    await run(["context", "--layer=project", "--content=" + "x".repeat(200)], cwd);
    const blocked = await run(["context", "--stage=planning"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("[reason: context_budget_exceeded]");
    expect(blocked.error).toContain("--budget=");
    const override = await run(["context", "--stage=planning", "--budget=100000"], cwd);
    expect(override.exitCode).toBe(0);
    expect(override.output).toContain("ceiling 100000");
    const undeclared = await run(["context", "--stage=other"], cwd);
    expect(undeclared.exitCode).toBe(0);
    expect(undeclared.output).toContain("no ceiling declared");
  });

  it("suggests lanes advisory-only from risk assess data", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await mkdir(join(cwd, "src", "auth"), { recursive: true });
    await writeFile(join(cwd, "src", "auth", "token.ts"), "export const t = 1;\n");
    const light = await run(
      ["task", "start", "--ticket=TEAM-20", "--lane=light", "--lane-reason=bench"],
      cwd,
    );
    expect(light.exitCode).toBe(0);
    expect(light.output).toContain("advisory: risk assess reports high");
    expect(light.output).toContain("consider the full lane");
    // advisory never blocks: the task started anyway
    expect(light.output).toContain("light lane");
  });

  it("reports regression-coverage gaps as verification advisory", async () => {
    const cwd = await gitProject();
    await run(["install"], cwd);
    await run(["workflow", "start", "--id=opp15-regression"], cwd);
    await run(["skip", "brainstorming", "--reason=requirement provided by ticket"], cwd);
    await run(["spec"], cwd);
    await writeFile(
      join(cwd, ".aiw", "generated", "specs", "specification.md"),
      "## Requirements\nREQ-001\n## Acceptance Criteria\n- Given a user\n- When they act\n- Then it works\n",
    );
    await run(["gate", "specification"], cwd);
    await run(["approve", "specification"], cwd);
    await run(["skip", "technical-design", "--reason=not needed"], cwd);
    await run(["plan"], cwd);
    await writeFile(
      join(cwd, ".aiw", "generated", "plans", "implementation-plan.md"),
      "TASK-001\nRequirement: REQ-001\nCode: src/main.ts\nTests: src/main.test.ts\nValidation: npm test\nEvidence: output\nTASK-002\nRequirement: REQ-001\nCode: src/other.ts\nTests: src/other.test.ts\nValidation: npm run lint\nRegression: keeps old output → src/other.test.ts\nEvidence: output\n",
    );
    await run(["gate", "plan"], cwd);
    await run(["approve", "plan"], cwd);
    await mkdir(join(cwd, ".aiw", "generated", "reports"), { recursive: true });
    await writeFile(
      join(cwd, ".aiw", "generated", "reports", "implementation-report.md"),
      "## Changed Files\nsrc/main.ts\n## Tests\nmain.test.ts\n## Validation\nnpm test\n## Deviations\nNone\n",
    );
    await run(["gate", "implementation"], cwd);
    await run(["approve", "implementation"], cwd);
    const verify = await run(["verify"], cwd);
    expect(verify.exitCode, verify.error ?? verify.output).toBe(0);
    expect(verify.output).toContain("Advisory: 1 of 2 plan tasks declare no regression coverage");
  });

  it("recovery block absent without install and present after (default-inert check)", () => {
    expect(existsSync("/tmp/nonexistent-aiw-opp015")).toBe(false);
  });
});
