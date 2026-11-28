import { execFile } from "node:child_process";
import type { FileSystem } from "./types.js";
import { loadSettings, saveSettingsSection } from "./settings.js";
import { DEFAULT_SEMANTIC_CONFIG, createOllamaEmbeddingProvider } from "./semantic.js";
import { DEFAULT_DECISION_CONFIG, createOllamaDecisionProvider } from "./decision.js";

export type ConfirmQuestion = (question: string) => Promise<string>;

export type OllamaModel = { name: string; embedding: boolean };

export type OllamaPullResult = {
  ok: boolean;
  error?: string;
  requiresUpgrade?: boolean;
};

export type OnboardingRuntime = {
  getOllamaVersion?(baseUrl: string): Promise<string | undefined>;
  listOllamaModels(baseUrl: string): Promise<OllamaModel[] | undefined>;
  pullOllamaModel(model: string): Promise<boolean | OllamaPullResult>;
  validateEmbedding(config: {
    baseUrl: string;
    model: string;
    apiKeyEnv?: string;
  }): Promise<boolean>;
  validateDecision(config: {
    baseUrl: string;
    model: string;
    apiKeyEnv?: string;
  }): Promise<boolean>;
};

const OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** Known minimum Ollama versions required to pull specific model families. */
const MIN_OLLAMA_VERSION_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["embeddinggemma", "0.11.10"],
];

export function compareOllamaVersion(actual: string, minimum: string): number {
  const parse = (raw: string): [number, number, number] | undefined => {
    const match = raw.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return undefined;
    return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  };
  const a = parse(actual);
  const b = parse(minimum);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function requiredOllamaVersionForModel(model: string): string | undefined {
  const lower = model.trim().toLowerCase();
  return MIN_OLLAMA_VERSION_PREFIXES.find(([prefix]) => lower.startsWith(prefix))?.[1];
}

function normalizePullResult(outcome: boolean | OllamaPullResult): OllamaPullResult {
  if (typeof outcome === "boolean") return { ok: outcome };
  return outcome;
}

function isUpgradeError(message: string): boolean {
  return /\b412\b/.test(message) || /requires a newer version of ollama/i.test(message);
}

function concisePullError(stderr: string, stdout: string, fallback: string): string {
  const combined = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^pulling\b/i.test(line));
  const match = combined.find((line) => /error:|412|requires a newer version/i.test(line));
  return (match ?? combined[0] ?? fallback).slice(0, 220);
}

function isEmbeddingModel(name: string, families: string[]): boolean {
  if (name.toLowerCase().includes("embed")) return true;
  return families.some((family) => family.toLowerCase() === "embedding");
}

export const defaultOnboardingRuntime: OnboardingRuntime = {
  async getOllamaVersion(baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (!response.ok) return undefined;
      const body = (await response.json()) as { version?: unknown };
      return typeof body?.version === "string" && body.version.trim().length > 0
        ? body.version.trim()
        : undefined;
    } catch {
      return undefined;
    }
  },
  async listOllamaModels(baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) return undefined;
      const body = (await response.json()) as {
        models?: { name?: string; details?: { families?: string[] } }[];
      };
      const models = (body.models ?? [])
        .filter(
          (entry): entry is { name: string; details?: { families?: string[] } } =>
            typeof entry?.name === "string",
        )
        .map((entry) => ({
          name: entry.name,
          embedding: isEmbeddingModel(entry.name, entry.details?.families ?? []),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return models;
    } catch {
      return undefined;
    }
  },
  pullOllamaModel(model) {
    return new Promise((resolve) => {
      execFile("ollama", ["pull", model], { timeout: 10 * 60_000 }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true });
          return;
        }
        const detail = concisePullError(stderr, stdout, error.message);
        resolve({
          ok: false,
          error: detail,
          requiresUpgrade: isUpgradeError(`${stderr}\n${stdout}\n${error.message}`),
        });
      });
    });
  },
  async validateEmbedding(config) {
    try {
      const provider = createOllamaEmbeddingProvider({
        enabled: true,
        model: config.model,
        baseUrl: config.baseUrl,
        chunkChars: DEFAULT_SEMANTIC_CONFIG.chunkChars,
        topK: DEFAULT_SEMANTIC_CONFIG.topK,
        excludeLockfiles: DEFAULT_SEMANTIC_CONFIG.excludeLockfiles,
        ...(config.apiKeyEnv ? { apiKeyEnv: config.apiKeyEnv } : {}),
      });
      if (!(await provider.available())) return false;
      const vectors = await provider.embed(["aiw onboarding validation"]);
      return vectors.length === 1 && vectors[0].length > 0;
    } catch {
      return false;
    }
  },
  async validateDecision(config) {
    try {
      const provider = createOllamaDecisionProvider({
        enabled: true,
        model: config.model,
        baseUrl: config.baseUrl,
        ...(config.apiKeyEnv ? { apiKeyEnv: config.apiKeyEnv } : {}),
      });
      return await provider.available();
    } catch {
      return false;
    }
  },
};

