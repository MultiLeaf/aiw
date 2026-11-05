import { join } from "path";
import type { FileSystem } from "./types.js";
import type { HumanApprovalStage } from "./types.js";

/** FRIC-005: legacy fixed artifact path per stage (pre-namespacing layout). */
const LEGACY_STAGE_PATHS: Record<HumanApprovalStage, string> = {
  brainstorming: "generated/specs/brainstorm.md",
  specification: "generated/specs/specification.md",
  "technical-design": "generated/reports/technical-design.md",
  plan: "generated/plans/implementation-plan.md",
  implementation: "generated/reports/implementation-report.md",
  verification: "generated/reports/verification-report.md",
  review: "generated/reports/code-review.md",
  traceability: "generated/artifacts/traceability.yml",
  diagnosis: "generated/reports/diagnosis.md",
  assessment: "generated/reports/assessment.md",
};

export type StageArtifactPaths = { scoped: string | undefined; legacy: string };

/** Scoped layout: generated/<kind>/<workflowId>/<name> (ADR-002). */
export function stageArtifactPaths(
  aiw: string,
  stage: HumanApprovalStage,
  workflowId?: string,
): StageArtifactPaths {
  const legacy = join(aiw, LEGACY_STAGE_PATHS[stage]);
  if (!workflowId) return { scoped: undefined, legacy };
  const [, kind, name] = LEGACY_STAGE_PATHS[stage].split("/");
  return { scoped: join(aiw, "generated", kind, workflowId, name), legacy };
}

export type ResolvedStageArtifact = { path: string; legacyFallback: boolean };

/** Prefer the workflow-scoped artifact; fall back to the legacy fixed path (REQ-004). */
export function resolveStageArtifact(
  fs: FileSystem,
  aiw: string,
  stage: HumanApprovalStage,
  workflowId?: string,
): ResolvedStageArtifact {
  const { scoped, legacy } = stageArtifactPaths(aiw, stage, workflowId);
  if (scoped && fs.exists(scoped)) return { path: scoped, legacyFallback: false };
  return { path: legacy, legacyFallback: Boolean(scoped) && fs.exists(legacy) };
}

const KINDS = ["specs", "plans", "reports", "artifacts"] as const;

/** Archive generated/<kind>/<workflowId>/ trees to checkpoints/workflow-<id>-artifacts/ (REQ-005). */
export function archiveWorkflowArtifacts(
  fs: FileSystem,
  aiw: string,
  workflowId: string,
): string[] {
  const archived: string[] = [];
  const destinationRoot = join(aiw, "checkpoints", `workflow-${workflowId}-artifacts`);
  for (const kind of KINDS) {
    const sourceDir = join(aiw, "generated", kind, workflowId);
    if (!fs.exists(sourceDir) || !fs.list) continue;
    const destinationDir = join(destinationRoot, kind);
    const names = fs.list(sourceDir) ?? [];
    if (names.length === 0) continue;
    fs.mkdir(destinationDir);
    for (const name of names) {
      const content = fs.read(join(sourceDir, name));
      fs.write(join(destinationDir, name), content);
      archived.push(`${kind}/${name}`);
    }
  }
  return archived;
}
