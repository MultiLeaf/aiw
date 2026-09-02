import { RESOURCE_TYPES, type ResourceType } from "./package-contract.js";
import { TARGETS, type Target } from "./types.js";

export const LIFECYCLE_EVENTS = ["install", "update", "remove", "validate"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

export type AdapterCapabilities = {
  target: Target;
  resources: ResourceType[];
  events: LifecycleEvent[];
  fallback: boolean;
};

export const ADAPTER_CAPABILITIES: Readonly<Record<Target, AdapterCapabilities>> = {
  codex: {
    target: "codex",
    resources: [...RESOURCE_TYPES],
    events: [...LIFECYCLE_EVENTS],
    fallback: false,
  },
  claude: {
    target: "claude",
    resources: ["skills", "rules", "agents", "hooks", "templates"],
    events: [...LIFECYCLE_EVENTS],
    fallback: false,
  },
  cursor: {
    target: "cursor",
    resources: ["skills", "rules", "agents", "hooks", "templates"],
    events: [...LIFECYCLE_EVENTS],
    fallback: false,
  },
  gemini: {
    target: "gemini",
    resources: ["skills", "rules", "agents", "hooks", "templates"],
    events: [...LIFECYCLE_EVENTS],
    fallback: false,
  },
  copilot: {
    target: "copilot",
    resources: ["skills", "rules", "agents", "hooks", "templates"],
    events: [...LIFECYCLE_EVENTS],
    fallback: false,
  },
  universal: {
    target: "universal",
    resources: [...RESOURCE_TYPES],
    events: [...LIFECYCLE_EVENTS],
    fallback: true,
  },
};

export function getAdapterCapabilities(target: string): AdapterCapabilities {
  if (!TARGETS.includes(target as Target)) throw new Error(`Unsupported adapter target: ${target}`);
  return ADAPTER_CAPABILITIES[target as Target];
}

export function serializeAdapterCapabilities(target: string): string {
  const capabilities = getAdapterCapabilities(target);
  return `target: ${capabilities.target}\nresources: [${capabilities.resources.join(", ")}]\nevents: [${capabilities.events.join(", ")}]\nfallback: ${capabilities.fallback}\n`;
}
