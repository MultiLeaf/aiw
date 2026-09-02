import type { ContextLayer, ContextStore } from "./context-store.js";

export function retrieveTaskContext(store: ContextStore): string {
  return ["global", "project", "task"]
    .map((layer) => store.layers[layer as ContextLayer].trim())
    .filter(Boolean)
    .join("\n\n");
}

export function loadContextDelta(previous: string, current: string): string {
  const known = new Set(previous.split("\n"));
  return current
    .split("\n")
    .filter((line) => line && !known.has(line))
    .join("\n");
}
