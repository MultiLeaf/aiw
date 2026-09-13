import { createHash } from "node:crypto";
import { parseDocument, stringify } from "yaml";
import { HUMAN_APPROVAL_STAGES, type HumanApprovalStage } from "./types.js";

export const APPROVAL_STAGES = HUMAN_APPROVAL_STAGES;

export type ApprovalStatus =
  "draft" | "pending-human" | "approved" | "rejected" | "skipped" | "stale";
export type QualityGateResult = "not-run" | "passed" | "failed" | "not-applicable";
export type StageApprovalRecord = {
  status: ApprovalStatus;
  qualityGate: QualityGateResult;
  artifactHash?: string;
  reason?: string;
  updatedAt: string;
};
export type ApprovalLedger = {
  schema: 1;
  workflowId: string;
  stages: Partial<Record<HumanApprovalStage, StageApprovalRecord>>;
};
export type WorkflowSession = {
  schema: 1;
  workflowId: string;
  status: "active" | "complete";
  startedAt: string;
  updatedAt: string;
};
export type ApprovalStageDefinition = {
  optional: boolean;
  requiresQualityGate: boolean;
};

const STAGE_DEFINITIONS: Record<HumanApprovalStage, ApprovalStageDefinition> = {
  brainstorming: { optional: true, requiresQualityGate: true },
  specification: { optional: false, requiresQualityGate: true },
  "technical-design": { optional: true, requiresQualityGate: true },
  plan: { optional: false, requiresQualityGate: true },
  implementation: { optional: false, requiresQualityGate: true },
  verification: { optional: false, requiresQualityGate: true },
  review: { optional: false, requiresQualityGate: true },
  traceability: { optional: false, requiresQualityGate: true },
};

const APPROVAL_STATUSES = ["draft", "pending-human", "approved", "rejected", "skipped", "stale"];
const QUALITY_GATE_RESULTS = ["not-run", "passed", "failed", "not-applicable"];
const APPROVAL_RECORD_KEYS = new Set([
  "status",
  "qualityGate",
  "artifactHash",
  "reason",
  "updatedAt",
]);
const LEDGER_KEYS = new Set(["schema", "workflowId", "stages"]);
const SESSION_KEYS = new Set(["schema", "workflowId", "status", "startedAt", "updatedAt"]);

export function createApprovalLedger(workflowId: string): ApprovalLedger {
  assertWorkflowId(workflowId);
  return { schema: 1, workflowId, stages: {} };
}

export function serializeWorkflowSession(session: WorkflowSession): string {
  validateWorkflowSession(session);
  return stringify(session, { lineWidth: 0 });
}

export function parseWorkflowSession(content: string): WorkflowSession {
  const document = parseDocument(content, { uniqueKeys: true, strict: true });
  if (document.errors.length) throw new Error("Workflow session contains invalid YAML.");
  const value: unknown = document.toJS();
  if (!isRecord(value) || value.schema !== 1)
    throw new Error("Workflow session schema must be version 1.");
  for (const key of Object.keys(value))
    if (!SESSION_KEYS.has(key)) throw new Error(`Workflow session has unknown field: ${key}.`);
  if (typeof value.workflowId !== "string")
    throw new Error("Workflow session requires a workflowId.");
  if (value.status !== "active" && value.status !== "complete")
    throw new Error("Workflow session status must be active or complete.");
  if (typeof value.startedAt !== "string" || typeof value.updatedAt !== "string")
    throw new Error("Workflow session requires start and update timestamps.");
  const session: WorkflowSession = {
    schema: 1,
    workflowId: value.workflowId,
    status: value.status,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
  };
  validateWorkflowSession(session);
  return session;
}

export function stageDefinition(stage: HumanApprovalStage): ApprovalStageDefinition {
  return STAGE_DEFINITIONS[stage];
}

export function stageFingerprint(content: string | Uint8Array): string {
  return `sha256-${createHash("sha256").update(content).digest("hex")}`;
}

export function getUnresolvedPrerequisites(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
): HumanApprovalStage[] {
  const stageIndex = APPROVAL_STAGES.indexOf(stage);
  return APPROVAL_STAGES.slice(0, stageIndex).filter((prerequisite) => {
    const status = ledger.stages[prerequisite]?.status;
    return status !== "approved" && status !== "skipped";
  });
}

export function beginStageApproval(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
  input: { artifactHash: string; qualityGate: QualityGateResult; updatedAt: string },
): ApprovalLedger {
  assertHash(input.artifactHash);
  assertTimestamp(input.updatedAt);
  assertPrerequisitesResolved(ledger, stage);
  const definition = stageDefinition(stage);
  if (definition.requiresQualityGate && input.qualityGate !== "passed")
    throw new Error(`The ${stage} quality gate must pass before human review.`);
  if (!definition.requiresQualityGate && input.qualityGate !== "not-applicable")
    throw new Error(`The ${stage} stage has no automated quality gate; use not-applicable.`);

  const existing = ledger.stages[stage];
  if (existing?.status === "approved" && existing.artifactHash === input.artifactHash)
    return ledger;
  const reset =
    existing && (existing.artifactHash !== input.artifactHash || existing.status === "skipped")
      ? invalidateStageAndDescendants(ledger, stage, input.updatedAt)
      : ledger;
  return withStage(reset, stage, {
    status: "pending-human",
    qualityGate: input.qualityGate,
    artifactHash: input.artifactHash,
    updatedAt: input.updatedAt,
  });
}

