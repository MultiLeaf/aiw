import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionProvider, DecisionResponse } from "./decision.js";
import { nodeFileSystem } from "./files.js";
import type { EmbeddingProvider } from "./semantic.js";
import { runCommand, type WorkflowServices } from "./workflow.js";

function setupProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "aiw-flow-001-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "flow-001-demo", version: "1.0.0" }),
  );
  writeFileSync(
    join(cwd, "auth.ts"),
    "export function verifySession(): boolean { return true; }\n",
  );
  writeFileSync(join(cwd, "billing.ts"), "export function chargeCard(): number { return 42; }\n");
  return cwd;
}

async function run(
  args: string[],
  cwd: string,
  services: WorkflowServices = {},
): ReturnType<typeof runCommand> {
  return runCommand(args, cwd, nodeFileSystem, services);
}

describe("FLOW-001 local model resilience, incremental indexing, and SDD integration", () => {
  it("degrades aiw scan gracefully when semantic model is offline and skips unchanged files when online", async () => {
    const cwd = setupProject();
    expect((await run(["install", "--target", "codex"], cwd)).exitCode).toBe(0);
    writeFileSync(
      join(cwd, ".aiw/settings.yml"),
      "semantic:\n  enabled: true\n  model: nomic-embed-text\n  baseUrl: http://localhost:11434\n",
    );

    const offlineEmbedding: EmbeddingProvider = {
      async available(): Promise<boolean> {
        return false;
      },
      async embed(): Promise<number[][]> {
        throw new Error("should not embed when offline");
      },
    };
    const degraded = await run(["scan"], cwd, { embeddingProvider: offlineEmbedding });
    expect(degraded.exitCode).toBe(0);
    expect(degraded.output).toContain("Project profile generated.");
    expect(degraded.output).toContain("Advisory: semantic model nomic-embed-text is not available");

    let embedCalls = 0;
    const onlineEmbedding: EmbeddingProvider = {
      async available(): Promise<boolean> {
        return true;
      },
      async embed(texts: string[]): Promise<number[][]> {
        embedCalls += texts.length;
        return texts.map((text) => [text.includes("verifySession") ? 1 : 0.1, 0.5]);
      },
    };
    const first = await run(["scan"], cwd, { embeddingProvider: onlineEmbedding });
    expect(first.exitCode).toBe(0);
    const firstEmbedded = embedCalls;
    expect(firstEmbedded).toBeGreaterThan(0);

    embedCalls = 0;
    const second = await run(["scan"], cwd, { embeddingProvider: onlineEmbedding });
    expect(second.exitCode).toBe(0);
    expect(embedCalls).toBe(0);
    expect(second.output).toContain("reused, 0 embedded");

    const fullRebuild = await run(["semantic", "index", "--full"], cwd, {
      embeddingProvider: onlineEmbedding,
    });
    expect(fullRebuild.exitCode).toBe(0);
    expect(embedCalls).toBe(firstEmbedded);
    expect(fullRebuild.output).toContain(`0 reused, ${firstEmbedded} embedded`);
  });

  it("degrades aiw recommend and semantic query --rerank when decision model is offline", async () => {
    const cwd = setupProject();
    expect((await run(["install", "--target", "codex"], cwd)).exitCode).toBe(0);
    writeFileSync(
      join(cwd, ".aiw/settings.yml"),
      [
        "semantic:",
        "  enabled: true",
        "  model: nomic-embed-text",
        "  baseUrl: http://localhost:11434",
        "decision:",
        "  enabled: true",
        "  model: clef-flash",
        "  baseUrl: http://localhost:11434",
        "",
      ].join("\n"),
    );

    const embeddingProvider: EmbeddingProvider = {
      async available(): Promise<boolean> {
        return true;
      },
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map((text) => [
          text.includes("verifySession") || text.includes("session") ? 1 : 0.1,
          0.2,
        ]);
      },
    };
    const offlineDecision: DecisionProvider = {
      async available(): Promise<boolean> {
        return false;
      },
      async decide(): Promise<never> {
        throw new Error("offline");
      },
    };

    expect((await run(["semantic", "index"], cwd, { embeddingProvider })).exitCode).toBe(0);

    const rec = await run(["recommend"], cwd, { decisionProvider: offlineDecision });
    expect(rec.exitCode).toBe(0);
    expect(rec.output).toContain("recommendations generated");
    expect(rec.output).toContain("Advisory: decision model clef-flash is not available");

    const query = await run(["semantic", "query", "--text=session", "--rerank"], cwd, {
      embeddingProvider,
      decisionProvider: offlineDecision,
    });
    expect(query.exitCode).toBe(0);
    expect(query.output).toContain("auth.ts");
    expect(query.output).toContain("Advisory: decision model clef-flash is not available");
  });

  it("injects advisory semantic context into plan and diagnosis scaffolds unless --no-semantic is passed", async () => {
    const cwd = setupProject();
    expect((await run(["install", "--target", "codex"], cwd)).exitCode).toBe(0);
    writeFileSync(
      join(cwd, ".aiw/settings.yml"),
      "semantic:\n  enabled: true\n  model: nomic-embed-text\n  baseUrl: http://localhost:11434\n",
    );
    const embeddingProvider: EmbeddingProvider = {
      async available(): Promise<boolean> {
        return true;
      },
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map((text) => [
          text.includes("verifySession") || text.toLowerCase().includes("session") ? 1 : 0,
          0.1,
        ]);
      },
    };
    expect((await run(["semantic", "index"], cwd, { embeddingProvider })).exitCode).toBe(0);

    expect((await run(["workflow", "start", "--process=bugfix", "--id=bf-1"], cwd)).exitCode).toBe(
      0,
    );
    const diag = await run(["diagnosis", "--title=Fix session validation"], cwd, {
      embeddingProvider,
    });
    expect(diag.exitCode).toBe(0);
    const diagPath = diag.output?.replace("Diagnosis artifact created: ", "").trim() ?? "";
    const diagContent = readFileSync(diagPath, "utf8");
    expect(diagContent).toContain("## Relevant Context (Semantic Retrieval — Advisory)");
    expect(diagContent).toContain("`auth.ts`");

    const diagSkipped = await run(
      ["diagnosis", "--title=Fix session validation", "--no-semantic"],
      cwd,
      { embeddingProvider },
    );
    expect(diagSkipped.exitCode).toBe(0);
    const diagSkippedContent = readFileSync(diagPath, "utf8");
    expect(diagSkippedContent).not.toContain("## Relevant Context (Semantic Retrieval — Advisory)");
  });

  it("supports opt-in --triage on aiw gate verification without altering deterministic pass", async () => {
    const cwd = setupProject();
    expect((await run(["install", "--target", "codex"], cwd)).exitCode).toBe(0);
    writeFileSync(
      join(cwd, ".aiw/settings.yml"),
      "decision:\n  enabled: true\n  model: clef-flash\n  baseUrl: http://localhost:11434\n",
    );
    expect((await run(["workflow", "start", "--process=bugfix", "--id=bf-2"], cwd)).exitCode).toBe(
      0,
    );

    const diag = await run(["diagnosis", "--title=Fix auth bug"], cwd);
    const diagPath = diag.output?.replace("Diagnosis artifact created: ", "").trim() ?? "";
    writeFileSync(
      diagPath,
      "# Fix auth bug\n\n## Reproduction\n- Command: `npm test`\n- Observed: fails\n\n## Expected\n- passes\n\n## Root Cause\n- auth.ts:1 returns wrong boolean\n\n## Scope\n- In scope: auth.ts\n- Out of scope: billing.ts\n",
    );
    expect((await run(["gate", "diagnosis"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "diagnosis"], cwd)).exitCode).toBe(0);

    const implPath = join(cwd, ".aiw/generated/reports/bf-2/implementation-report.md");
    writeFileSync(
      implPath,
      "# Implementation\n\n## Changed Files\n- auth.ts\n\n## Tests\n- auth.test.ts\n\n## Validation\n- `npm test` -> exit 0 (1 passed)\n\n## Deviations\n- None\n",
    );
    expect((await run(["gate", "implementation"], cwd)).exitCode).toBe(0);
    expect((await run(["approve", "implementation"], cwd)).exitCode).toBe(0);

    const verifyPath = join(cwd, ".aiw/generated/reports/bf-2/verification-report.md");
    writeFileSync(
      verifyPath,
      "# Verification\n\n## Requirements Checked\n- REQ-001 verified\n\n## Checks Passed\n- `npm test` -> exit 0 (1 passed)\n\n## Missing Evidence\n- None\n\n## Residual Risks\n- None\n\n## Decision\n- Ready for human approval\n",
    );

    const decisionProvider: DecisionProvider = {
      async available(): Promise<boolean> {
        return true;
      },
      async decide(): Promise<DecisionResponse> {
        return {
          model: "clef-flash",
          answers: {
            gate: { type: "choice" as const, choice: "ready", confidence: 0.92 },
            evidence_complete: { type: "noul" as const, noul: 0.96 },
          },
        };
      },
    };
    const gate = await run(["gate", "verification", "--triage"], cwd, { decisionProvider });
    expect(gate.exitCode).toBe(0);
    expect(gate.output).toContain("Quality gate passed for verification.");
    expect(gate.output).toContain("Advisory decision triage (never replaces human approval)");
    expect(gate.output).toContain("gate=ready");
  });
});
