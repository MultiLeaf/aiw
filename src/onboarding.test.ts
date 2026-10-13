import { describe, expect, it } from "vitest";
import { configureOptionalModels, type OnboardingRuntime } from "./model-onboarding.js";
import { nodeFileSystem } from "./files.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadSettings, saveSettingsSection } from "./settings.js";
import { parseSemanticMapping } from "./semantic.js";
import { parseDecisionMapping } from "./decision.js";
import {
  offerTelemetryConsent,
  parseTelemetryMapping,
  serializeTelemetryMapping,
} from "./telemetry.js";

function tempProject(): { root: string; aiw: string } {
  const root = mkdtempSync(join(tmpdir(), "aiw-onboarding-"));
  return { root, aiw: join(root, ".aiw") };
}

describe("telemetry consent", () => {
  it("asks after the model questions, defaults to No, and records the decision", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const questions: string[] = [];
      const answers = ["y", "yes", ""];
      await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async (question) => {
          questions.push(question);
          return answers.shift() ?? "";
        },
        {
          listOllamaModels: async () => undefined,
          pullOllamaModel: async () => false,
          validateEmbedding: async () => true,
          validateDecision: async () => true,
        },
      );
      const enabled = await offerTelemetryConsent(nodeFileSystem, aiw, async (question) => {
        questions.push(question);
        return "";
      });
      expect(enabled).toBe(false); // explicit default of No
      expect(questions.length).toBeGreaterThanOrEqual(2);
      const consentQuestion = questions.at(-1);
      expect(consentQuestion).toContain("[y/N]");
      expect(consentQuestion).toContain("command name");
      expect(consentQuestion).toContain("outcome");
      expect(consentQuestion).toContain("never arguments, file paths, or file contents");
      const settings = loadSettings(nodeFileSystem, aiw);
      expect(parseTelemetryMapping(settings?.telemetry).enabled).toBe(false);
      expect(nodeFileSystem.exists(join(aiw, "telemetry.yml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records consent and stays reversible through telemetry enable/disable", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const enabled = await offerTelemetryConsent(nodeFileSystem, aiw, async () => "y");
      expect(enabled).toBe(true);
      expect(parseTelemetryMapping(loadSettings(nodeFileSystem, aiw)?.telemetry)).toEqual({
        schema: 1,
        enabled: true,
        includeCommand: true,
        includeOutcome: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never re-asks once a telemetry decision exists", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      saveSettingsSection(
        nodeFileSystem,
        aiw,
        "telemetry",
        serializeTelemetryMapping({
          schema: 1,
          enabled: true,
          includeCommand: false,
          includeOutcome: true,
        }),
      );
      let asked = 0;
      const enabled = await offerTelemetryConsent(nodeFileSystem, aiw, async () => {
        asked += 1;
        return "";
      });
      expect(asked).toBe(0);
      expect(enabled).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("model provider onboarding", () => {
  function runtime(overrides: Partial<OnboardingRuntime> = {}): OnboardingRuntime {
    return {
      listOllamaModels: async () => undefined,
      pullOllamaModel: async () => false,
      validateEmbedding: async () => true,
      validateDecision: async () => true,
      ...overrides,
    };
  }

  it("configures semantic through Ollama with a numbered model selection", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const questions: string[] = [];
      const answers = ["y", "1", "", "n"];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async (question) => {
          questions.push(question);
          return answers.shift() ?? "";
        },
        runtime({
          listOllamaModels: async () => [
            { name: "clef-flash:latest", embedding: false },
            { name: "embeddinggemma-2:latest", embedding: true },
          ],
        }),
      );
      expect(enabled).toEqual(["semantic (embeddinggemma-2:latest)"]);
      const providerQuestion = questions.find((q) => q.includes("Select provider"));
      expect(providerQuestion).toContain("1) ollama");
      expect(providerQuestion).toContain("2) external");
      expect(questions.find((q) => q.includes("Select embedding model"))).toContain(
        "1) embeddinggemma-2:latest",
      );
      const settings = loadSettings(nodeFileSystem, aiw);
      expect(parseSemanticMapping(settings?.semantic).model).toBe("embeddinggemma-2:latest");
      expect(parseSemanticMapping(settings?.semantic).baseUrl).toBe("http://localhost:11434");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists only embedding models for semantic", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const answers = ["y", "1", "", "n"];
      await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => answers.shift() ?? "",
        runtime({
          listOllamaModels: async () => [
            { name: "gpt-oss:20b", embedding: false },
            { name: "nomic-embed-text", embedding: true },
          ],
        }),
      );
      const settings = loadSettings(nodeFileSystem, aiw);
      expect(parseSemanticMapping(settings?.semantic).model).toBe("nomic-embed-text");
      expect(settings?.decision).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("asks permission to ollama pull when no embedding models exist", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const questions: string[] = [];
      let pulls = 0;
      let pulled = false;
      const answers = ["y", "1", "y", "", "n"];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async (question) => {
          questions.push(question);
          return answers.shift() ?? "";
        },
        runtime({
          listOllamaModels: async () =>
            pulled ? [{ name: "embeddinggemma-2:latest", embedding: true }] : [],
          pullOllamaModel: async () => {
            pulls += 1;
            pulled = true;
            return true;
          },
        }),
      );
      expect(pulls).toBe(1);
      expect(questions.some((q) => q.includes("Pull embeddinggemma-2:latest"))).toBe(true);
      expect(enabled).toEqual(["semantic (embeddinggemma-2:latest)"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("configures an external provider with endpoint and token env", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const validated: { baseUrl: string; model: string; apiKeyEnv?: string }[] = [];
      const answers = ["y", "2", "https://api.example.com", "text-embed-3", "AIW_EMBED_KEY", "n"];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => answers.shift() ?? "",
        runtime({
          listOllamaModels: async () => [{ name: "clef-flash:latest", embedding: false }],
          validateEmbedding: async (config) => {
            validated.push(config);
            return true;
          },
        }),
      );
      expect(enabled).toEqual(["semantic (text-embed-3 via https://api.example.com)"]);
      expect(validated).toEqual([
        { baseUrl: "https://api.example.com", model: "text-embed-3", apiKeyEnv: "AIW_EMBED_KEY" },
      ]);
      const config = parseSemanticMapping(loadSettings(nodeFileSystem, aiw)?.semantic);
      expect(config.model).toBe("text-embed-3");
      expect(config.baseUrl).toBe("https://api.example.com");
      expect(config.apiKeyEnv).toBe("AIW_EMBED_KEY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forces external when Ollama is unreachable", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const questions: string[] = [];
      const answers = ["y", "", "https://api.example.com", "dec-1", "", "n"];
      await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async (question) => {
          questions.push(question);
          return answers.shift() ?? "";
        },
        runtime(),
      );
      expect(questions.some((q) => q.includes("Ollama not reachable"))).toBe(true);
      const config = parseSemanticMapping(loadSettings(nodeFileSystem, aiw)?.semantic);
      expect(config.baseUrl).toBe("https://api.example.com");
      expect(config.apiKeyEnv).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries validation and can skip the capability", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      let attempts = 0;
      const answers = ["y", "1", "", "y", "1", "", "n"];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => answers.shift() ?? "",
        runtime({
          listOllamaModels: async () => [{ name: "embeddinggemma-2:latest", embedding: true }],
          validateEmbedding: async () => {
            attempts += 1;
            return attempts > 1;
          },
        }),
      );
      expect(attempts).toBe(2);
      expect(enabled).toEqual(["semantic (embeddinggemma-2:latest)"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips when validation keeps failing", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const answers = ["y", "1", "", "n", "n"];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => answers.shift() ?? "",
        runtime({
          listOllamaModels: async () => [{ name: "embeddinggemma-2:latest", embedding: true }],
          validateEmbedding: async () => false,
        }),
      );
      expect(enabled).toEqual([]);
      expect(loadSettings(nodeFileSystem, aiw)?.semantic).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("configures the decision model with the same flow", async () => {
    const { root, aiw } = tempProject();
    try {
      nodeFileSystem.mkdir(aiw);
      const answers = ["y", "1", "", "y", "1", ""];
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => answers.shift() ?? "",
        runtime({
          listOllamaModels: async () => [
            { name: "clef-flash:latest", embedding: false },
            { name: "embeddinggemma-2:latest", embedding: true },
          ],
        }),
      );
      expect(enabled).toEqual([
        "semantic (embeddinggemma-2:latest)",
        "decision (clef-flash:latest)",
      ]);
      const config = parseDecisionMapping(loadSettings(nodeFileSystem, aiw)?.decision);
      expect(config.model).toBe("clef-flash:latest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes nothing when declined and preserves existing sections", async () => {
    const { root, aiw } = tempProject();
    try {
      const enabled = await configureOptionalModels(
        nodeFileSystem,
        aiw,
        async () => "n",
        runtime(),
      );
      expect(enabled).toEqual([]);
      expect(nodeFileSystem.exists(join(aiw, "settings.yml"))).toBe(false);
      nodeFileSystem.mkdir(aiw);
      saveSettingsSection(nodeFileSystem, aiw, "semantic", {
        enabled: true,
        model: "custom-model",
        baseUrl: "http://remote:11434",
      });
      const again = await configureOptionalModels(nodeFileSystem, aiw, async () => "y", runtime());
      expect(again).toEqual([]); // semantic already configured; decision declined
      expect(parseSemanticMapping(loadSettings(nodeFileSystem, aiw)?.semantic).model).toBe(
        "custom-model",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