async function askYesNo(answer: ConfirmQuestion, question: string): Promise<boolean> {
  const response = (await answer(question)).trim().toLowerCase();
  return response === "y" || response === "yes";
}

async function pickFromList(
  answer: ConfirmQuestion,
  label: string,
  options: string[],
  fallback: string,
): Promise<string> {
  const menu = options.map((option, index) => `${index + 1}) ${option}`).join("\n");
  const response = (await answer(`${menu}\nSelect ${label} [${fallback}]: `)).trim();
  if (response === "") return fallback;
  const numeric = Number.parseInt(response, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length)
    return options[numeric - 1];
  return options.includes(response) ? response : fallback;
}

function isValidEnvName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

type CapabilitySetup = {
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
};

async function gatherCapabilitySetup(
  answer: ConfirmQuestion,
  runtime: OnboardingRuntime,
  options: {
    label: string;
    shortLabel: string;
    onlyEmbedding: boolean;
    fallbackModel: string;
    pullModel: string;
  },
): Promise<CapabilitySetup | undefined> {
  const models = await runtime.listOllamaModels(OLLAMA_BASE_URL);
  const ollamaUp = models !== undefined;
  const provider: "ollama" | "external" = ollamaUp
    ? (await pickFromList(answer, "provider", ["ollama", "external"], "ollama")) === "external"
      ? "external"
      : "ollama"
    : (await answer(
        `Ollama not reachable at ${OLLAMA_BASE_URL}. Use an external provider. [Enter] `,
      ),
      "external");
  if (provider === "ollama") {
    let candidates = (models ?? []).filter((model) =>
      options.onlyEmbedding ? model.embedding : true,
    );
    if (candidates.length === 0 && options.onlyEmbedding) {
      const pull = await askYesNo(
        answer,
        `No embedding models found. Pull ${options.pullModel}? [y/N] `,
      );
      if (pull) {
        const version = await runtime.getOllamaVersion?.(OLLAMA_BASE_URL);
        const minVersion = requiredOllamaVersionForModel(options.pullModel);
        if (version && minVersion && compareOllamaVersion(version, minVersion) < 0) {
          await answer(
            `Ollama ${version} is older than ${minVersion} required for ${options.pullModel}. Upgrade at ${OLLAMA_DOWNLOAD_URL} (or \`curl -fsSL https://ollama.com/install.sh | sh\`), then rerun \`aiw install\` to finish model setup. [Enter] `,
          );
        } else {
          await answer(`Pulling ${options.pullModel}... [Enter] `);
          const pullResult = normalizePullResult(await runtime.pullOllamaModel(options.pullModel));
          if (pullResult.ok) {
            const refreshed = await runtime.listOllamaModels(OLLAMA_BASE_URL);
            candidates = (refreshed ?? []).filter((model) => model.embedding);
          } else if (pullResult.requiresUpgrade) {
            await answer(
              `Pull failed${version ? ` (Ollama ${version})` : ""}: ${options.pullModel} requires a newer version of Ollama. Upgrade at ${OLLAMA_DOWNLOAD_URL} (or \`curl -fsSL https://ollama.com/install.sh | sh\`), then rerun \`aiw install\` to finish model setup. [Enter] `,
            );
          } else {
            await answer(
              `Pull failed${pullResult.error ? `: ${pullResult.error}` : ""}. Enter a model manually. [Enter] `,
            );
          }
        }
      }
      if (candidates.length === 0) {
        const manual = (await answer(`Model name to use [${options.pullModel}]: `)).trim();
        if (manual.length === 0) return undefined;
        return { baseUrl: OLLAMA_BASE_URL, model: manual };
      }
    }
    const names = candidates.map((candidate) => candidate.name);
    const fallback = names.includes(options.fallbackModel) ? options.fallbackModel : names[0];
    const model = await pickFromList(answer, `${options.shortLabel} model`, names, fallback);
    return { baseUrl: OLLAMA_BASE_URL, model };
  }
  const endpoint = (await answer(`Endpoint URL: `)).trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    await answer("Invalid URL. [Enter] ");
    return undefined;
  }
  const model = (await answer(`Model name: `)).trim();
  if (model.length === 0) {
    await answer("Model name required. [Enter] ");
    return undefined;
  }
  const rawEnv = (await answer(`Token env var (empty for none): `)).trim();
  if (rawEnv.length > 0 && !isValidEnvName(rawEnv)) {
    await answer("Invalid env var name. [Enter] ");
    return undefined;
  }
  return { baseUrl: endpoint, model, ...(rawEnv ? { apiKeyEnv: rawEnv } : {}) };
}

