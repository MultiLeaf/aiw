import type { ProjectProfile } from "./profile.js";

export type EvidenceState = "detected" | "inferred" | "confirmed";
export type EvidenceMethod = "deterministic" | "ai-inference" | "user-confirmed";
export type Evidence = { source: string; reason: string };
export type EvidenceFact = {
  key: string;
  value: string;
  state: EvidenceState;
  method: EvidenceMethod;
  confidence: number;
  requiresConfirmation?: boolean;
  evidence: Evidence[];
};

export function buildFacts(
  profile: ProjectProfile,
  detectedEvidence: { fact: string; source: string }[] = [],
): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const add = (key: string, value: string): void => {
    facts.push({
      key,
      value,
      state: "detected",
      method: "deterministic",
      confidence: 1,
      evidence: detectedEvidence
        .filter(
          (item) =>
            item.fact === key ||
            item.fact.endsWith(`.${value}`) ||
            (key === "tool.linter" && item.fact === "tool.eslint") ||
            (key === "tool.formatter" && item.fact === "tool.prettier") ||
            (key === "tool.testing" && item.fact === `tool.${value}`),
        )
        .map((item) => ({ source: item.source, reason: "" })),
    });
  };
  profile.runtime.languages.forEach((language) => add("runtime.language", language));
  profile.frameworks.forEach((framework) => add("framework", framework));
  if (profile.packageManager !== "unknown") add("package-manager", profile.packageManager);
  if (profile.quality.linter) add("tool.linter", profile.quality.linter.name);
  if (profile.quality.formatter) add("tool.formatter", profile.quality.formatter.name);
  if (profile.testing) add("tool.testing", profile.testing.name);
  profile.ci.forEach((provider) => add("ci.provider", provider));
  profile.workspaces.forEach((workspace) => add("workspace", workspace));
  return facts;
}
