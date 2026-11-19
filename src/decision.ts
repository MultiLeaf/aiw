import { parseDocument } from "yaml";
import type { FileSystem } from "./types.js";
import { loadSettings } from "./settings.js";

export type DecisionConfig = {
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string;
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

export function parseDecisionMapping(raw: unknown): DecisionConfig {
  if (!raw || typeof raw !== "object") throw new Error("decision must be a YAML mapping");
  const record = raw as Record<string, unknown>;
  const enabled = record.enabled;
  const model = record.model;
  const baseUrl = record.baseUrl;
  const apiKeyEnv = record.apiKeyEnv;
  if (typeof enabled !== "boolean") throw new Error("decision.enabled must be a boolean");
  if (!enabled) return { ...DEFAULT_DECISION_CONFIG, enabled: false };
  if (
    apiKeyEnv !== undefined &&
    (typeof apiKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv))
  )
    throw new Error("decision.apiKeyEnv must be an uppercase environment variable name");
  if (typeof model !== "string" || model.trim() === "")
    throw new Error("decision.model must be a non-empty string when decision mapping is enabled");
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl))
    throw new Error("decision.baseUrl must be an http(s) URL when decision mapping is enabled");
  return { enabled: true, model, baseUrl, ...(apiKeyEnv ? { apiKeyEnv } : {}) };
}

export function serializeDecisionConfig(config: DecisionConfig): string {
  return `decision:\n  enabled: ${config.enabled}\n  model: ${config.model}\n  baseUrl: ${config.baseUrl}${config.apiKeyEnv ? `\n  apiKeyEnv: ${config.apiKeyEnv}` : ""}\n`;
}

export function parseDecisionConfig(text: string): DecisionConfig {
  const document = parseDocument(text);
  const node = document.get("decision");
  if (document.errors.length > 0 || !node || typeof node !== "object")
    throw new Error("Decision configuration must be a YAML object with a `decision` mapping");
  return parseDecisionMapping((node as { toJSON(): unknown }).toJSON());
}

export function loadDecisionConfig(fs: FileSystem, aiwPath: string): DecisionConfig | undefined {
  const settings = loadSettings(fs, aiwPath);
  if (settings !== undefined)
    return "decision" in settings ? parseDecisionMapping(settings.decision) : undefined;
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

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createOllamaDecisionProvider(
  config: DecisionConfig,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  env: Readonly<Record<string, string | undefined>> = process.env,
): DecisionProvider {
  const externalToken = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
  const authHeaders = (extra: Record<string, string> = {}): Record<string, string> =>
    externalToken ? { ...extra, authorization: `Bearer ${externalToken}` } : extra;
  return {
    async available(): Promise<boolean> {
      try {
        if (config.apiKeyEnv !== undefined) {
          const response = await fetchImpl(`${config.baseUrl}/v1/models`, {
            headers: authHeaders(),
          });
          return response.ok;
        }
        const response = await fetchImpl(`${config.baseUrl}/api/tags`);
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
      const response = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
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

export type RecommendationRankingCandidate = {
  id: string;
  rationale: string;
  evidence: string[];
};

export function buildRecommendationRankingRequest(
  profileSummary: string,
  candidates: RecommendationRankingCandidate[],
): DecisionRequest {
  const questions: Record<string, DecisionQuestion> = {};
  for (const candidate of candidates) {
    questions[candidate.id] = {
      type: "score",
      instructions: `Confirmed project profile: ${profileSummary}.\nRate from 0 to 1 how relevant this capability recommendation is to that profile.\n\nRecommendation ${candidate.id}: ${candidate.rationale}\nEvidence: ${candidate.evidence.join(", ")}`,
      criteria: [
        "0 = irrelevant to the confirmed profile",
        "1 = highly relevant to the confirmed profile",
      ],
    };
  }
  return { state: `Capability recommendation ranking for: ${profileSummary}`, questions };
}

export type SemanticRerankCandidate = { id: string; text: string };

export function buildSemanticRerankRequest(
  query: string,
  candidates: SemanticRerankCandidate[],
): DecisionRequest {
  const questions: Record<string, DecisionQuestion> = {};
  for (const candidate of candidates) {
    questions[candidate.id] = {
      type: "score",
      instructions: `Rate from 0 to 1 how well this retrieval candidate answers the user query "${query}".\n\nCandidate:\n${candidate.text}`,
      criteria: ["0 = irrelevant to the query", "1 = directly and completely answers the query"],
    };
  }
  return { state: `Semantic retrieval rerank for query: ${query}`, questions };
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

/** OPP-007: a review finding as produced by adversarial-review judges. */
export type ReviewFinding = {
  id: string;
  severity: string;
  claim: string;
  evidence: string[];
};

/** Parse a findings document (YAML `---`-separated entries). Fail-closed: garbage → []. */
export function parseReviewFindings(text: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const block of text.split(/^---$/m)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const id = /^id:\s*(\S+)/m.exec(trimmed)?.[1];
    if (!id) continue;
    const severity = /^severity:\s*(.+)$/m.exec(trimmed)?.[1]?.trim() ?? "";
    const claim = /^claim:\s*(.+)$/m.exec(trimmed)?.[1]?.trim() ?? "";
    const evidence = [...trimmed.matchAll(/^\s*-\s*(\S+:\d+|\S+)$/gm)].map((m) => m[1]);
    findings.push({ id, severity, claim, evidence: evidence.filter((e) => !e.startsWith("id:")) });
  }
  return findings;
}

/** REQ-001: deterministic shape check — severity present; evidence or file:line non-empty. */
export function checkFindingShapes(findings: ReviewFinding[]): string[] {
  if (findings.length === 0) return ["No parsable findings: every entry fails the shape check."];
  const issues: string[] = [];
  for (const finding of findings) {
    if (!finding.severity) issues.push(`${finding.id}: severity is missing`);
    if (finding.evidence.length === 0)
      issues.push(`${finding.id}: no proof references or file:line`);
  }
  return issues;
}

/** REQ-002: batched triage — one choice question per SEVERE finding, single request. */
export function buildFindingsTriageRequest(findings: ReviewFinding[]): DecisionRequest {
  const questions: Record<string, DecisionQuestion> = {};
  for (const finding of findings)
    if (finding.severity.toLowerCase() === "severe")
      questions[finding.id] = {
        type: "choice",
        instructions: `Does the cited evidence support the claim "${finding.claim}"?`,
        criteria: {
          yes: "The cited evidence clearly supports the claim",
          no: "The cited evidence does not support the claim",
          unclear: "The evidence is insufficient to decide",
        },
      };
  return { state: JSON.stringify(findings), questions };
}

/** REQ-004: lane scope-watch — one advisory question about subsystem footprint. */
export function buildLaneScopeWatchRequest(changeSummary: string): DecisionRequest {
  return {
    state: changeSummary,
    questions: {
      multi_subsystem: {
        type: "choice",
        instructions: "Does this change footprint span multiple subsystems?",
        criteria: {
          yes: "The change touches more than one subsystem",
          no: "The change is contained in a single subsystem",
          unclear: "The footprint cannot be determined from the summary",
        },
      },
    },
  };
}
