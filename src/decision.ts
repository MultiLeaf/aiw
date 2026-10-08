import { parseDocument } from "yaml";
import type { FileSystem } from "./types.js";

export type DecisionConfig = {
  enabled: boolean;
  model: string;
  baseUrl: string;
};

export type DecisionQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | { type: "score"; instructions: string; criteria: string[] };

export type DecisionAnswer = {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export type DecisionRequest = {
  state: string;
  questions: Record<string, DecisionQuestion>;
};

export type DecisionResponse = { model: string; answers: Record<string, DecisionAnswer> };

export type DecisionProvider = {
  available(): Promise<boolean>;
  decide(request: DecisionRequest): Promise<DecisionResponse>;
};

export const DECISION_CONFIG_PATH = "decision.yml";

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  enabled: false,
  model: "clef-flash:latest",
  baseUrl: "http://localhost:11434",
};

export function parseDecisionConfig(text: string): DecisionConfig {
  const document = parseDocument(text);
  const node = document.get("decision");
  if (document.errors.length > 0 || !node || typeof node !== "object")
    throw new Error("Decision configuration must be a YAML object with a `decision` mapping");
  const raw = (node as { toJSON(): unknown }).toJSON() as Record<string, unknown>;
  const enabled = raw.enabled;
  const model = raw.model;
  const baseUrl = raw.baseUrl;
  if (typeof enabled !== "boolean") throw new Error("decision.enabled must be a boolean");
  if (!enabled) return { ...DEFAULT_DECISION_CONFIG, enabled: false };
  if (typeof model !== "string" || model.trim() === "")
    throw new Error("decision.model must be a non-empty string when decision mapping is enabled");
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl))
    throw new Error("decision.baseUrl must be an http(s) URL when decision mapping is enabled");
  return { enabled: true, model, baseUrl };
}

export function serializeDecisionConfig(config: DecisionConfig): string {
  return `decision:\n  enabled: ${config.enabled}\n  model: ${config.model}\n  baseUrl: ${config.baseUrl}\n`;
}

export function loadDecisionConfig(fs: FileSystem, aiwPath: string): DecisionConfig | undefined {
  const configPath = `${aiwPath}/${DECISION_CONFIG_PATH}`;
  if (!fs.exists(configPath)) return undefined;
  return parseDecisionConfig(fs.read(configPath));
}

function parseAnswer(value: unknown): DecisionAnswer {
  if (!value || typeof value !== "object") throw new Error("Invalid decision answer");
  const raw = value as Record<string, unknown>;
  if (raw.type !== "noul" && raw.type !== "choice" && raw.type !== "score")
    throw new Error("Invalid decision answer type");
  return { ...(raw as DecisionAnswer), type: raw.type };
}

export function parseDecisionResponse(text: string): DecisionResponse {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const answers = parsed.answers;
  if (typeof parsed.model !== "string" || !answers || typeof answers !== "object")
    throw new Error("Invalid decision response");
  const result: Record<string, DecisionAnswer> = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>))
    result[key] = parseAnswer(value);
  return { model: parsed.model, answers: result };
}

export function createOllamaDecisionProvider(config: DecisionConfig): DecisionProvider {
  return {
    async available(): Promise<boolean> {
      try {
        const response = await fetch(`${config.baseUrl}/api/tags`);
        if (!response.ok) return false;
        const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
        const names = new Set(
          (body.models ?? []).flatMap((entry) =>
            typeof entry?.name === "string" && typeof entry?.model === "string"
              ? [entry.name, entry.model]
              : [],
          ),
        );
        return names.has(config.model);
      } catch {
        return false;
      }
    },
    async decide(request: DecisionRequest): Promise<DecisionResponse> {
      const questionCount = Object.keys(request.questions).length;
      if (questionCount === 0 || questionCount > 64)
        throw new Error("Decision requests must contain between 1 and 64 questions");
      const response = await fetch(`${config.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          state: request.state,
          questions: request.questions,
        }),
      });
      if (!response.ok)
        throw new Error(
          `Decision request failed for model ${config.model}: ${await response.text()}`,
        );
      return parseDecisionResponse(await response.text());
    },
  };
}

export function buildEvidenceTriageRequest(artifact: string): DecisionRequest {
  return {
    state: artifact,
    questions: {
      evidence_complete: {
        type: "noul",
        instructions:
          "Does this artifact include concrete verification evidence for every stated requirement?",
      },
      gate: {
        type: "choice",
        instructions: "Should this artifact advance to human review?",
        criteria: {
          ready: "Every requirement has matching evidence and validation commands",
          "needs-work": "Evidence is missing, incomplete, or does not cover all requirements",
        },
      },
    },
  };
}
