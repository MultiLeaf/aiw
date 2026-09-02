import { join } from "node:path";
import type { FileSystem } from "./types.js";

export const CONTEXT_LAYERS = ["global", "project", "task", "session"] as const;
export type ContextLayer = (typeof CONTEXT_LAYERS)[number];

export type ContextStore = { layers: Record<ContextLayer, string> };

export function readContextStore(root: string, fs: FileSystem): ContextStore {
  const layers = Object.fromEntries(
    CONTEXT_LAYERS.map((layer) => {
      const path = join(root, ".aiw/context", `${layer}.md`);
      return [layer, fs.exists(path) ? fs.read(path) : ""];
    }),
  ) as Record<ContextLayer, string>;
  return { layers };
}

export function writeContextLayer(
  root: string,
  fs: FileSystem,
  layer: ContextLayer,
  content: string,
): void {
  fs.mkdir(join(root, ".aiw/context"));
  fs.write(
    join(root, ".aiw/context", `${layer}.md`),
    content.endsWith("\n") ? content : `${content}\n`,
  );
}

export function composeContext(store: ContextStore): string {
  return CONTEXT_LAYERS.filter((layer) => store.layers[layer].trim())
    .map((layer) => `# ${layer} context\n\n${store.layers[layer].trim()}`)
    .join("\n\n");
}