export function approveStage(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
  input: { artifactHash: string; updatedAt: string },
): ApprovalLedger {
  assertHash(input.artifactHash);
  assertTimestamp(input.updatedAt);
  assertPrerequisitesResolved(ledger, stage);
  const current = ledger.stages[stage];
  if (!current || current.status !== "pending-human")
    throw new Error(`The ${stage} stage is not pending human approval.`);
  if (current.artifactHash !== input.artifactHash)
    throw new Error(`The ${stage} artifact changed after review; request approval again.`);

  return withStage(ledger, stage, { ...current, status: "approved", updatedAt: input.updatedAt });
}

export function rejectStage(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
  reason: string,
  updatedAt: string,
): ApprovalLedger {
  assertTimestamp(updatedAt);
  if (!ledger.stages[stage] || ledger.stages[stage].status !== "pending-human")
    throw new Error(`The ${stage} stage is not pending human approval.`);
  if (!reason.trim()) throw new Error("A reason is required when rejecting a stage.");
  const invalidated = invalidateStageAndDescendants(ledger, stage, updatedAt);
  return withStage(invalidated, stage, {
    ...ledger.stages[stage]!,
    status: "rejected",
    reason: reason.trim(),
    updatedAt,
  });
}

export function skipOptionalStage(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
  input: { reason: string; humanAccepted: boolean; updatedAt: string },
): ApprovalLedger {
  assertTimestamp(input.updatedAt);
  if (!stageDefinition(stage).optional)
    throw new Error(`The ${stage} stage is required and cannot be skipped.`);
  if (!input.humanAccepted)
    throw new Error(`Explicit human acceptance is required to skip ${stage}.`);
  if (!input.reason.trim()) throw new Error(`A reason is required to skip ${stage}.`);
  assertPrerequisitesResolved(ledger, stage);
  const invalidated = invalidateStageAndDescendants(ledger, stage, input.updatedAt);
  return withStage(invalidated, stage, {
    status: "skipped",
    qualityGate: "not-applicable",
    reason: input.reason.trim(),
    updatedAt: input.updatedAt,
  });
}

export function invalidateStageAndDescendants(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
  updatedAt: string,
): ApprovalLedger {
  assertTimestamp(updatedAt);
  const stageIndex = APPROVAL_STAGES.indexOf(stage);
  const stages = { ...ledger.stages };
  for (const affected of APPROVAL_STAGES.slice(stageIndex)) {
    const record = stages[affected];
    if (record && record.status !== "draft")
      stages[affected] = { ...record, status: "stale", updatedAt };
  }
  return { schema: 1, workflowId: ledger.workflowId, stages };
}

export function serializeApprovalLedger(ledger: ApprovalLedger): string {
  validateLedger(ledger);
  const stages = Object.fromEntries(
    APPROVAL_STAGES.flatMap((stage) =>
      ledger.stages[stage] ? [[stage, ledger.stages[stage]]] : [],
    ),
  );
  return stringify({ schema: 1, workflowId: ledger.workflowId, stages }, { lineWidth: 0 });
}

export function parseApprovalLedger(content: string): ApprovalLedger {
  const document = parseDocument(content, { uniqueKeys: true, strict: true });
  if (document.errors.length) throw new Error("Approval ledger contains invalid YAML.");
  const value: unknown = document.toJS();
  if (!isRecord(value) || value.schema !== 1)
    throw new Error("Approval ledger schema must be version 1.");
  for (const key of Object.keys(value))
    if (!LEDGER_KEYS.has(key)) throw new Error(`Approval ledger has unknown field: ${key}.`);
  if (typeof value.workflowId !== "string")
    throw new Error("Approval ledger requires a workflowId.");
  assertWorkflowId(value.workflowId);
  if (!isRecord(value.stages)) throw new Error("Approval ledger stages must be a mapping.");

  const stages: Partial<Record<HumanApprovalStage, StageApprovalRecord>> = {};
  for (const [stageName, record] of Object.entries(value.stages)) {
    if (!isApprovalStage(stageName))
      throw new Error(`Approval ledger has unknown workflow stage: ${stageName}.`);
    stages[stageName] = parseStageRecord(stageName, record);
  }
  const ledger: ApprovalLedger = { schema: 1, workflowId: value.workflowId, stages };
  validateLedger(ledger);
  return ledger;
}

function assertPrerequisitesResolved(ledger: ApprovalLedger, stage: HumanApprovalStage): void {
  const unresolved = getUnresolvedPrerequisites(ledger, stage);
  if (unresolved.length)
    throw new Error(
      `The ${stage} stage is blocked until these stages are approved or explicitly skipped: ${unresolved.join(", ")}.`,
    );
}

