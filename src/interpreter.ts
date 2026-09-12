import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { EvidenceFact } from "./evidence.js";
import type { ProjectProfile } from "./profile.js";

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
): InterpretationRequest {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0)
    throw new Error("maxTokens must be a positive integer");
  const selectedFiles = [
    ...new Set(files.filter(safeFile).map((file) => file.replaceAll("\\", "/"))),
  ].sort();
  return {
    profile,
    files: selectedFiles,
    maxTokens,
    estimatedTokens: Math.min(
      maxTokens,
      JSON.stringify(profile).length + selectedFiles.join("\n").length,
    ),
  };
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
