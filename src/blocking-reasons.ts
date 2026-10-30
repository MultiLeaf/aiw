/**
 * Typed reason codes and exact continuations for every blocking CLI exit.
 *
 * Contract (OPP-004, REQ-OPP-004): a blocking output must carry a stable
 * reason code plus either an exact runnable continuation or an explicit
 * terminal statement. A message may name a command only when running that
 * command resolves the block it was printed for. See ADR-001 and
 * docs/opportunities/OPP-004-exact-continuation-commands.md.
 */

export const BLOCKING_REASON_CODES = [
  "gate_evidence_missing",
  "gate_incomplete",
  "stage_prerequisite_pending",
  "stage_prerequisite_unresolved",
  "stage_awaiting_approval",
  "stage_already_approved",
  "approval_evidence_missing",
  "approval_stale",
  "approval_gate_missing",
] as const;

export type BlockingReasonCode = (typeof BLOCKING_REASON_CODES)[number];

/** How the user or agent gets past a block. Exactly one of three kinds. */
export type BlockingContinuation =
  /** An exact runnable `aiw` command with every argument resolved. */
  | { kind: "command"; command: string }
  /** A concrete non-command step (for example, authoring an artifact). */
  | { kind: "action"; description: string }
  /** No in-line continuation exists; a human decision is required. */
  | { kind: "terminal"; humanDecision: string };

/** Resolved context used by continuation producers. */
export type BlockingContext = {
  stage?: string;
  pendingStages?: string[];
  unresolvedStages?: string[];
  artifactPath?: string;
  gateIssues?: string[];
  /** Context-specific human message preferred over the generic definition text. */
  detail?: string;
};

export type BlockingReasonDefinition = {
  code: BlockingReasonCode;
  description: string;
  continuation: (context: BlockingContext) => BlockingContinuation;
};

function command(commandText: string): BlockingContinuation {
  return { kind: "command", command: commandText };
}

function action(description: string): BlockingContinuation {
  return { kind: "action", description };
}

function terminal(humanDecision: string): BlockingContinuation {
  return { kind: "terminal", humanDecision };
}

function firstStage(stages: string[] | undefined): string | undefined {
  return stages && stages.length > 0 ? stages[0] : undefined;
}

export const BLOCKING_REASON_INVENTORY: Readonly<
  Record<BlockingReasonCode, BlockingReasonDefinition>
> = {
  gate_evidence_missing: {
    code: "gate_evidence_missing",
    description: "The quality gate is blocked because the required evidence artifact is missing.",
    continuation: (context) =>
      context.stage && context.artifactPath
        ? action(
            `Create the required artifact at ${context.artifactPath}, then run \`aiw gate ${context.stage}\`.`,
          )
        : terminal("Decide which stage artifact to author before gating."),
  },
  gate_incomplete: {
    code: "gate_incomplete",
    description: "The quality gate found completeness issues in the stage artifact.",
    continuation: (context) =>
      context.stage
        ? action(
            `Fix the gate findings in the stage artifact${context.artifactPath ? ` (${context.artifactPath})` : ""}, then run \`aiw gate ${context.stage}\` again.`,
          )
        : terminal("Fix the gate findings, then rerun the stage gate."),
  },
  stage_prerequisite_pending: {
    code: "stage_prerequisite_pending",
    description: "A previous stage is awaiting human approval before this stage can start.",
    continuation: (context) => {
      const pending = firstStage(context.pendingStages);
      return pending
        ? command(`aiw approve ${pending}`)
        : terminal("Review the pending previous stage with a human.");
    },
  },
  stage_prerequisite_unresolved: {
    code: "stage_prerequisite_unresolved",
    description:
      "Previous stages need human approval or an accepted optional skip before this stage can start.",
    continuation: (context) => {
      const unresolved = firstStage(context.unresolvedStages);
      return unresolved
        ? command(`aiw approve ${unresolved}`)
        : terminal("Resolve the previous stages with a human before continuing.");
    },
  },
  stage_awaiting_approval: {
    code: "stage_awaiting_approval",
    description: "This stage is awaiting human approval; approve or reject it before continuing.",
    continuation: (context) =>
      context.stage
        ? command(`aiw approve ${context.stage}`)
        : terminal("A human must approve or reject the pending stage."),
  },
  stage_already_approved: {
    code: "stage_already_approved",
    description:
      "This stage is already approved; changed evidence requires rerunning its quality gate.",
    continuation: (context) =>
      context.stage
        ? command(`aiw gate ${context.stage}`)
        : terminal("A human must decide whether to rerun the gate for the changed evidence."),
  },
  approval_evidence_missing: {
    code: "approval_evidence_missing",
    description: "Approval cannot be recorded because the stage evidence artifact is missing.",
    continuation: (context) =>
      context.stage && context.artifactPath
        ? action(
            `Create the required artifact at ${context.artifactPath}, then run \`aiw approve ${context.stage}\`.`,
          )
        : terminal("Decide which stage artifact to author before approving."),
  },
  approval_stale: {
    code: "approval_stale",
    description:
      "The artifact changed after review; its approval is stale and the gate must run again.",
    continuation: (context) =>
      context.stage
        ? command(`aiw gate ${context.stage}`)
        : terminal("A human must decide whether to rerun the gate for the changed artifact."),
  },
  approval_gate_missing: {
    code: "approval_gate_missing",
    description: "No passing quality gate is recorded for this stage; gate it before approving.",
    continuation: (context) =>
      context.stage
        ? command(`aiw gate ${context.stage}`)
        : terminal("A human must decide whether to gate the stage before approving."),
  },
};

