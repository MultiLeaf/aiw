import type { WorkflowDependencies } from "../services.js";
import type { CommandResult, FileSystem } from "../types.js";

export type WorkflowServices = WorkflowDependencies;

export interface CommandContext {
  args: string[];
  root: string;
  aiw: string;
  fs: FileSystem;
  services: WorkflowServices;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult> | CommandResult;

export type ProjectFileChange = { path: string; content: Uint8Array | undefined };

export type LightEvidence = {
  schema: 1;
  workflowId: string;
  ticket?: string;
  lane: "light";
  laneReason?: string;
  entries: { note: string; recordedAt: string }[];
};

export interface ObserveDecisionEntry {
  stage: string;
  decision: "pass" | "fail";
  issues: string[];
  recordedAt: string;
}
