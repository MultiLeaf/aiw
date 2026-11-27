import { expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../cli.js";

export async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aiw-test-"));
}

export async function syncCapabilities(cwd: string, ids: string[]): Promise<void> {
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run" }, devDependencies: { vitest: "latest" } }),
  );
  const recommendation = await run(["recommend", `--select=${ids.join(",")}`], cwd);
  expect(recommendation.exitCode).toBe(0);
  const result = await syncWithApproval(cwd);
  expect(result.exitCode).toBe(0);
}

export async function syncWithApproval(
  cwd: string,
  options: string[] = [],
  services?: Parameters<typeof run>[2],
): Promise<Awaited<ReturnType<typeof run>>> {
  const preview = await run(["sync", "--preview", ...options], cwd, services);
  const fingerprint = preview.output?.match(/"fingerprint": "(sha256-[a-f0-9]{64})"/)?.[1];
  if (!fingerprint)
    return { exitCode: 1, error: preview.error ?? "Sync preview did not produce a fingerprint." };
  return run(["sync", `--approve-plan=${fingerprint}`, ...options], cwd, services);
}

export async function advanceWorkflowTo(cwd: string, target: string): Promise<void> {
  const stages = [
    "brainstorming",
    "product-requirements",
    "specification",
    "technical-design",
    "plan",
    "implementation",
    "verification",
    "review",
    "traceability",
    "pr",
  ];
  const targetIndex = stages.indexOf(target);
  if (targetIndex < 0) throw new Error(`Unknown test workflow stage: ${target}`);
  await run(["workflow", "start", "--id=test-workflow"], cwd);
  for (const stage of stages.slice(0, targetIndex)) {
    if (
      stage === "brainstorming" ||
      stage === "product-requirements" ||
      stage === "technical-design" ||
      stage === "pr"
    ) {
      await run(["skip", stage, "--reason=Not needed by this test"], cwd);
      continue;
    }
    if (stage === "specification") {
      await run(["spec"], cwd);
      await mkdir(dirname(join(cwd, ".aiw/generated/specs/test-workflow/specification.md")), {
        recursive: true,
      });
      await writeArtifact(
        cwd,
        ".aiw/generated/specs/test-workflow/specification.md",
        "## Requirements\nREQ-001\n## Acceptance criteria\nGiven a user\nWhen they act\nThen it works\n",
      );
    } else if (stage === "plan") {
      await run(["plan"], cwd);
      await mkdir(dirname(join(cwd, ".aiw/generated/plans/test-workflow/implementation-plan.md")), {
        recursive: true,
      });
      await writeArtifact(
        cwd,
        ".aiw/generated/plans/test-workflow/implementation-plan.md",
        "TASK-001\nRequirement: REQ-001\nCode: src/main.ts\nTests: src/main.test.ts\nValidation: npm test\nEvidence: test output\n",
      );
    } else if (stage === "implementation") {
      await mkdir(join(cwd, ".aiw/generated/reports/test-workflow"), { recursive: true });
      await writeArtifact(
        cwd,
        ".aiw/generated/reports/test-workflow/implementation-report.md",
        "## Changed Files\nsrc/main.ts\n## Tests\nmain.test.ts\n## Validation\nnpm test\n## Deviations\nNone\n",
      );
    } else if (stage === "verification") {
      await writeArtifact(
        cwd,
        ".aiw/generated/reports/test-workflow/verification-report.md",
        "## Requirements Checked\nREQ-001\n## Checks Passed\nnpm test\n## Missing Evidence\nNone\n## Residual Risks\nNone\n## Decision\nComplete\n",
      );
    } else if (stage === "review") {
      await writeArtifact(
        cwd,
        ".aiw/generated/reports/test-workflow/code-review.md",
        "## Scope\nFeature\n## Findings\nNone\n## Checks\nTests reviewed\n## Residual Risks\nNone\n## Decision\nAccept\n",
      );
    } else if (stage === "traceability") {
      await run(["trace"], cwd);
    }
    const gate = await run(["gate", stage], cwd);
    if (gate.exitCode !== 0) throw new Error(gate.error ?? `Gate failed: ${stage}`);
    const approval = await run(["approve", stage], cwd);
    if (approval.exitCode !== 0) throw new Error(approval.error ?? `Approval failed: ${stage}`);
  }
}

/** FRIC-005: write a workflow-scoped artifact, creating its directory. */
export async function writeArtifact(cwd: string, relative: string, content: string): Promise<void> {
  const path = join(cwd, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
