import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { configureOptionalModels } from "./workflow.js";
import { nodeFileSystem } from "./files.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadSettings, readFactOverrides, saveSettingsSection } from "./settings.js";
import { parseSemanticMapping } from "./semantic.js";
import { parseDecisionMapping } from "./decision.js";

function tempProject(): { root: string; aiw: string } {
  const root = mkdtempSync(join(tmpdir(), "aiw-onboarding-"));
  return { root, aiw: join(root, ".aiw") };
}

describe("optional model onboarding", () => {
  it("enables semantic and decision in settings.yml when the user confirms", async () => {
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
      const settings = loadSettings(nodeFileSystem, aiw);
      expect(settings?.schema).toBe(1);
      expect(parseSemanticMapping(settings?.semantic).enabled).toBe(true);
      expect(parseSemanticMapping(settings?.semantic).model).toBe("embeddinggemma-2:latest");
      expect(parseDecisionMapping(settings?.decision).enabled).toBe(true);
      expect(parseDecisionMapping(settings?.decision).model).toBe("clef-flash:latest");
      expect(nodeFileSystem.exists(join(aiw, "semantic.yml"))).toBe(false);
      expect(nodeFileSystem.exists(join(aiw, "decision.yml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes nothing when declined and preserves existing settings sections", async () => {
    const { root, aiw } = tempProject();
    try {
      const enabled = await configureOptionalModels(nodeFileSystem, aiw, async () => "n");
      expect(enabled).toEqual([]);
      expect(nodeFileSystem.exists(join(aiw, "settings.yml"))).toBe(false);
      nodeFileSystem.mkdir(aiw);
      saveSettingsSection(nodeFileSystem, aiw, "semantic", {
        enabled: true,
        model: "custom-model",
        baseUrl: "http://remote:11434",
      });
      const questions: string[] = [];
      const skipped = await configureOptionalModels(nodeFileSystem, aiw, async (question) => {
        questions.push(question);
        return "n";
      });
      expect(skipped).toEqual([]);
      expect(questions).toHaveLength(1);
      expect(questions[0]).toContain("decision");
      expect(parseSemanticMapping(loadSettings(nodeFileSystem, aiw)?.semantic).model).toBe(
        "custom-model",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("settings overrides", () => {
  it("round-trips fact overrides through settings.yml", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      expect(readFactOverrides(nodeFileSystem, aiw)).toEqual([]);
      const cwd = root;
      process.chdir(cwd);
      const { run } = await import("./cli.js");
      await run(["install"], cwd);
      await run(["confirm", "--edit", "package-manager=pnpm"], cwd);
      const overrides = readFactOverrides(nodeFileSystem, aiw);
      expect(overrides).toEqual([{ key: "package-manager", action: "edit", value: "pnpm" }]);
      const raw = await readFile(join(aiw, "settings.yml"), "utf8");
      expect(raw).toContain("value: pnpm");
    } finally {
      process.chdir("/tmp");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to legacy overrides.yml when settings.yml is absent", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      nodeFileSystem.write(
        join(aiw, "overrides.yml"),
        "schema: 1\noverrides:\n  - key: package-manager\n    action: reject\n",
      );
      expect(readFactOverrides(nodeFileSystem, aiw)).toEqual([
        { key: "package-manager", action: "reject" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
