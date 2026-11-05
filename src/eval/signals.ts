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

type BuildRule = { keys: [string, string][]; evidenceFiles: string[] };

/**
 * Deterministic stack detection over a sorted file listing. Evidence always
 * names real files so downstream proposals cannot cite imaginary tooling.
 * `evidenceFiles` are filtered by presence, so a rule matched by any of its
 * files (for example gradlew without build.gradle.kts) still cites what exists.
 */
const BUILD_RULES: { match: (files: string[]) => boolean; rule: BuildRule }[] = [
  {
    match: (files) =>
      files.some((file) => /^build\.gradle(\.kts)?$/.test(file) || file === "gradlew"),
    rule: {
      keys: [
        ["build.system", "gradle"],
        ["test.command", "./gradlew test"],
      ],
      evidenceFiles: ["build.gradle.kts", "build.gradle", "gradlew"],
    },
  },
  {
    match: (files) => files.includes("pom.xml"),
    rule: {
      keys: [
        ["build.system", "maven"],
        ["test.command", "mvn test"],
      ],
      evidenceFiles: ["pom.xml"],
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
      evidenceFiles: ["pyproject.toml", "setup.py", "setup.cfg"],
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
      evidenceFiles: ["CMakeLists.txt"],
    },
  },
  {
    match: (files) => files.includes("go.mod"),
    rule: {
      keys: [
        ["build.system", "go-modules"],
        ["test.command", "go test ./..."],
      ],
      evidenceFiles: ["go.mod"],
    },
  },
  {
    match: (files) => files.includes("package.json"),
    rule: {
      keys: [
        ["build.system", "node-npm"],
        ["test.command", "npm test"],
      ],
      evidenceFiles: ["package.json"],
    },
  },
];

const PYTHON_FRAMEWORKS = ["django", "flask", "fastapi"] as const;

/**
 * Framework facts come from declared dependencies (file content), never from
 * file presence alone — a plain pyproject or Gradle project gets no framework
 * fact instead of a guess.
 */
function frameworkFor(
  files: string[],
  readFile?: (path: string) => string,
): { value: string; evidence: string } | undefined {
  if (!readFile) return undefined;
  const pythonManifest = ["pyproject.toml", "requirements.txt", "setup.py"].find((file) =>
    files.includes(file),
  );
  if (pythonManifest) {
    const content = readFile(pythonManifest).toLowerCase();
    const match = PYTHON_FRAMEWORKS.find((framework) => content.includes(framework));
    if (match) return { value: match, evidence: pythonManifest };
    return undefined;
  }
  const jvmManifest = ["build.gradle.kts", "build.gradle", "pom.xml"].find((file) =>
    files.includes(file),
  );
  if (jvmManifest && readFile(jvmManifest).toLowerCase().includes("spring"))
    return { value: "spring", evidence: jvmManifest };
  return undefined;
}

export function collectSignals(
  files: string[],
  git?: GitSummary,
  readFile?: (path: string) => string,
): EvidenceBundle {
  const sorted = [...files].sort();
  const facts: SignalFact[] = [];
  let index = 0;
  const push = (key: string, value: string, evidence: string[]): void => {
    index += 1;
    facts.push({ id: `fact-${String(index).padStart(3, "0")}`, key, value, evidence });
  };

  for (const { match, rule } of BUILD_RULES) {
    if (!match(sorted)) continue;
    const evidence = rule.evidenceFiles.filter((file) => sorted.includes(file));
    for (const [key, value] of rule.keys) push(key, value, evidence);
    break;
  }

  const framework = frameworkFor(sorted, readFile);
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
