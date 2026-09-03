export const TARGETS = ["codex", "claude", "cursor", "gemini", "copilot", "universal"] as const;
export type Target = (typeof TARGETS)[number];
export type CommandResult = { exitCode: number; output?: string; error?: string };
export type FileSystem = {
  exists(path: string): boolean;
  read(path: string): string;
  readBytes?(path: string): Uint8Array;
  write(path: string, content: string): void;
  writeBytes?(path: string, content: Uint8Array): void;
  mkdir(path: string): void;
  list?(path: string): string[];
  listFiles?(path: string): string[];
  remove?(path: string): void;
};
