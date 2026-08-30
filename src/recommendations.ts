import type { ProjectProfile } from "./profile.js";

export type CapabilityRecommendation = {
  id: string;
  provider: string;
  confidence: number;
  rationale: string;
  evidence: string[];
  permissions: string[];
  conflicts: string[];
};
type Capability = {
  id: string;
  provider: string;
  rationale: string;
  permissions?: string[];
  matches: (profile: ProjectProfile) => { evidence: string[]; confidence: number } | undefined;
};

const CATALOG: Capability[] = [
  {
    id: "tdd-development",
    provider: "multileaf",
    rationale: "The project uses automated tests and should preserve test-first development.",
    matches: (profile) =>
      profile.testing
        ? { evidence: [`testing:${profile.testing.name}`], confidence: 1 }
        : undefined,
  },
  {
    id: "typescript-quality",
    provider: "multileaf",
    rationale: "TypeScript is present and benefits from strict, maintainable code-quality rules.",
    matches: (profile) =>
      profile.runtime.languages.includes("typescript")
        ? { evidence: ["language:typescript"], confidence: 1 }
        : undefined,
  },
  {
    id: "vitest-testing",
    provider: "multileaf",
    rationale: "Vitest is configured and can be integrated into the verification workflow.",
    matches: (profile) =>
      profile.testing?.name === "vitest"
        ? { evidence: ["testing:vitest"], confidence: 1 }
        : undefined,
  },
  {
    id: "react-best-practices",
    provider: "vercel-skills",
    rationale:
      "React is detected; framework-specific guidance can improve component design and performance.",
    matches: (profile) =>
      profile.frameworks.includes("react")
        ? { evidence: ["framework:react"], confidence: 1 }
        : undefined,
  },
  {
    id: "nextjs-development",
    provider: "multileaf",
    rationale:
      "Next.js is detected; project-specific conventions can guide routing and rendering decisions.",
    matches: (profile) =>
      profile.frameworks.includes("nextjs")
        ? { evidence: ["framework:nextjs"], confidence: 1 }
        : undefined,
  },
];

export function recommendCapabilities(profile: ProjectProfile): CapabilityRecommendation[] {
  return CATALOG.flatMap((capability) => {
    const match = capability.matches(profile);
    return match
      ? [
          {
            id: capability.id,
            provider: capability.provider,
            confidence: match.confidence,
            rationale: capability.rationale,
            evidence: match.evidence,
            permissions: capability.permissions ?? [],
            conflicts: [],
          },
        ]
      : [];
  });
}

export function serializeRecommendations(
  items: CapabilityRecommendation[],
  selected: string[] = [],
): string {
  return `schema: 1\nrecommendations:\n${items.map((item) => `  - id: ${item.id}\n    provider: ${item.provider}\n    confidence: ${item.confidence}\n    selected: ${selected.includes(item.id)}\n    evidence: [${item.evidence.map((evidence) => `"${evidence}"`).join(", ")}]\n    rationale: ${item.rationale}`).join("\n")}\n`;
}
