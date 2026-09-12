import type { ProjectProfile } from "./profile.js";
import type { ResourceType } from "./package-contract.js";

export type RecommendedResource = { type: ResourceType; id: string };
export type CapabilityRecommendation = {
  id: string;
  provider: string;
  confidence: number;
  rationale: string;
  evidence: string[];
  permissions: string[];
  conflicts: string[];
  resources: RecommendedResource[];
};
type Capability = Omit<CapabilityRecommendation, "confidence" | "evidence" | "conflicts"> & {
  matches: (profile: ProjectProfile) => { evidence: string[]; confidence: number } | undefined;
};

const local = (resources: RecommendedResource[]): RecommendedResource[] => resources;

const CATALOG: Capability[] = [
  {
    id: "brainstorming",
    provider: "multileaf",
    rationale:
      "A project-specific brainstorming flow helps clarify goals and constraints before implementation.",
    permissions: [],
    resources: local([
      { type: "skills", id: "brainstorming" },
      { type: "rules", id: "language-policy" },
      { type: "templates", id: "brainstorm" },
    ]),
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.92 }
        : undefined,
  },
  {
    id: "requirements-specification",
    provider: "multileaf",
    rationale:
      "The project can use explicit requirements and acceptance criteria before changes are planned.",
    permissions: [],
    resources: local([
      { type: "skills", id: "requirements-specification" },
      { type: "agents", id: "requirements-analyst" },
      { type: "templates", id: "specification" },
    ]),
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.9 }
        : undefined,
  },
  {
    id: "implementation-planning",
    provider: "multileaf",
    rationale:
      "A traceable implementation plan can connect project requirements, tests, risks, and validation.",
    permissions: [],
    resources: local([
      { type: "skills", id: "implementation-planning" },
      { type: "agents", id: "technical-architect" },
      { type: "templates", id: "implementation-plan" },
    ]),
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.88 }
        : undefined,
  },
  {
    id: "code-review",
    provider: "multileaf",
    rationale:
      "A consistent review checklist helps validate changes against this repository's conventions.",
    permissions: [],
    resources: local([
      { type: "skills", id: "code-review" },
      { type: "agents", id: "quality-reviewer" },
    ]),
    matches: (profile) =>
      profile.runtime.languages.length
        ? { evidence: projectEvidence(profile), confidence: 0.86 }
        : undefined,
  },
  {
    id: "tdd-development",
    provider: "multileaf",
    rationale:
      "The project uses automated tests and can apply test-first development with its existing runner.",
    permissions: [],
    resources: local([
      { type: "skills", id: "tdd-development" },
      { type: "rules", id: "tdd-policy" },
      { type: "agents", id: "test-engineer" },
      { type: "hooks", id: "pre-implementation" },
      { type: "hooks", id: "post-implementation" },
      { type: "templates", id: "test-plan" },
    ]),
    matches: (profile) =>
      profile.testing
        ? { evidence: [`testing:${profile.testing.name}`], confidence: 1 }
        : undefined,
  },
  {
    id: "typescript-quality",
    provider: "multileaf",
    rationale:
      "TypeScript is detected; add its specialist and tailor quality guidance to the repository's tools.",
    permissions: [],
    resources: local([
      { type: "agents", id: "typescript-engineer" },
      { type: "rules", id: "quality-gates" },
    ]),
    matches: (profile) =>
      profile.runtime.languages.includes("typescript")
        ? { evidence: ["language:typescript"], confidence: 1 }
        : undefined,
  },
  {
    id: "vitest-testing",
    provider: "multileaf",
    rationale:
      "Vitest is configured and can be used by the verification skill and test specialist.",
    permissions: [],
    resources: local([
      { type: "skills", id: "verification" },
      { type: "agents", id: "test-engineer" },
      { type: "templates", id: "test-plan" },
      { type: "templates", id: "verification-report" },
    ]),
    matches: (profile) =>
      profile.testing?.name === "vitest"
        ? { evidence: ["testing:vitest"], confidence: 1 }
        : undefined,
  },
  {
    id: "react-best-practices",
    provider: "vercel-skills",
    rationale:
      "React is detected; framework guidance can improve component design and performance.",
    permissions: ["network:external"],
    resources: local([
      { type: "skills", id: "technical-design" },
      { type: "agents", id: "technical-architect" },
      { type: "rules", id: "architecture-policy" },
      { type: "templates", id: "technical-design" },
    ]),
    matches: (profile) =>
      profile.frameworks.includes("react")
        ? { evidence: ["framework:react"], confidence: 1 }
        : undefined,
  },
  {
    id: "nextjs-development",
    provider: "multileaf",
    rationale:
      "Next.js is detected; architecture guidance can follow the project's framework conventions.",
    permissions: [],
    resources: local([
      { type: "skills", id: "technical-design" },
      { type: "agents", id: "technical-architect" },
      { type: "rules", id: "architecture-policy" },
      { type: "templates", id: "technical-design" },
    ]),
    matches: (profile) =>
      profile.frameworks.includes("nextjs")
        ? { evidence: ["framework:nextjs"], confidence: 1 }
        : undefined,
  },
  {
    id: "security-review",
    provider: "multileaf",
    rationale:
      "The detected stack and package tooling benefit from project-aware security and dependency review.",
    permissions: [],
    resources: local([
      { type: "skills", id: "security-review" },
      { type: "rules", id: "security-policy" },
      { type: "rules", id: "dependency-policy" },
      { type: "agents", id: "security-reviewer" },
      { type: "templates", id: "security-review" },
    ]),
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.83 }
        : undefined,
  },
];

