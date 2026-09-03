export type QualityGateStage = "specification" | "plan" | "verification";

function section(content: string, heading: string): string | undefined {
  const match = content.match(
    new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "im"),
  );
  return match?.[1].trim();
}

function requireSections(content: string, artifact: string, headings: string[]): string[] {
  return headings.flatMap((heading) => {
    const value = section(content, heading);
    if (value === undefined) return [`${artifact} section ${heading} is missing.`];
    return value ? [] : [`${artifact} section ${heading} must contain content.`];
  });
}

export function evaluateQualityGate(stage: QualityGateStage, content: string): string[] {
  if (stage === "specification")
    return requireSections(content, "Brainstorm", [
      "Goal",
      "Users",
      "Constraints",
      "Risks",
      "Non-goals",
    ]);

  if (stage === "plan") {
    const issues: string[] = [];
    if (!/REQ-\d+/.test(content)) issues.push("Specification must define a stable REQ-### ID.");
    if (!/Acceptance criteria/i.test(content))
      issues.push("Specification requirements must define acceptance criteria.");
    if (
      !["Given", "When", "Then"].every((word) =>
        new RegExp(`\\b${word}[ \\t]+\\S+`, "i").test(content),
      )
    )
      issues.push("Requirement acceptance criteria must use Given, When, and Then.");
    return issues;
  }

  const fields = ["Requirement", "Code", "Tests", "Validation", "Evidence"];
  const issues = !/TASK-\d+/.test(content)
    ? ["Implementation plan must define a TASK-### ID."]
    : [];
  for (const field of fields)
    if (!new RegExp(`^\\s*-?\\s*${field}:\\s*\\S+`, "im").test(content))
      issues.push(`Implementation plan task must define ${field}.`);
  return issues;
}
