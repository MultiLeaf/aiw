import type { ContextStore } from "./context-store.js";

export type ContextQuality = {
  layers: number;
  nonEmptyLayers: number;
  characters: number;
  estimatedTokens: number;
  uniqueLines: number;
  duplicateLines: number;
};

export function measureContextQuality(store: ContextStore): ContextQuality {
  const values = Object.values(store.layers);
  const lines = values.flatMap((value) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const uniqueLines = new Set(lines).size;
  return {
    layers: values.length,
    nonEmptyLayers: values.filter((value) => value.trim()).length,
    characters: values.join("\n").length,
    estimatedTokens: Math.ceil(values.join("\n").length / 4),
    uniqueLines,
    duplicateLines: lines.length - uniqueLines,
  };
}

export function serializeContextQuality(metrics: ContextQuality): string {
  return (
    [
      "schema: 1",
      `layers: ${metrics.layers}`,
      `non_empty_layers: ${metrics.nonEmptyLayers}`,
      `characters: ${metrics.characters}`,
      `estimated_tokens: ${metrics.estimatedTokens}`,
      `unique_lines: ${metrics.uniqueLines}`,
      `duplicate_lines: ${metrics.duplicateLines}`,
    ].join("\n") + "\n"
  );
}
