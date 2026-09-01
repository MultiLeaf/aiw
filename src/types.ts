export const TARGETS = ["codex", "claude", "cursor", "gemini", "copilot", "universal"] as const;
export type Target = (typeof TARGETS)[number];
export type CommandResult = { exitCode: number; output?: string; error?: string };
export type FileSystem = {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
  mkdir(path: string): void;
  remove?(path: string): void;
};
