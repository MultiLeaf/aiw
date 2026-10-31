/**
 * Deterministic, content-based risk classification for changed paths (OPP-002,
 * REQ-OPP-002). Risk is classified by WHAT changed, never by how much: a
 * documentation-only diff is passive; two lines of authentication code are
 * high. Rules are path-based approximations, deliberately biased toward
 * `high` — a failed or uncertain assessment never implies low risk.
 *
 * The six high-risk items follow the escalation list of the source concept
 * (RDD `review assess`): 1 data/irreversible effects, 2 security,
 * 3 contracts others consume, 4 concurrency, 5 delivery/environment,
 * 6 no test would catch a regression.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { CommandResult, FileSystem } from "./types.js";

export type RiskTier = "passive" | "medium" | "high";

export type RiskCategoryCode =
  | "data_irreversible"
  | "security"
  | "consumed_contract"
  | "concurrency"
  | "delivery_environment"
  | "untested_regression";

export type RiskReason = {
  code: RiskCategoryCode | "agent_escalation";
  path?: string;
  detail?: string;
};

export type ChangedFile = { path: string };

export type RiskCategory = {
  item: 1 | 2 | 3 | 4 | 5 | 6;
  code: RiskCategoryCode;
  description: string;
};

export const RISK_CATEGORIES: readonly RiskCategory[] = [
  {
    item: 1,
    code: "data_irreversible",
    description: "Data or irreversible effects: migrations, schema, destructive data operations.",
  },
  {
    item: 2,
    code: "security",
    description:
      "Security: authentication, authorization, credentials, secrets, cryptography, sessions, permissions.",
  },
  {
    item: 3,
    code: "consumed_contract",
    description:
      "Contracts others consume: package manifests, public type declarations, API schemas.",
  },
  {
    item: 4,
    code: "concurrency",
    description: "Concurrency: workers, pools, locks, queues, and other shared-state primitives.",
  },
  {
    item: 5,
    code: "delivery_environment",
    description:
      "Delivery or environment: CI pipelines, containers, deployment, release and install scripts.",
  },
  {
    item: 6,
    code: "untested_regression",
    description: "No test would catch a regression: changed source with no covering test detected.",
  },
] as const;

type CategoryMatcher = { code: RiskCategoryCode; pattern: RegExp };

/**
 * Path rules are intentionally broad: over-flagging costs one review, while
 * under-flagging ships unreviewed risk. Test files are excluded before
 * matching so test-only changes stay out of the high categories.
 */
const CATEGORY_RULES: readonly CategoryMatcher[] = [
  {
    code: "data_irreversible",
    pattern: /(^|\/)(migrations?|db\/migrate)\//i,
  },
  { code: "data_irreversible", pattern: /migration|schema\.prisma$/i },
  {
    code: "security",
    pattern:
      /(^|\/)(auth|login|credential|secret|token|password|session|permission|acl)\b|(^|\/)(crypto|ssl|tls|jwt)|\bsecurity\b|\.env/i,
  },
  {
    code: "consumed_contract",
    pattern:
      /(^|\/)(package|pyproject|cargo|go)\.(json|toml)$|\.d\.ts$|(^|\/)(api|openapi|swagger)(\/|$)|\.graphql$|\.proto$/i,
  },
  {
    code: "concurrency",
    pattern: /worker|pool|lock|queue|mutex|atomic|parallel|thread|scheduler/i,
  },
  {
    code: "delivery_environment",
    pattern:
      /(^|\/)\.github\/workflows\/|dockerfile|docker-compose|jenkinsfile|gitlab-ci|(^|\/)(ci|deploy|helm|k8s|terraform)(\/|\.|$)|(^|\/)scripts\/(release|install|deploy)|(^|\/)release-|\.npmrc$|^makefile$/i,
  },
];

/** Documentation is passive by its own nature (path approximation). */
const PASSIVE_PATTERN =
  /\.(md|rst|adoc|txt)|(^|\/)(docs?|documentation)(\/|$)|(^|\/)(license|licence|changelog|notice|authors|contributors)(\.|$)/i;

const TEST_FILE_PATTERN =
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$|(^|\/)(__tests__|tests?|e2e)(\/|$)/i;

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|sql|sh)$/i;

