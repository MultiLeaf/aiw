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
  requires?: string[];
};
type Capability = Omit<CapabilityRecommendation, "confidence" | "evidence" | "conflicts"> & {
  matches: (profile: ProjectProfile) => { evidence: string[]; confidence: number } | undefined;
  /** Workflow capabilities apply to any project and are always recommended, even without detected signals. */
  universal?: boolean;
};

const local = (resources: RecommendedResource[]): RecommendedResource[] => resources;

const CATALOG: Capability[] = [
  {
    id: "brainstorming",
    provider: "multileaf",
    universal: true,
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
    id: "ticket-driven-development",
    provider: "multileaf",
    universal: true,
    rationale:
      "Work often arrives as a ticket or an already-clear requirement; this entry point starts the SDD flow from the ticket without a brainstorming phase.",
    permissions: [],
    resources: local([
      { type: "skills", id: "ticket" },
      { type: "templates", id: "task" },
    ]),
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.9 }
        : undefined,
  },
  {
    id: "requirements-specification",
    provider: "multileaf",
    universal: true,
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
    universal: true,
    rationale:
      "A traceable implementation plan can connect project requirements, tests, risks, and validation.",
    permissions: [],
    resources: local([
      { type: "skills", id: "implementation-planning" },
      { type: "agents", id: "technical-architect" },
      { type: "templates", id: "implementation-plan" },
    ]),
    requires: ["requirements-specification"],
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.88 }
        : undefined,
  },
  {
    id: "technical-design",
    provider: "multileaf",
    universal: true,
    rationale:
      "Architecture changes benefit from explicit alternatives, trade-offs, and decision records.",
    permissions: [],
    resources: local([
      { type: "skills", id: "technical-design" },
      { type: "agents", id: "technical-architect" },
      { type: "templates", id: "technical-design" },
      { type: "templates", id: "decision-record" },
    ]),
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: 0.82 }
        : undefined,
  },
  {
    id: "code-review",
    provider: "multileaf",
    universal: true,
    rationale:
      "A consistent review checklist helps validate changes against this repository's conventions.",
    permissions: [],
    resources: local([
      { type: "skills", id: "code-review" },
      { type: "agents", id: "quality-reviewer" },
    ]),
    requires: ["verification"],
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
    requires: ["verification"],
    matches: (profile): { evidence: string[]; confidence: number } | undefined => {
      const runners = [
        ...(profile.testing ? [profile.testing] : []),
        ...(profile.modules ?? []).flatMap((module) =>
          module.testing ? [{ ...module.testing, module: module.path }] : [],
        ),
      ];
      return runners.length
        ? {
            evidence: [
              ...new Set(
                runners.flatMap((runner) => [
                  ...("module" in runner ? [`workspace:${runner.module}`] : []),
                  `testing:${runner.name}`,
                  ...(runner.command ? [`test-command:${runner.command}`] : []),
                ]),
              ),
            ],
            confidence: 1,
          }
        : undefined;
    },
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
    id: "nestjs-backend",
    provider: "multileaf",
    rationale:
      "NestJS is detected in this project; its module, dependency-injection, and test conventions can guide backend work.",
    permissions: [],
    resources: local([
      { type: "skills", id: "nestjs-development" },
      { type: "agents", id: "nestjs-engineer" },
      { type: "rules", id: "architecture-policy" },
      { type: "templates", id: "technical-design" },
    ]),
    matches: (profile) =>
      profile.frameworks.includes("nestjs")
        ? { evidence: projectEvidence(profile, "nestjs"), confidence: 1 }
        : undefined,
  },
  {
    id: "prisma-data-access",
    provider: "multileaf",
    rationale:
      "Prisma is detected; schema and data-access changes need migration-aware guidance aligned to the owning workspace.",
    permissions: [],
    resources: local([
      { type: "skills", id: "prisma-data-access" },
      { type: "agents", id: "prisma-engineer" },
      { type: "rules", id: "data-access-policy" },
      { type: "rules", id: "security-policy" },
    ]),
    matches: (profile) =>
      profile.frameworks.includes("prisma")
        ? { evidence: projectEvidence(profile, "prisma"), confidence: 1 }
        : undefined,
  },
  {
    id: "verification",
    provider: "multileaf",
    universal: true,
    rationale:
      "Verification guidance can use the project's detected test runner and quality commands.",
    permissions: [],
    resources: local([
      { type: "skills", id: "verification" },
      { type: "agents", id: "quality-reviewer" },
      { type: "templates", id: "test-plan" },
      { type: "templates", id: "verification-report" },
    ]),
    requires: ["implementation-planning"],
    matches: (profile) =>
      hasProjectSignals(profile)
        ? { evidence: projectEvidence(profile), confidence: profile.testing ? 1 : 0.84 }
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
    id: "vite-frontend",
    provider: "multileaf",
    rationale:
      "Vite is detected; frontend build, test, and module guidance should follow the owning app's framework and scripts.",
    permissions: [],
    resources: local([
      { type: "skills", id: "vite-frontend" },
      { type: "agents", id: "typescript-engineer" },
      { type: "rules", id: "quality-gates" },
      { type: "templates", id: "technical-design" },
    ]),
    matches: (profile) =>
      profile.frameworks.includes("vite")
        ? { evidence: projectEvidence(profile, "vite"), confidence: 1 }
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
    const match =
      capability.matches(profile) ??
      (capability.universal
        ? {
            evidence: [
              "Workflow capability: applies to any project, with or without detected signals.",
            ],
            confidence: 0.9,
          }
        : undefined);
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

export type RecommendationRanking = {
  id: string;
  relevance: number;
  confidence?: number;
};
export type RankedRecommendations = {
  items: CapabilityRecommendation[];
  ranking: RecommendationRanking[];
  changedPositions: number;
};
export type DecisionRanker = (
  profile: ProjectProfile,
  recommendations: CapabilityRecommendation[],
) => Promise<Record<string, { relevance?: number; confidence?: number }>>;

export async function rankRecommendations(
  items: CapabilityRecommendation[],
  profile: ProjectProfile,
  ranker: DecisionRanker,
): Promise<RankedRecommendations> {
  if (items.length === 0) return { items: [], ranking: [], changedPositions: 0 };
  const answers = await ranker(profile, items);
  const ranking: RecommendationRanking[] = [];
  const relevanceById = new Map<string, number | undefined>();
  for (const item of items) {
    const answer = answers[item.id];
    const relevance =
      answer?.relevance !== undefined && Number.isFinite(answer.relevance)
        ? (answer.relevance as number)
        : undefined;
    relevanceById.set(item.id, relevance);
    if (relevance !== undefined)
      ranking.push({
        id: item.id,
        relevance,
        ...(answer?.confidence !== undefined ? { confidence: answer.confidence } : {}),
      });
  }
  const ordered = [...items].sort(
    (a, b) => (relevanceById.get(b.id) ?? -1) - (relevanceById.get(a.id) ?? -1),
  );
  let changedPositions = 0;
  for (let index = 0; index < ordered.length; index += 1)
    if (ordered[index].id !== items[index].id) changedPositions += 1;
  return { items: ordered, ranking, changedPositions };
}

export function resourcesForCapabilities(ids: string[]): RecommendedResource[] {
  const normalizedIds = ids.map((id) => (id === "vitest-testing" ? "verification" : id));
  const selectedCapabilities = new Set(
    CATALOG.filter(({ id }) => normalizedIds.includes(id)).map(({ id }) => id),
  );
  const selectedResources = new Set(normalizedIds.filter((id) => id.includes("/")));
  const resources = CATALOG.flatMap(({ id, resources }) =>
    selectedCapabilities.has(id)
      ? resources
      : resources.filter(({ type, id: resourceId }) =>
          selectedResources.has(`${type}/${resourceId}`),
        ),
  );
  return [
    ...new Map(resources.map((resource) => [`${resource.type}/${resource.id}`, resource])).values(),
  ];
}

export function serializeRecommendations(
  items: CapabilityRecommendation[],
  selected: string[] = [],
  ranking: RecommendationRanking[] = [],
): string {
  const rankingById = new Map(ranking.map((entry) => [entry.id, entry]));
  return `schema: 1\nrecommendations:\n${items
    .map(
      (item) =>
        `  - id: ${item.id}\n    provider: ${item.provider}\n    confidence: ${item.confidence}${
          rankingById.has(item.id)
            ? `\n    decision_relevance: ${rankingById.get(item.id)?.relevance}${
                rankingById.get(item.id)?.confidence !== undefined
                  ? `\n    decision_confidence: ${rankingById.get(item.id)?.confidence}`
                  : ""
              }`
            : ""
        }\n    selected: ${selected.includes(item.id)}\n    requires: [${(item.requires ?? []).join(", ")}]\n    resources: [${item.resources.map(({ type, id }) => `${type}/${id}`).join(", ")}]\n    selected_resources: [${item.resources
          .filter(({ type, id }) => selected.includes(`${type}/${id}`))
          .map(({ type, id }) => `${type}/${id}`)
          .join(
            ", ",
          )}]\n    evidence: [${item.evidence.map((evidence) => `"${evidence}"`).join(", ")}]\n    rationale: ${item.rationale}`,
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

function projectEvidence(profile: ProjectProfile, framework?: string): string[] {
  const moduleEvidence = (profile.modules ?? [])
    .filter((module) => !framework || module.frameworks.includes(framework))
    .flatMap((module) => [
      `workspace:${module.path}`,
      ...module.frameworks.map((name) => `framework:${name}`),
      ...(module.testing ? [`testing:${module.testing.name}`] : []),
      ...(module.testing?.command ? [`test-command:${module.testing.command}`] : []),
    ]);
  return [
    ...profile.runtime.languages.map((language) => `language:${language}`),
    ...profile.frameworks.map((framework) => `framework:${framework}`),
    ...(profile.packageManager === "unknown" ? [] : [`package-manager:${profile.packageManager}`]),
    ...(profile.testing ? [`testing:${profile.testing.name}`] : []),
    ...(profile.quality.linter ? [`linter:${profile.quality.linter.name}`] : []),
    ...(profile.ci.length ? profile.ci.map((system) => `ci:${system}`) : []),
    ...moduleEvidence,
  ];
}
