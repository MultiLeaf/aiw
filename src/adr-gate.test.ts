import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-adr-gate-"));
}

const DESIGN =
  "## Context\nNeed\n## Proposed Design\nModule\n## Alternatives\nA or B\n## Interfaces\nAPI\n## Risks\nMigration\n## Validation\nTests\n";

async function reachDesign(cwd: string, designContent: string): Promise<void> {
  await run(["install"], cwd);
  await run(["workflow", "start", "--id=adr-test"], cwd);
  await run(["skip", "brainstorming", "--reason=Not needed by this test"], cwd);
  await run(["skip", "product-requirements", "--reason=Not needed by this test"], cwd);
  await run(["spec"], cwd);
  await mkdir(join(cwd, ".aiw/generated/specs/adr-test"), { recursive: true });
  await writeFile(
    join(cwd, ".aiw/generated/specs/adr-test/specification.md"),
    "## Requirements\nREQ-001\n## Acceptance Criteria\nGiven a user\nWhen they act\nThen it works\n",
  );
  await run(["gate", "specification"], cwd);
  await run(["approve", "specification"], cwd);
  await mkdir(join(cwd, ".aiw/generated/reports/adr-test"), { recursive: true });
  await writeFile(join(cwd, ".aiw/generated/reports/adr-test/technical-design.md"), designContent);
}

describe("ADR enforcement in the technical-design gate (REQ-004)", () => {
  it("blocks when a linked ADR file does not exist, passes when it does", async () => {
    const cwd = await project();
    const designWithLink = `${DESIGN}\n## Consequential Decisions\n\n- Strictness ordering — .context/adrs/ADR-101-policy-order.md\n`;
    await reachDesign(cwd, designWithLink);

    // The ADR path is declared but the file does not exist: gate blocks.
    const blocked = await run(["gate", "technical-design"], cwd);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.error).toContain("missing ADR file: ADR-101-policy-order.md");

    // Create the ADR via the existing command; the gate now passes.
    const adr = await run(["adr", "--title=policy order"], cwd);
    expect(adr.exitCode).toBe(0);
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(join(cwd, ".context/adrs")),
    );
    const created = files.find((file) => file.includes("policy-order"));
    expect(created).toBeTruthy();
    // Point the design at the real file name.
    const { writeFile: write } = await import("node:fs/promises");
    await write(
      join(cwd, ".aiw/generated/reports/adr-test/technical-design.md"),
      designWithLink.replace("ADR-101-policy-order.md", created),
    );
    const gate = await run(["gate", "technical-design"], cwd);
    expect(gate.exitCode).toBe(0);
    expect(gate.output).toContain("Quality gate passed for technical-design");
  });
});
