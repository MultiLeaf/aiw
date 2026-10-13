import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { EvidenceFact } from "./evidence.js";
import type { ProjectProfile } from "./profile.js";
import type { FileSystem } from "./types.js";
import { loadSettings } from "./settings.js";

export type InterpretationRequest = {
  profile: ProjectProfile;
  files: string[];
  maxTokens: number;
  estimatedTokens: number;
};
export type Interpreter = { interpret(request: InterpretationRequest): Promise<EvidenceFact[]> };
export type AiProviderRequest = {
  system: string;
  prompt: string;
  maxTokens: number;
  responseFormat: "json";
};
export type AiProvider = { generate(request: AiProviderRequest): Promise<string> };
export type ContextReader = (absolutePath: string) => Promise<string>;

export type AiProviderConfig = {
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string;
};

export const DEFAULT_AI_PROVIDER_CONFIG: AiProviderConfig = {
  enabled: false,
  model: "gpt-oss:20b",
  baseUrl: "http://localhost:11434",
};

export function parseAiProviderMapping(raw: unknown): AiProviderConfig {
  if (!raw || typeof raw !== "object") throw new Error("ai must be a YAML mapping");
  const record = raw as Record<string, unknown>;
  const enabled = record.enabled;
  const model = record.model;
  const baseUrl = record.baseUrl;
  const apiKeyEnv = record.apiKeyEnv;
  if (typeof enabled !== "boolean") throw new Error("ai.enabled must be a boolean");
  if (!enabled) return { ...DEFAULT_AI_PROVIDER_CONFIG, enabled: false };
  if (typeof model !== "string" || model.trim() === "")
    throw new Error("ai.model must be a non-empty string when the AI provider is enabled");
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl))
    throw new Error("ai.baseUrl must be an http(s) URL when the AI provider is enabled");
  if (
    apiKeyEnv !== undefined &&
    (typeof apiKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv))
  )
    throw new Error("ai.apiKeyEnv must be an uppercase environment variable name");
  return { enabled: true, model, baseUrl, ...(apiKeyEnv ? { apiKeyEnv } : {}) };
}

const EXCLUDED_SEGMENT =
  /(^|\/)(\.git|node_modules|vendor|\.venv|venv|dist|build|coverage|out|target|\.next|\.nuxt|\.output)(\/|$)/i;
const EXCLUDED_AIW = /(^|\/)\.aiw\/(generated|checkpoints)(\/|$)/i;
const SENSITIVE = /(^|\/)\.env(?:\.[^/]*)?$|\.(pem|key|p12|pfx|secret)$/i;
const TEXT_FILE =
  /(^|\/)(README|CONTRIBUTING|ARCHITECTURE)(\.[^/]*)?$|\.(c|cc|cpp|cs|css|go|graphql|h|hpp|html|java|js|jsx|json|kt|md|mjs|cjs|php|py|rb|rs|sh|sql|swift|toml|ts|tsx|txt|vue|yaml|yml)$/i;

function safeFile(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  return (
    normalized.length > 0 &&
    !isAbsolute(file) &&
    !normalized.split("/").includes("..") &&
    !EXCLUDED_SEGMENT.test(normalized) &&
    !EXCLUDED_AIW.test(normalized) &&
    !SENSITIVE.test(normalized) &&
    TEXT_FILE.test(normalized)
  );
}

function redactSecrets(content: string): string {
  return content
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      "[REDACTED]",
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(
      /(^|[,{;\s])(["']?)([A-Za-z_][A-Za-z0-9_.-]*)(["']?)(\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s,;}\]#]+))/gm,
      (
        match,
        boundary: string,
        opening: string,
        key: string,
        closing: string,
        operator: string,
        doubleQuoted: string | undefined,
        singleQuoted: string | undefined,
      ) => {
        if (!isSensitiveKey(key)) return match;
        if (doubleQuoted !== undefined)
          return `${boundary}${opening}${key}${closing}${operator}"[REDACTED]"`;
        if (singleQuoted !== undefined)
          return `${boundary}${opening}${key}${closing}${operator}'[REDACTED]'`;
        return `${boundary}${opening}${key}${closing}${operator}[REDACTED]`;
      },
    )
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/gi, "[REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, "[REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED]");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[.-]/g, "_");
  const parts = normalized.split("_");
  return (
    parts.some((part) =>
      [
        "secret",
        "token",
        "password",
        "passwd",
        "credential",
        "credentials",
        "authorization",
      ].includes(part),
    ) ||
    /(^|_)(api|access|private|client)_?key(_|$)/.test(normalized) ||
    /^(aws|azure|gcp|google|cloud|openai|anthropic|stripe|github|gitlab|slack|npm|docker|twilio|sendgrid)(?:_.*)?_(?:key|id)$/.test(
      normalized,
    )
  );
}

function isBinary(content: string): boolean {
  return [...content].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code === 0 ||
      (code >= 1 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    );
  });
}

export function createInterpretationRequest(
  profile: ProjectProfile,
  files: string[],
  maxTokens = 4000,
  priorityFiles?: string[],
): InterpretationRequest {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0)
    throw new Error("maxTokens must be a positive integer");
  const safe = [...new Set(files.filter(safeFile).map((file) => file.replaceAll("\\", "/")))];
  const priority = priorityFiles?.map((file) => file.replaceAll("\\", "/"));
  const ordered = priority
    ? [
        ...new Set(priority.filter((file) => safe.includes(file))),
        ...safe.filter((file) => !priority.includes(file)).sort(),
      ]
    : [...safe].sort();
  return {
    profile,
    files: ordered,
    maxTokens,
    estimatedTokens: Math.min(
      maxTokens,
      JSON.stringify(profile).length + ordered.join("\n").length,
    ),
  };
}