export function getBlockingReasonDefinition(code: string): BlockingReasonDefinition {
  const definition = BLOCKING_REASON_INVENTORY[code as BlockingReasonCode];
  if (!definition) throw new Error(`Unknown blocking reason code: ${code}`);
  return definition;
}

export type BlockingResult = {
  code: BlockingReasonCode;
  /** Explanation of the block without continuation instructions. */
  message: string;
  continuation: BlockingContinuation;
};

export function describeBlockingReason(
  code: BlockingReasonCode,
  context: BlockingContext,
): BlockingResult {
  const definition = getBlockingReasonDefinition(code);
  return {
    code,
    message: context.detail ?? definition.description,
    continuation: definition.continuation(context),
  };
}

/** Error thrown by blocking CLI paths; carries the typed result for `--json` output. */
export class BlockingError extends Error {
  readonly result: BlockingResult;

  constructor(result: BlockingResult) {
    super(formatBlockingOutput(result));
    this.name = "BlockingError";
    this.result = result;
  }
}

export function formatBlockingOutput(result: BlockingResult): string {
  const prefix = `${result.message} [reason: ${result.code}]`;
  switch (result.continuation.kind) {
    case "command":
      return `${prefix} Next: run \`${result.continuation.command}\`.`;
    case "action":
      return `${prefix} Next: ${result.continuation.description}`;
    case "terminal":
      return `${prefix} Terminal: no automatic continuation. ${result.continuation.humanDecision}`;
  }
}

export type BlockingJson = {
  reason_code: BlockingReasonCode;
  next_command?: string;
  next_action?: string;
  terminal?: boolean;
};

export function blockingResultToJson(result: BlockingResult): BlockingJson {
  switch (result.continuation.kind) {
    case "command":
      return { reason_code: result.code, next_command: result.continuation.command };
    case "action":
      return { reason_code: result.code, next_action: result.continuation.description };
    case "terminal":
      return { reason_code: result.code, terminal: true };
  }
}

const CONTINUATION_KIND_LABEL: Record<BlockingContinuation["kind"], string> = {
  command: "runnable command",
  action: "explicit action",
  terminal: "terminal (human decision)",
};

/** Markdown continuation inventory for docs generation and CI parity checks. */
export function exportContinuationInventoryMarkdown(): string {
  const rows = BLOCKING_REASON_CODES.map((code) => {
    const definition = getBlockingReasonDefinition(code);
    return `| \`${code}\` | ${definition.description} | ${CONTINUATION_KIND_LABEL[commandKind(code)]} |`;
  });
  return ["| Reason code | Description | Continuation |", "| --- | --- | --- |", ...rows].join(
    "\n",
  );
}

function commandKind(code: BlockingReasonCode): BlockingContinuation["kind"] {
  const sample = describeBlockingReason(code, {
    stage: "specification",
    pendingStages: ["brainstorming"],
    unresolvedStages: ["brainstorming"],
    artifactPath: ".aiw/generated/specs/specification.md",
  });
  return sample.continuation.kind;
}