export function recommendCapabilities(profile: ProjectProfile): CapabilityRecommendation[] {
  return CATALOG.flatMap((capability) => {
    const match = capability.matches(profile);
    return match
      ? [
          {
            ...capability,
            confidence: match.confidence,
            evidence: match.evidence,
            conflicts: [],
          },
        ]
      : [];
  });
}

export function resourcesForCapabilities(ids: string[]): RecommendedResource[] {
  const selected = new Set(ids);
  const resources = CATALOG.filter(({ id }) => selected.has(id)).flatMap(
    ({ resources }) => resources,
  );
  return [
    ...new Map(resources.map((resource) => [`${resource.type}/${resource.id}`, resource])).values(),
  ];
}

export function serializeRecommendations(
  items: CapabilityRecommendation[],
  selected: string[] = [],
): string {
  return `schema: 1\nrecommendations:\n${items
    .map(
      (item) =>
        `  - id: ${item.id}\n    provider: ${item.provider}\n    confidence: ${item.confidence}\n    selected: ${selected.includes(item.id)}\n    resources: [${item.resources.map(({ type, id }) => `${type}/${id}`).join(", ")}]\n    evidence: [${item.evidence.map((evidence) => `"${evidence}"`).join(", ")}]\n    rationale: ${item.rationale}`,
    )
    .join("\n")}\n`;
}

function hasProjectSignals(profile: ProjectProfile): boolean {
  return Boolean(
    profile.runtime.languages.length ||
    profile.frameworks.length ||
    profile.packageManager !== "unknown" ||
    profile.testing ||
    profile.quality.linter ||
    profile.ci.length,
  );
}

function projectEvidence(profile: ProjectProfile): string[] {
  return [
    ...profile.runtime.languages.map((language) => `language:${language}`),
    ...profile.frameworks.map((framework) => `framework:${framework}`),
    ...(profile.packageManager === "unknown" ? [] : [`package-manager:${profile.packageManager}`]),
    ...(profile.testing ? [`testing:${profile.testing.name}`] : []),
    ...(profile.quality.linter ? [`linter:${profile.quality.linter.name}`] : []),
    ...(profile.ci.length ? profile.ci.map((system) => `ci:${system}`) : []),
  ];
}
