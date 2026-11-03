export const TARGETS = ["codex", "claude", "cursor", "gemini", "copilot", "universal"] as const;
export type Target = (typeof TARGETS)[number];
export const HUMAN_APPROVAL_STAGES = [
  "brainstorming",
  "specification",
  "technical-design",
  "plan",
  "implementation",
  "verification",
  "review",
  "traceability",
  "diagnosis",
  "assessment",
] as const;
export type HumanApprovalStage = (typeof HUMAN_APPROVAL_STAGES)[number];

/** OPP-009: processes are independent entry points assembled from shared stage primitives. */
export const PROCESSES = {
  feature: {
    stages: [
      "brainstorming",
      "specification",
      "technical-design",
      "plan",
      "implementation",
      "verification",
      "review",
      "traceability",
    ],
  },
  bugfix: {
    stages: ["diagnosis", "implementation", "verification", "review"],
  },
  "idea-assessment": {
    stages: ["assessment"],
  },
} as const;
export type WorkflowProcess = keyof typeof PROCESSES;
export const PROCESS_IDS = Object.keys(PROCESSES) as WorkflowProcess[];
export type CommandResult = { exitCode: number; output?: string; error?: string };
export type PathType = "missing" | "file" | "directory" | "symlink" | "other";
export type FileSystem = {
  exists(path: string): boolean;
  read(path: string): string;
  readBytes?(path: string): Uint8Array;
  write(path: string, content: string): void;
  mkdirExclusive?(path: string): boolean;
  createExclusive?(path: string, content: string): boolean;
  writeBytes?(path: string, content: Uint8Array): void;
  mkdir(path: string): void;
  list?(path: string): string[];
  listFiles?(path: string): string[];
  remove?(path: string): void;
  removeDirectory?(path: string): void;
  pathType?(path: string): PathType;
  realpath?(path: string): string;
};