function assertHash(value: string): void {
  if (!/^sha256-[a-f0-9]{64}$/.test(value))
    throw new Error("Stage artifact fingerprint must be a SHA-256 hash.");
}

function assertTimestamp(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Approval timestamp must be a valid date-time.");
}

function assertWorkflowId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value))
    throw new Error(
      "Workflow ID must be 1–64 characters using letters, numbers, dot, underscore, or hyphen.",
    );
}

function validateWorkflowSession(session: WorkflowSession): void {
  if (session.schema !== 1) throw new Error("Workflow session schema must be version 1.");
  assertWorkflowId(session.workflowId);
  if (session.status !== "active" && session.status !== "complete")
    throw new Error("Workflow session status must be active or complete.");
  assertTimestamp(session.startedAt);
  assertTimestamp(session.updatedAt);
}

function withStage(
  ledger: ApprovalLedger,
  stage: HumanApprovalStage,
  record: StageApprovalRecord,
): ApprovalLedger {
  return {
    schema: 1,
    workflowId: ledger.workflowId,
    stages: { ...ledger.stages, [stage]: record },
  };
}

function isApprovalStage(value: string): value is HumanApprovalStage {
  return APPROVAL_STAGES.includes(value as HumanApprovalStage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStageRecord(stage: HumanApprovalStage, value: unknown): StageApprovalRecord {
  if (!isRecord(value)) throw new Error(`Approval record for ${stage} must be a mapping.`);
  for (const key of Object.keys(value))
    if (!APPROVAL_RECORD_KEYS.has(key))
      throw new Error(`Approval record for ${stage} has unknown field: ${key}.`);
  const { status, qualityGate, artifactHash, reason, updatedAt } = value;
  if (typeof status !== "string" || !APPROVAL_STATUSES.includes(status))
    throw new Error(`Approval record for ${stage} has an invalid status.`);
  if (typeof qualityGate !== "string" || !QUALITY_GATE_RESULTS.includes(qualityGate))
    throw new Error(`Approval record for ${stage} has an invalid quality gate result.`);
  if (typeof updatedAt !== "string")
    throw new Error(`Approval record for ${stage} requires an updatedAt timestamp.`);
  assertTimestamp(updatedAt);
  if (artifactHash !== undefined) {
    if (typeof artifactHash !== "string")
      throw new Error(`Approval record for ${stage} has an invalid artifact fingerprint.`);
    assertHash(artifactHash);
  }
  if (reason !== undefined && typeof reason !== "string")
    throw new Error(`Approval record for ${stage} has an invalid reason.`);

  const record: StageApprovalRecord = {
    status: status as ApprovalStatus,
    qualityGate: qualityGate as QualityGateResult,
    updatedAt,
    ...(artifactHash === undefined ? {} : { artifactHash }),
    ...(reason === undefined ? {} : { reason }),
  };
  if (record.status === "pending-human" && !record.artifactHash)
    throw new Error(`Pending approval for ${stage} requires an artifact fingerprint.`);
  if (record.status === "approved" && !record.artifactHash)
    throw new Error(`Approved stage ${stage} requires an artifact fingerprint.`);
  if (
    (record.status === "pending-human" || record.status === "approved") &&
    stageDefinition(stage).requiresQualityGate &&
    record.qualityGate !== "passed"
  )
    throw new Error(`Human-reviewed stage ${stage} must have a passing quality gate.`);
  if (!stageDefinition(stage).requiresQualityGate && record.qualityGate !== "not-applicable")
    throw new Error(`Stage ${stage} has no automated quality gate and must use not-applicable.`);
  if (record.status === "skipped") {
    if (!stageDefinition(stage).optional)
      throw new Error(`Required stage ${stage} cannot be skipped.`);
    if (!record.reason?.trim()) throw new Error(`Skipped stage ${stage} requires a reason.`);
  }
  if (record.status === "rejected" && !record.reason?.trim())
    throw new Error(`Rejected stage ${stage} requires a reason.`);
  return record;
}

function validateLedger(ledger: ApprovalLedger): void {
  if (ledger.schema !== 1 || !isRecord(ledger.stages))
    throw new Error("Approval ledger schema must be version 1 with a stages mapping.");
  assertWorkflowId(ledger.workflowId);
  for (const [stage, record] of Object.entries(ledger.stages)) {
    if (!isApprovalStage(stage))
      throw new Error(`Approval ledger has unknown workflow stage: ${stage}.`);
    parseStageRecord(stage, record);
  }
  for (const stage of APPROVAL_STAGES) {
    const status = ledger.stages[stage]?.status;
    if (
      status === "pending-human" ||
      status === "approved" ||
      status === "rejected" ||
      status === "skipped"
    ) {
      const unresolved = getUnresolvedPrerequisites(ledger, stage);
      if (unresolved.length)
        throw new Error(
          `Approval ledger has out-of-order decision for ${stage}; unresolved stages: ${unresolved.join(", ")}.`,
        );
    }
  }
}
