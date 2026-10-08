import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { configureOptionalModels } from "./workflow.js";
import { nodeFileSystem } from "./files.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseSemanticConfig } from "./semantic.js";
import { parseDecisionConfig } from "./decision.js";

function tempProject(): { root: string; aiw: string } {
  const root = mkdtempSync(join(tmpdir(), "aiw-onboarding-"));
  return { root, aiw: join(root, ".aiw") };
}

describe("optional model onboarding", () => {
  it("enables semantic and decision when the user confirms", async () => {
    const { root, aiw } = tempProject();
    try {
      const answers = ["y", "yes"];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => answers.shift() ?? "",
      );
      expect(enabled).toHaveLength(2);
      expect(enabled[0]).toContain("semantic");
      expect(enabled[1]).toContain("decision");
      const semantic = parseSemanticConfig(await readFile(join(aiw, "semantic.yml"), "utf8"));
      expect(semantic.enabled).toBe(true);
      expect(semantic.model).toBe("embeddinggemma-2:latest");
      const decision = parseDecisionConfig(await readFile(join(aiw, "decision.yml"), "utf8"));
      expect(decision.enabled).toBe(true);
      expect(decision.model).toBe("clef-flash:latest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes nothing when declined and preserves existing configuration", async () => {
    const { root, aiw } = tempProject();
    try {
      const enabled = await configureOptionalModels(nodeFileSystem, aiw, async () => "n");
      expect(enabled).toEqual([]);
      expect(nodeFileSystem.exists(join(aiw, "semantic.yml"))).toBe(false);
      expect(nodeFileSystem.exists(join(aiw, "decision.yml"))).toBe(false);
      nodeFileSystem.mkdir(aiw);
      nodeFileSystem.write(
        join(aiw, "semantic.yml"),
        "semantic:\n  enabled: true\n  model: custom-model\n  baseUrl: http://remote:11434\n",
      );
      const questions: string[] = [];
      const skipped = await configureOptionalModels(nodeFileSystem, aiw, async (question) => {
        questions.push(question);
        return "n";
      });
      expect(skipped).toEqual([]);
      expect(questions).toHaveLength(1);
      expect(questions[0]).toContain("decision");
      expect(parseSemanticConfig(nodeFileSystem.read(join(aiw, "semantic.yml"))).model).toBe(
        "custom-model",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
