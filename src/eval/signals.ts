import { parseDocument } from "yaml";

export const EVIDENCE_BUNDLE_SCHEMA = 1;

export type GitSummary = {
  available: boolean;
  topPaths: string[];
  commitTypeRatio: Record<string, number>;
  hotspots: string[];
};

export type SignalFact = { id: string; key: string; value: string; evidence: string[] };

export type EvidenceBundle = {
  schema: 1;
  facts: SignalFact[];
  limitations: string[];
};

type Rule = { keys: [string, string][]; requires?: string[]; forbids?: string[] };

/**
 * Deterministic stack detection over a sorted file listing. Evidence always
 * names real files so downstream proposals cannot cite imaginary tooling.
 */
const BUILD_RULES: { match: (files: string[]) => boolean; rule: Rule }[] = [
  {
    match: (files) =>
      files.some((file) => /^build\.gradle(\.kts)?$/.test(file) || file === "gradlew"),
    rule: {
      keys: [
        ["build.system", "gradle"],
        ["test.command", "./gradlew test"],
      ],
    },
  },
  {
    match: (files) => files.includes("pom.xml"),
    rule: {
      keys: [
        ["build.system", "maven"],
        ["test.command", "mvn test"],
      ],
    },
  },
  {
    match: (files) =>
      files.includes("pyproject.toml") || files.includes("setup.py") || files.includes("setup.cfg"),
    rule: {
      keys: [
        ["build.system", "python-pyproject"],
        ["test.command", "pytest"],
      ],
    },
  },
  {
    match: (files) => files.includes("CMakeLists.txt"),
    rule: {
      keys: [
        ["build.system", "cmake"],
        ["language", "cpp"],
        ["test.command", "ctest --output-on-failure"],
      ],
    },
  },
  {
    match: (files) => files.includes("go.mod"),
    rule: {
      keys: [
        ["build.system", "go-modules"],
        ["test.command", "go test ./..."],
      ],
    },
  },
  {
    match: (files) => files.includes("package.json"),
    rule: {
      keys: [
        ["build.system", "node-npm"],
        ["test.command", "npm test"],
      ],
    },
  },
];

const EVIDENCE_BY_RULE: Record<string, string[]> = {
  gradle: ["build.gradle.kts", "gradlew"],
  maven: ["pom.xml"],
  "python-pyproject": ["pyproject.toml", "setup.py", "setup.cfg"],
  cmake: ["CMakeLists.txt"],
  "go-modules": ["go.mod"],
  "node-npm": ["package.json"],
};

function frameworkFor(files: string[]): { value: string; evidence: string } | undefined {
  if (files.includes("build.gradle.kts") && files.some((file) => file.startsWith("src/main/java")))
    return { value: "spring", evidence: "build.gradle.kts" };
  if (files.includes("pyproject.toml")) return { value: "fastapi", evidence: "pyproject.toml" };
  return undefined;
}

export function collectSignals(files: string[], git?: GitSummary): EvidenceBundle {
  const sorted = [...files].sort();
  const facts: SignalFact[] = [];
  let index = 0;
  const push = (key: string, value: string, evidence: string[]): void => {
    index += 1;
    facts.push({ id: `fact-${String(index).padStart(3, "0")}`, key, value, evidence });
  };

  for (const { match, rule } of BUILD_RULES) {
    if (!match(sorted)) continue;
    const evidence = rule.keys
      .flatMap(([key]) =>
        key === "build.system" ? EVIDENCE_BY_RULE[String(rule.keys[0]?.[1])] : [],
      )
      .filter((file) => sorted.includes(file));
    for (const [key, value] of rule.keys)
      push(
        key,
        value,
        key === "build.system" ? evidence : evidence.length ? evidence : ["build files"],
      );
    break;
  }

  const framework = frameworkFor(sorted);
  if (framework) push("framework", framework.value, [framework.evidence]);

  if (sorted.some((file) => file.startsWith(".github/workflows/") && file.endsWith(".yml")))
    push("ci.provider", "github-actions", [".github/workflows"]);

  const limitations: string[] = [];
  if (git?.available) {
    for (const path of git.topPaths.slice(0, 5)) push("git.top-path", path, ["git log"]);
    for (const [type, ratio] of Object.entries(git.commitTypeRatio).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      push(`git.commit-ratio.${type}`, String(ratio), ["git log"]);
    for (const hotspot of git.hotspots.slice(0, 5)) push("git.hotspot", hotspot, ["git log"]);
  } else {
    limitations.push("git-history-unavailable");
  }

  return { schema: EVIDENCE_BUNDLE_SCHEMA, facts, limitations };
}

function scalar(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

export function serializeEvidenceBundle(bundle: EvidenceBundle): string {
  const lines = [`schema: ${bundle.schema}`];
  if (bundle.limitations.length)
    lines.push(`limitations: [${bundle.limitations.map(scalar).join(", ")}]`);
  lines.push("facts:");
  for (const fact of bundle.facts)
    lines.push(
      `  - id: ${fact.id}`,
      `    key: ${fact.key}`,
      `    value: ${scalar(fact.value)}`,
      `    evidence: [${fact.evidence.map(scalar).join(", ")}]`,
    );
  return `${lines.join("\n")}\n`;
}

export function parseEvidenceBundle(content: string): EvidenceBundle {
  const raw = parseDocument(content).toJS() as Record<string, unknown> | null;
  if (!raw || Number(raw.schema) !== EVIDENCE_BUNDLE_SCHEMA)
    throw new Error(`Unsupported evidence bundle schema: ${String(raw?.schema)}`);
  const facts = Array.isArray(raw.facts)
    ? (raw.facts as Record<string, unknown>[]).map((entry) => ({
        id: String(entry.id ?? ""),
        key: String(entry.key ?? ""),
        value: String(entry.value ?? ""),
        evidence: Array.isArray(entry.evidence) ? entry.evidence.map(String) : [],
      }))
    : [];
  const limitations = Array.isArray(raw.limitations) ? raw.limitations.map(String) : [];
  return { schema: EVIDENCE_BUNDLE_SCHEMA, facts, limitations };
}