/**
 * Workflow-managed state (`.aiw/`) is never authored source: excluding it
 * keeps `aiw`'s own lockfiles, checkpoints, and generated artifacts out of
 * the risk picture (a real-flow defect: `.aiw/lock.yml` matched "lock").
 */
const WORKFLOW_STATE_PATTERN = /(^|\/)\.aiw\//;

export type AssessOptions = {
  /**
   * Predicate telling whether a changed source file has a covering test.
   * When absent, the untested_regression category is not asserted
   * (unknown is not low; the tier then rests on the other categories).
   */
  hasCoveringTest?: (path: string) => boolean;
};

export type RiskAssessment = {
  tier: RiskTier;
  reasons: RiskReason[];
  changedPaths: string[];
};

export function assessRisk(
  changes: readonly ChangedFile[],
  options: AssessOptions = {},
): RiskAssessment {
  const reasons: RiskReason[] = [];
  let anyCode = false;
  const isTestCovered = options.hasCoveringTest;
  for (const change of changes) {
    if (WORKFLOW_STATE_PATTERN.test(change.path)) continue;
    const isPassive = PASSIVE_PATTERN.test(change.path);
    const isTest = TEST_FILE_PATTERN.test(change.path);
    if (!isPassive) anyCode = true;
    // Passive documentation never ships executable risk; test files are
    // evidence, not surface. Neither triggers the high-risk categories.
    if (isPassive || isTest) continue;
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(change.path)) reasons.push({ code: rule.code, path: change.path });
    }
    if (isTestCovered && SOURCE_FILE_PATTERN.test(change.path) && !isTestCovered(change.path)) {
      reasons.push({ code: "untested_regression", path: change.path });
    }
  }
  const tier: RiskTier = reasons.length > 0 ? "high" : anyCode ? "medium" : "passive";
  return { tier, reasons, changedPaths: changes.map((change) => change.path) };
}

const CATEGORY_BY_ITEM = new Map<number, RiskCategory>(
  RISK_CATEGORIES.map((category) => [category.item, category]),
);

const RISK_ASSESS_SCHEMA = "aiw.risk-assessment/v1";
const RISK_ASSESS_USAGE =
  "Usage: aiw risk assess [--base-ref=ref] [--ticket=ID] [--escalate-item=1-6 --escalate-reason=text] [--json]";

