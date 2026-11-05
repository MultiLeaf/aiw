import type { ProposalPolicy } from "./types.js";

/**
 * Default anti-spam policy. `threshold` is the minimum number of observed
 * occurrences before a pattern may surface; `cooldown` is the minimum number
 * of sequence numbers (store events) between two surfacings. Both are
 * deterministic counters, never wall-clock durations.
 */
export function defaultPolicy(): ProposalPolicy {
  return { threshold: 3, cooldown: 5, suppressed: [] };
}
