import { parseDocument } from "yaml";

export type QualityGateStage =
  | "brainstorming"
  | "specification"
  | "technical-design"
  | "plan"
  | "implementation"
  | "verification"
  | "review"
  | "traceability";

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
  if (stage === "brainstorming")
    return requireSections(content, "Brainstorm", [
      "Goal",
      "Users",
      "Constraints",
      "Risks",
      "Non-goals",
    ]);

  if (stage === "specification") {
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

  if (stage === "technical-design")
    return requireSections(content, "Technical Design", [
      "Context",
      "Proposed Design",
      "Alternatives",
      "Interfaces",
      "Risks",
      "Validation",
    ]);

  if (stage === "plan") {
    const fields = ["Requirement", "Code", "Tests", "Validation", "Evidence"];
    const issues = !/TASK-\d+/.test(content)
      ? ["Implementation plan must define a TASK-### ID."]
      : [];
    for (const field of fields)
      if (!new RegExp(`^[ \\t]*-?[ \\t]*${field}:[ \\t]*\\S+`, "im").test(content))
        issues.push(`Implementation plan task must define ${field}.`);
    return issues;
  }

  if (stage === "implementation")
    return requireSections(content, "Implementation Evidence", [
      "Changed Files",
      "Tests",
      "Validation",
      "Deviations",
    ]);

  if (stage === "verification")
    return requireSections(content, "Verification Report", [
      "Requirements Checked",
      "Checks Passed",
      "Missing Evidence",
      "Residual Risks",
      "Decision",
    ]);

  if (stage === "review")
    return requireSections(content, "Code Review", [
      "Scope",
      "Findings",
      "Checks",
      "Residual Risks",
      "Decision",
    ]);

  const document = parseDocument(content, { uniqueKeys: true, strict: true });
  if (document.errors.length) return ["Traceability evidence must be valid YAML."];
  const value: unknown = document.toJS();
  if (!isRecord(value) || value.schema !== 1 || !Array.isArray(value.links))
    return ["Traceability evidence must define schema: 1 and a links list."];
  if (value.links.length === 0)
    return ["Traceability evidence must link at least one requirement."];
  const fields = ["requirement", "tasks", "code", "tests", "evidence"];
  return value.links.flatMap((link, index) => {
    if (!isRecord(link)) return [`Traceability link ${index + 1} must be a mapping.`];
    return fields.flatMap((field) => {
      const fieldValue = link[field];
      return field === "requirement"
        ? typeof fieldValue === "string" && /^REQ-\d+$/.test(fieldValue)
          ? []
          : [`Traceability link ${index + 1} requires a valid requirement ID.`]
        : Array.isArray(fieldValue) && fieldValue.length > 0
          ? []
          : [`Traceability link ${index + 1} requires non-empty ${field} evidence.`];
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