async function configureCapability(
  fs: FileSystem,
  aiwPath: string,
  answer: ConfirmQuestion,
  runtime: OnboardingRuntime,
  options: {
    section: "semantic" | "decision";
    label: string;
    shortLabel: string;
    onlyEmbedding: boolean;
    fallbackModel: string;
    pullModel: string;
    serialize: (setup: CapabilitySetup) => unknown;
  },
): Promise<string[]> {
  const wants = await askYesNo(answer, `Configure ${options.label}? [y/N] `);
  if (!wants) return [];
  for (;;) {
    const setup = await gatherCapabilitySetup(answer, runtime, options);
    if (!setup) return [];
    const valid =
      options.section === "semantic"
        ? await runtime.validateEmbedding(setup)
        : await runtime.validateDecision(setup);
    if (valid) {
      saveSettingsSection(fs, aiwPath, options.section, options.serialize(setup));
      return [
        `${options.section} (${setup.model}${setup.apiKeyEnv ? ` via ${setup.baseUrl}` : ""})`,
      ];
    }
    const retry = await askYesNo(
      answer,
      `Validation failed for ${setup.model}. Retry? [y/N] (No = skip for now) `,
    );
    if (!retry) return [];
  }
}

export async function configureOptionalModels(
  fs: FileSystem,
  aiwPath: string,
  answer: ConfirmQuestion,
  runtime: OnboardingRuntime = defaultOnboardingRuntime,
): Promise<string[]> {
  const enabled: string[] = [];
  const settings = loadSettings(fs, aiwPath) ?? {};
  if (!("semantic" in settings))
    enabled.push(
      ...(await configureCapability(fs, aiwPath, answer, runtime, {
        section: "semantic",
        label: "semantic embedding",
        shortLabel: "embedding",
        onlyEmbedding: true,
        fallbackModel: DEFAULT_SEMANTIC_CONFIG.model,
        pullModel: DEFAULT_SEMANTIC_CONFIG.model,
        serialize: (setup) => ({
          enabled: true,
          model: setup.model,
          baseUrl: setup.baseUrl,
          chunkChars: DEFAULT_SEMANTIC_CONFIG.chunkChars,
          topK: DEFAULT_SEMANTIC_CONFIG.topK,
          excludeLockfiles: DEFAULT_SEMANTIC_CONFIG.excludeLockfiles,
          ...(setup.apiKeyEnv ? { apiKeyEnv: setup.apiKeyEnv } : {}),
        }),
      })),
    );
  if (!("decision" in settings))
    enabled.push(
      ...(await configureCapability(fs, aiwPath, answer, runtime, {
        section: "decision",
        label: "advisory decision triage",
        shortLabel: "decision",
        onlyEmbedding: false,
        fallbackModel: DEFAULT_DECISION_CONFIG.model,
        pullModel: DEFAULT_DECISION_CONFIG.model,
        serialize: (setup) => ({
          enabled: true,
          model: setup.model,
          baseUrl: setup.baseUrl,
          ...(setup.apiKeyEnv ? { apiKeyEnv: setup.apiKeyEnv } : {}),
        }),
      })),
    );
  return enabled;
}