/** Raw git output lines: no per-line trimming — porcelain columns are fixed-width. */
function gitRawLines(root: string, args: string[]): string[] | undefined {
  try {
    const output = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

function gitLines(root: string, args: string[]): string[] | undefined {
  return gitRawLines(root, args)?.map((line) => line.trim());
}

/** Working-tree changes from `git status --porcelain` (staged, unstaged, untracked). */
function workingTreeChanges(root: string): string[] | undefined {
  const lines = gitRawLines(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (!lines) return undefined;
  return lines.map((line) => {
    const path = line.slice(3).trim();
    const renameArrow = path.indexOf(" -> ");
    return renameArrow === -1 ? path : path.slice(renameArrow + 4);
  });
}

function committedRangeChanges(root: string, baseRef: string): string[] | undefined {
  return gitLines(root, ["diff", "--name-only", `${baseRef}...HEAD`]);
}

/** Deterministic covering-test probe: sibling *.test.* / *.spec.* variants. */
function hasCoveringTest(root: string, fs: FileSystem): (path: string) => boolean {
  return (path) => {
    const directory = path.slice(0, path.lastIndexOf("/"));
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot === -1 ? base : base.slice(0, dot);
    const extension = dot === -1 ? "" : base.slice(dot);
    const candidates = [`${stem}.test${extension}`, `${stem}.spec${extension}`].map((name) =>
      join(root, directory, name),
    );
    return candidates.some((candidate) => fs.exists(candidate));
  };
}

function parseRiskAssessArgs(
  rest: string[],
):
  | { baseRef?: string; ticket?: string; escalateItem?: number; escalateReason?: string }
  | undefined {
  const parsed: {
    baseRef?: string;
    ticket?: string;
    escalateItem?: number;
    escalateReason?: string;
  } = {};
  for (const argument of rest) {
    const match = argument.match(/^--([a-z-]+)=(.*)$/);
    if (!match) return undefined;
    const [, name, value] = match;
    if (name === "base-ref") parsed.baseRef = value;
    else if (name === "ticket") parsed.ticket = value;
    else if (name === "escalate-item") {
      if (!/^\d+$/.test(value)) return undefined;
      parsed.escalateItem = Number(value);
    } else if (name === "escalate-reason") parsed.escalateReason = value;
    else return undefined;
  }
  if (
    (parsed.escalateItem === undefined) !== (parsed.escalateReason === undefined) ||
    (parsed.ticket !== undefined && parsed.ticket.length === 0)
  )
    return undefined;
  return parsed;
}

export async function runRiskAssess(
  args: string[],
  root: string,
  fs: FileSystem,
): Promise<CommandResult> {
  const jsonRequested = args.includes("--json");
  const parsed = parseRiskAssessArgs(args.filter((argument) => argument !== "--json"));
  if (!parsed) return { exitCode: 1, error: RISK_ASSESS_USAGE };

  const insideWorkTree = gitLines(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideWorkTree || insideWorkTree[0] !== "true")
    return {
      exitCode: 1,
      error:
        "risk assess requires a git repository; run it inside one or pass --base-ref for a committed range.",
    };

  const changedPaths = parsed.baseRef
    ? committedRangeChanges(root, parsed.baseRef)
    : workingTreeChanges(root);
  if (!changedPaths)
    return {
      exitCode: 1,
      error: `git failed to enumerate changes${parsed.baseRef ? ` for --base-ref=${parsed.baseRef}` : ""}; verify the reference exists.`,
    };

  let assessment = assessRisk(
    changedPaths.map((path) => ({ path })),
    { hasCoveringTest: hasCoveringTest(root, fs) },
  );
  if (parsed.escalateItem !== undefined && parsed.escalateReason !== undefined) {
    try {
      assessment = applyEscalation(assessment, parsed.escalateItem, parsed.escalateReason);
    } catch (error) {
      return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const riskDue = assessment.tier === "high";
  const activeWorkflow = fs.exists(join(root, ".aiw", "workflow.yml"));
  const nextCommand = riskDue && !activeWorkflow ? "aiw workflow start" : undefined;
  const nextAction =
    riskDue && activeWorkflow
      ? "Continue the active workflow: gate and approve the stages this change touches."
      : undefined;

  if (jsonRequested) {
    const envelope: Record<string, unknown> = {
      schema: RISK_ASSESS_SCHEMA,
      risk: assessment.tier,
      reasons: assessment.reasons,
      changed_paths: assessment.changedPaths.length,
      risk_due: riskDue,
    };
    if (parsed.ticket) envelope.ticket = parsed.ticket;
    if (nextCommand) envelope.next_command = nextCommand;
    if (nextAction) envelope.next_action = nextAction;
    return { exitCode: 0, output: JSON.stringify(envelope, null, 2) };
  }

  const lines = [`risk: ${assessment.tier}`];
  for (const reason of assessment.reasons)
    lines.push(
      `  - ${reason.code}${reason.path ? `: ${reason.path}` : reason.detail ? ` (${reason.detail})` : ""}`,
    );
  const next = nextCommand
    ? `risk due: yes -> ${nextCommand}`
    : nextAction
      ? `risk due: yes -> ${nextAction}`
      : "risk due: no";
  lines.push(next);
  return { exitCode: 0, output: lines.join("\n") };
}

/**
 * Agent escalation (RDD parity): an agent may raise — never lower — the tier
 * citing one of the six high-risk items. Item must be 1..6; the reason is a
 * non-empty single line of at most 500 bytes.
 */
export function applyEscalation(
  assessment: RiskAssessment,
  item: number,
  reason: string,
): RiskAssessment {
  if (!Number.isInteger(item) || item < 1 || item > 6)
    throw new Error("Escalation item must be an integer from 1 to 6.");
  if (reason.length === 0) throw new Error("Escalation reason must not be empty.");
  if (reason.length > 500)
    throw new Error("Escalation reason must be at most 500 bytes on one line.");
  if (/[\r\n]/.test(reason)) throw new Error("Escalation reason must be a single line.");
  const category = CATEGORY_BY_ITEM.get(item);
  if (!category) throw new Error("Escalation item must be an integer from 1 to 6.");
  const escalation: RiskReason = {
    code: "agent_escalation",
    detail: `item ${item}: ${category.code} — ${reason}`,
  };
  return {
    ...assessment,
    tier: "high",
    reasons: [...assessment.reasons, escalation],
  };
}
