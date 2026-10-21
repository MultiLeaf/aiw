import { isAbsolute } from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import {
  composeContext,
  CONTEXT_LAYERS,
  type ContextLayer,
  type ContextStore,
} from "./context-store.js";
import { retrieveTaskContext } from "./context-retrieval.js";
import { estimateTokens } from "./context-benchmark.js";

/**
 * Task parity suite (deterministic, offline, zero API cost).
 *
 * Each parity task pins a quality constraint on context assembly: the
 * critical facts and completion markers a task needs must survive the
 * just-in-time assembly path (`retrieveTaskContext`), not only the full
 * composed context. If a fact only exists in a layer that retrieval drops,
 * the task fails — that is a true-positive detection of context loss, not
 * a benchmark artifact (see docs/token-efficiency-study-notes.md, step 2).
 *
 * Cost is reported (estimated, characters/4) but never gates: this suite is
 * the quality gate; the cost gate is `aiw context-bench`.
 */

export const PARITY_TASK_SCHEMA = 1;

export type ParityTask = {
  schema: number;
  id: string;
  description: string;
  layers: Partial<Record<ContextLayer, string>>;
  criticalFacts: string[];
  completionMarkers: string[];
  /** Project-relative artifact paths loaded into layers before assembly (inter-stage parity). */
  sources?: Partial<Record<ContextLayer, string>>;
  /** Every literal match of these patterns in the loaded sources must survive assembly. */
  requiredPatterns?: string[];
};

export type ParityAssembler = {
  name: string;
  assemble(store: ContextStore): string;
};

/** The default just-in-time assembly path under test. */
export const TASK_ASSEMBLER: ParityAssembler = {
  name: "task-retrieval",
  assemble: retrieveTaskContext,
};

/** The full-context baseline every assembler is compared against. */
export const FULL_ASSEMBLER: ParityAssembler = {
  name: "full-context",
  assemble: composeContext,
};

export type ParityTaskResult = {
  id: string;
  passed: boolean;
  factsTotal: number;
  factsRetained: number;
  missingFacts: string[];
  missingMarkers: string[];
  missingPatterns: string[];
  baselineTokens: number;
  assembledTokens: number;
  tokenDelta: number;
};

export type ParitySuiteResult = {
  schema: number;
  assembler: string;
  total: number;
  passed: number;
  failed: number;
  totalBaselineTokens: number;
  totalAssembledTokens: number;
  results: ParityTaskResult[];
};

export function parseParityTask(content: string): ParityTask {
  const document = parseDocument(content);
  if (document.errors.length) throw new Error(`Parity task is not valid YAML.`);
  const schema = document.get("schema");
  if (schema !== PARITY_TASK_SCHEMA)
    throw new Error(`Parity task schema must be version ${PARITY_TASK_SCHEMA}.`);
  const id = String(document.get("id") ?? "").trim();
  if (!id) throw new Error("Parity task id is required.");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error(`Parity task id must be lowercase letters, numbers, and hyphens: ${id}.`);
  const description = String(document.get("description") ?? "").trim();
  const layersNode = document.get("layers");
  const layers: Partial<Record<ContextLayer, string>> = {};
  if (layersNode !== null && layersNode !== undefined) {
    if (!isMap(layersNode)) throw new Error("Parity task layers must be a mapping.");
    for (const layer of CONTEXT_LAYERS) {
      const value = layersNode.get(layer);
      if (value !== null && value !== undefined) {
        if (typeof value !== "string")
          throw new Error(`Parity task layer ${layer} must be a string.`);
        layers[layer] = value;
      }
    }
  }
  if (!CONTEXT_LAYERS.some((layer) => (layers[layer] ?? "").trim()))
    throw new Error(`Parity task ${id} needs at least one non-empty context layer.`);
  const listOf = (key: string): string[] => {
    const node = document.get(key);
    if (node === null || node === undefined) return [];
    if (!isSeq(node)) throw new Error(`Parity task ${key} must be a list.`);
    return node.items.map((item) => {
      const value = isScalar(item) ? item.value : item;
      if (typeof value !== "string" || !value.trim())
        throw new Error(`Parity task ${key} entries must be non-empty strings.`);
      return value;
    });
  };
  const criticalFacts = listOf("critical_facts");
  const completionMarkers = listOf("completion_markers");
  const requiredPatterns = listOf("required_patterns");
  if (!criticalFacts.length && !completionMarkers.length && !requiredPatterns.length)
    throw new Error(
      `Parity task ${id} needs at least one critical fact, completion marker, or required pattern.`,
    );
  for (const pattern of requiredPatterns)
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Parity task ${id} has an invalid required pattern: ${pattern}`);
    }
  const sourcesNode = document.get("sources");
  const sources: Partial<Record<ContextLayer, string>> = {};
  if (sourcesNode !== null && sourcesNode !== undefined) {
    if (!isMap(sourcesNode))
      throw new Error("Parity task sources must be a mapping of layer to path.");
    for (const layer of CONTEXT_LAYERS) {
      const value = sourcesNode.get(layer);
      if (value === null || value === undefined) continue;
      if (typeof value !== "string" || !value.trim())
        throw new Error(
          `Parity task source for ${layer} must be a non-empty project-relative path.`,
        );
      if (isAbsolute(value) || value.split(/[\\/]/).includes(".."))
        throw new Error(
          `Parity task source for ${layer} must be a safe project-relative path: ${value}`,
        );
      sources[layer] = value;
    }
  }
  return {
    schema: PARITY_TASK_SCHEMA,
    id,
    description,
    layers,
    criticalFacts,
    completionMarkers,
    ...(Object.keys(sources).length ? { sources } : {}),
    ...(requiredPatterns.length ? { requiredPatterns } : {}),
  };
}

/**
 * Load declared artifact sources into their layers (inter-stage parity).
 * Source content is appended after any declared layer content.
 */
export function materializeParityTask(
  task: ParityTask,
  readSource: (path: string) => string,
): ParityTask {
  if (!task.sources) return task;
  const layers = { ...task.layers };
  for (const [layer, path] of Object.entries(task.sources) as [ContextLayer, string][]) {
    let content: string;
    try {
      content = readSource(path);
    } catch (error) {
      throw new Error(
        `Parity task ${task.id} cannot read source ${path}: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }
    layers[layer] = `${layers[layer] ? `${layers[layer].trimEnd()}\n\n` : ""}${content}`;
  }
  return { ...task, layers };
}

