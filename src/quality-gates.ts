import { parseDocument } from "yaml";

export type QualityGateStage =
  | "brainstorming"
  | "product-requirements"
  | "specification"
  | "technical-design"
  | "plan"
  | "implementation"
  | "verification"
  | "review"
  | "traceability"
  | "pr"
  | "diagnosis"
  | "assessment";

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

/**
 * REQ-004: finding triage advisories. Advisory only — a missing triage
 * classification never blocks the gate; reports without `triage` keep passing.
 */
export function triageAdvisories(stage: QualityGateStage, content: string): string[] {
  if (stage !== "review" && stage !== "verification") return [];
  const findings = section(content, "Findings");
  if (!findings || /^none\b/i.test(findings.trim())) return [];
  if (/triage:\s*(auto-fixable|judgment-required)/i.test(findings)) return [];
  return [
    "Advisory: classify every finding as `triage: auto-fixable` or `triage: judgment-required`; agents may only act automatically on auto-fixable findings, and judgment-required findings (redesign, scope, security) must be surfaced to a human.",
  ];
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

  if (stage === "product-requirements")
    return requireSections(content, "PRD", [
      "Problem",
      "Users",
      "Outcomes",
      "Non-goals",
      "Success Signals",
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

  if (stage === "diagnosis") {
    const issues: string[] = [];
    if (!/## Reproduction/.test(content) || !/Command:/.test(content) || !/Observed:/.test(content))
      issues.push("Diagnosis must include a Reproduction with Command and Observed.");
    if (!/## Expected/.test(content) || section(content, "Expected") === undefined)
      issues.push("Diagnosis must state the Expected behavior.");
    if (!/## Root Cause/.test(content) || section(content, "Root Cause") === undefined)
      issues.push("Diagnosis must state an evidence-backed Root Cause.");
    if (!/## Scope/.test(content) || section(content, "Scope") === undefined)
      issues.push("Diagnosis must state the fix Scope.");
    return issues;
  }
  if (stage === "assessment") {
    const issues: string[] = [];
    if (!/## Evidence/.test(content) || section(content, "Evidence") === undefined)
      issues.push("Assessment must include attributed Evidence.");
    const outcome = /\b(go|clarify|stop)\b/i.exec(section(content, "Outcome") ?? "");
    if (!outcome) issues.push("Assessment Outcome must be go, clarify, or stop.");
    if (!/## Rationale/.test(content) || section(content, "Rationale") === undefined)
      issues.push("Assessment must state the Rationale.");
    return issues;
  }

  if (stage === "technical-design") {
    const issues = requireSections(content, "Technical Design", [
      "Context",
      "Proposed Design",
      "Alternatives",
      "Interfaces",
      "Risks",
      "Validation",
    ]);
    // REQ-004: declared consequential decisions must link an ADR path
    // (ratchet: designs without the section pass unchanged; None passes).
    const decisions = section(content, "Consequential Decisions");
    if (decisions !== undefined && !/^none\b/im.test(decisions.trim())) {
      const entries = decisions.split("\n").filter((line) => line.trim().length > 0);
      if (entries.length === 0)
        issues.push("Consequential Decisions must list decisions with ADR paths or state None.");
      for (const entry of entries) {
        const match = entry.match(/\.context\/adrs\/ADR-[^\s)]+\.md/);
        if (!match)
          issues.push(
            `Consequential decision must link an existing ADR path (.context/adrs/ADR-*.md): ${entry.trim().slice(0, 80)}`,
          );
      }
    }
    return issues;
  }

  if (stage === "pr") {
    const issues = requireSections(content, "PR Readiness", [
      "PR Reference",
      "Branch",
      "CI Evidence",
      "Review Comments",
      "Conflict Check",
      "Merge-Ready Checklist",
    ]);
    const prReference = section(content, "PR Reference");
    if (prReference && !/(#\d+|https?:\/\/)/.test(prReference))
      issues.push("PR Reference must record the PR number or URL.");
    const ci = section(content, "CI Evidence");
    if (ci) {
      if (!/pass/i.test(ci))
        issues.push("CI Evidence must record a passing CI result (command, result, link).");
      if (/\bfail/i.test(ci))
        issues.push("CI Evidence records a failing check; resolve it before merge-ready.");
    }
    const comments = section(content, "Review Comments");
    if (comments && !/unresolved[^\n]*:?\s*0/i.test(comments))
      issues.push("Review Comments must record unresolved: 0 with resolution evidence.");
    const conflicts = section(content, "Conflict Check");
    if (conflicts && !/(clean|no conflicts)/i.test(conflicts))
      issues.push("Conflict Check must record a clean merge state.");
    const checklist = section(content, "Merge-Ready Checklist");
    if (checklist) {
      if (!/- \[x\]/.test(checklist))
        issues.push("Merge-Ready Checklist must have every item checked (- [x]).");
      if (/- \[ \]/.test(checklist))
        issues.push("Merge-Ready Checklist has unchecked items; resolve them before merge-ready.");
    }
    return issues;
  }

  if (stage === "plan") {
    const fields = ["Requirement", "Code", "Tests", "Validation", "Evidence"];
    const issues = !/TASK-\d+/.test(content)
      ? ["Implementation plan must define a TASK-### ID."]
      : [];
    for (const field of fields)
      if (!new RegExp(`^[ \\t]*-?[ \\t]*${field}:[ \\t]*\\S+`, "im").test(content))
        issues.push(`Implementation plan task must define ${field}.`);
    // REQ-003: QA test matrix — TC cases linked to requirements (ratchet:
    // plans without a Test Plan section pass unchanged, like paired-verification).
    const testPlan = section(content, "Test Plan");
    if (testPlan !== undefined) {
      const caseIds = [...testPlan.matchAll(/TC-\d+/g)].map((match) => match[0]);
      if (caseIds.length === 0)
        issues.push("Test Plan must define TC-### cases linked to REQ-### requirements.");
      for (const caseId of new Set(caseIds)) {
        const entry = testPlan.match(new RegExp(`^.*${caseId}.*$`, "im"))?.[0] ?? "";
        if (!/REQ-\d+/.test(entry))
          issues.push(`Test case ${caseId} must link to at least one REQ-### requirement.`);
      }
    }
    return issues;
  }

  if (stage === "implementation")
    return requireSections(content, "Implementation Evidence", [
      "Changed Files",
      "Tests",
      "Validation",
      "Deviations",
    ]);

  if (stage === "verification") {
    const issues = requireSections(content, "Verification Report", [
      "Requirements Checked",
      "Checks Passed",
      "Missing Evidence",
      "Residual Risks",
      "Decision",
    ]);
    // REQ-003: executed test cases — when a Test Results section is present,
    // every TC-### must carry a pass result and the command that produced it.
    const results = section(content, "Test Results");
    if (results !== undefined) {
      const caseIds = [...results.matchAll(/TC-\d+/g)].map((match) => match[0]);
      if (caseIds.length === 0)
        issues.push("Test Results must record executed TC-### cases with results.");
      for (const caseId of new Set(caseIds)) {
        const entry = results.match(new RegExp(`^.*${caseId}.*$`, "im"))?.[0] ?? "";
        if (/fail/i.test(entry))
          issues.push(`Test case ${caseId} failed; resolve it before verification passes.`);
        if (!/pass/i.test(entry))
          issues.push(`Test case ${caseId} must record a result (pass/fail).`);
      }
    }
    return issues;
  }

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
