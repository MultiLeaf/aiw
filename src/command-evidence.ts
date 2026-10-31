/**
 * Emission ≠ usability enforcement (OPP-006, REQ-OPP-006).
 *
 * A test that verifies a message was emitted does not verify it is usable.
 * Any user-facing artifact (docs, generated skills, blocking output) that
 * names an `aiw` command must be covered by a test that proves the command
 * is real — the source lesson: a shipped message named a command nobody had
 * ever run, for months, with green coverage.
 *
 * This helper extracts `aiw ...` and `npx @multileaf/ai-workflow ...`
 * invocations from artifact text so tests can execute them.
 */

export type CommandMention = {
  /** Normalized invocation: command and subcommand words only, no flags. */
  command: string;
  /** Source label for diagnostics. */
  source: string;
};

const INVOCATION_PATTERN =
  /(^|`|\n)(?:aiw|npx @multileaf\/ai-workflow) ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g;

/** English words that must never be captured as a subcommand. */
const STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "a",
  "to",
  "then",
  "is",
  "in",
  "with",
  "before",
  "after",
  "you",
  "see",
  "for",
  "that",
  "helps",
  "tool",
]);

/** Extract normalized command mentions (command + optional subcommand, no flags). */
export function extractAiwCommands(text: string, source = "text"): CommandMention[] {
  const mentions: CommandMention[] = [];
  for (const match of text.matchAll(INVOCATION_PATTERN)) {
    const subcommand = match[3] && !STOP_WORDS.has(match[3]) ? match[3] : undefined;
    const command = subcommand ? `${match[2]} ${subcommand}` : match[2];
    if (!mentions.some((mention) => mention.command === command && mention.source === source)) {
      mentions.push({ command, source });
    }
  }
  return mentions;
}

/**
 * Informational mentions excluded from execution evidence. Every entry needs
 * a justification; entries are exact normalized commands.
 */
export const INFORMATIONAL_ALLOWLIST: readonly { command: string; justification: string }[] = [
  {
    command: "aiw install",
    justification: "Executed by the install e2e suite; README form includes --target variants.",
  },
] as const;

/** First token (the command word) used for recognition checks. */
export function commandWord(mention: CommandMention): string {
  return mention.command.split(" ")[0];
}

/** Signature of the general usage dump printed for unknown commands. */
export const UNKNOWN_COMMAND_SIGNATURE = "aiw install [--target target] | workflow";