/** Run one task: baseline (full context) vs the assembler under test. Exits are pass/fail only. */
export function runParityTask(
  task: ParityTask,
  assembler: ParityAssembler = TASK_ASSEMBLER,
): ParityTaskResult {
  const store: ContextStore = {
    layers: Object.fromEntries(
      CONTEXT_LAYERS.map((layer) => [layer, (task.layers[layer] ?? "").trim()]),
    ) as Record<ContextLayer, string>,
  };
  const baseline = FULL_ASSEMBLER.assemble(store);
  const assembled = assembler.assemble(store);
  const missingFacts = task.criticalFacts.filter((fact) => !assembled.includes(fact));
  const missingMarkers = task.completionMarkers.filter((marker) => !assembled.includes(marker));
  const missingPatterns: string[] = [];
  if (task.requiredPatterns?.length) {
    const sourceContent = CONTEXT_LAYERS.map((layer) => store.layers[layer]).join("\n");
    for (const pattern of task.requiredPatterns) {
      const matches = new Set(sourceContent.match(new RegExp(pattern, "g")) ?? []);
      for (const match of matches)
        if (!assembled.includes(match)) missingPatterns.push(`${pattern} -> ${match}`);
    }
  }
  const baselineTokens = estimateTokens(baseline);
  const assembledTokens = estimateTokens(assembled);
  return {
    id: task.id,
    passed:
      missingFacts.length === 0 && missingMarkers.length === 0 && missingPatterns.length === 0,
    factsTotal: task.criticalFacts.length,
    factsRetained: task.criticalFacts.length - missingFacts.length,
    missingFacts,
    missingMarkers,
    missingPatterns,
    baselineTokens,
    assembledTokens,
    tokenDelta: assembledTokens - baselineTokens,
  };
}

export function runParitySuite(
  tasks: ParityTask[],
  assembler: ParityAssembler = TASK_ASSEMBLER,
): ParitySuiteResult {
  const results = tasks.map((task) => runParityTask(task, assembler));
  return {
    schema: PARITY_TASK_SCHEMA,
    assembler: assembler.name,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    totalBaselineTokens: results.reduce((total, result) => total + result.baselineTokens, 0),
    totalAssembledTokens: results.reduce((total, result) => total + result.assembledTokens, 0),
    results,
  };
}

export function serializeParitySuite(result: ParitySuiteResult): string {
  const lines = [
    `schema: ${result.schema}`,
    `assembler: ${result.assembler}`,
    `tasks: ${result.total}`,
    `passed: ${result.passed}`,
    `failed: ${result.failed}`,
    `total_baseline_tokens: ${result.totalBaselineTokens}`,
    `total_assembled_tokens: ${result.totalAssembledTokens}`,
    "token_estimate: characters/4 (estimated; quality gates are exact containment checks)",
    "results:",
  ];
  for (const entry of result.results) {
    lines.push(
      `  - id: ${entry.id}`,
      `    passed: ${entry.passed}`,
      `    facts: ${entry.factsRetained}/${entry.factsTotal}`,
      `    baseline_tokens: ${entry.baselineTokens}`,
      `    assembled_tokens: ${entry.assembledTokens}`,
    );
    if (entry.missingFacts.length)
      lines.push(...entry.missingFacts.map((fact) => `    missing_fact: ${fact}`));
    if (entry.missingMarkers.length)
      lines.push(...entry.missingMarkers.map((marker) => `    missing_marker: ${marker}`));
    if (entry.missingPatterns.length)
      lines.push(...entry.missingPatterns.map((pattern) => `    missing_pattern: ${pattern}`));
  }
  return lines.join("\n") + "\n";
}