export const INTERPRETER_KEY_FILE_NAMES = [
  "readme.md",
  "contributing.md",
  "architecture.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "gemfile",
  "deno.json",
  "mix.exs",
];

export function selectInterpreterKeyFiles(files: string[]): string[] {
  const byBasename = new Map<string, string>();
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    const basename = normalized.split("/").pop()?.toLowerCase() ?? "";
    if (basename && !byBasename.has(basename)) byBasename.set(basename, normalized);
  }
  return INTERPRETER_KEY_FILE_NAMES.flatMap((name) => {
    const match = byBasename.get(name);
    return match ? [match] : [];
  });
}

export function buildInterpreterQuery(profile: ProjectProfile): string {
  const parts = [
    profile.runtime.languages.join(", "),
    profile.frameworks.join(", "),
    profile.packageManager,
  ].filter((part) => part && part !== "unknown");
  return `Project conventions, architecture, and coding standards${parts.length > 0 ? ` for ${parts.join(" with ")}` : ""}`;
}

type ProviderFact = {
  key?: unknown;
  value?: unknown;
  confidence?: unknown;
  evidence?: unknown;
};

function parseFacts(output: string, allowedFiles: Set<string>): EvidenceFact[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
  const facts = (value as { facts?: unknown })?.facts;
  if (!Array.isArray(facts)) throw new Error("AI provider response must contain a facts array");
  return facts.map((item: ProviderFact) => {
    if (
      typeof item.key !== "string" ||
      typeof item.value !== "string" ||
      typeof item.confidence !== "number" ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !Array.isArray(item.evidence)
    )
      throw new Error("AI provider returned an invalid inferred fact");
    const evidence = item.evidence.map((entry: unknown) => {
      const candidate = entry as { source?: unknown; reason?: unknown };
      if (typeof candidate.source !== "string" || typeof candidate.reason !== "string")
        throw new Error("AI provider returned invalid evidence");
      if (!allowedFiles.has(candidate.source))
        throw new Error(`AI provider cited a file outside the scoped context: ${candidate.source}`);
      return { source: candidate.source, reason: candidate.reason };
    });
    return {
      key: item.key,
      value: item.value,
      state: "inferred",
      method: "ai-inference",
      confidence: item.confidence,
      requiresConfirmation: item.confidence < 0.9,
      evidence,
    };
  });
}

type AiFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function loadAiProviderConfig(
  fs: FileSystem,
  aiwPath: string,
): AiProviderConfig | undefined {
  const settings = loadSettings(fs, aiwPath);
  if (settings === undefined || !("ai" in settings)) return undefined;
  return parseAiProviderMapping(settings.ai);
}

export function createOpenAiCompatibleProvider(
  config: AiProviderConfig,
  fetchImpl: AiFetchLike = (url, init) => fetch(url, init),
  env: Readonly<Record<string, string | undefined>> = process.env,
): AiProvider {
  return {
    async generate(request: AiProviderRequest): Promise<string> {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (config.apiKeyEnv) {
        const key = env[config.apiKeyEnv];
        if (key) headers.authorization = `Bearer ${key}`;
      }
      const response = await fetchImpl(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          max_tokens: request.maxTokens,
          ...(request.responseFormat === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
      });
      if (!response.ok)
        throw new Error(
          `AI provider request failed for model ${config.model}: ${await response.text()}`,
        );
      const body = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string")
        throw new Error(`AI provider ${config.model} returned no message content`);
      return content;
    },
  };
}

export function createProjectInterpreter(
  root: string,
  provider: AiProvider,
  contextReader: ContextReader = async (path) =>
    new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)),
): Interpreter {
  const projectRoot = resolve(root);
  return {
    async interpret(request): Promise<EvidenceFact[]> {
      const scoped = createInterpretationRequest(request.profile, request.files, request.maxTokens);
      const sections: string[] = [];
      for (const file of scoped.files) {
        const absolute = resolve(projectRoot, file);
        if (relative(projectRoot, absolute).startsWith("..")) continue;
        try {
          if ((await lstat(absolute)).isSymbolicLink()) continue;
        } catch {
          // Injected context readers may provide virtual files in tests or adapters.
        }
        let content: string;
        try {
          content = await contextReader(absolute);
        } catch {
          // Do not send content when decoding or reading it failed.
          continue;
        }
        if (isBinary(content)) continue;
        try {
          sections.push(`## ${file}\n${redactSecrets(content)}`);
        } catch {
          // Secret filtering is fail-closed: a failing filter excludes the whole file.
        }
      }
      if (sections.length === 0) return [];
      const safeProfile = redactSecrets(JSON.stringify(scoped.profile));
      const output = await provider.generate({
        system:
          "Interpret project conventions from only the supplied context. Return JSON with a facts array. Each fact must have key, string value, confidence from 0 to 1, and evidence entries with source and reason. Do not infer secrets or repeat credentials.",
        prompt: `Detected profile:\n${safeProfile}\n\nScoped project context:\n${sections.join("\n\n")}`,
        maxTokens: scoped.maxTokens,
        responseFormat: "json",
      });
      return parseFacts(output, new Set(scoped.files));
    },
  };
}
