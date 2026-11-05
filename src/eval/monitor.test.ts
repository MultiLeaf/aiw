import { describe, expect, it } from "vitest";
import { createEmptyStore } from "./proposals.js";
import { defaultPolicy } from "./policy.js";
import { extractObservations, monitorSession, type SessionArtifact } from "./monitor.js";

const gateFailure = (stage: string): SessionArtifact => ({
  type: "gate-failure",
  stage,
  ref: `checkpoints/${stage}-001.yml`,
});
const rejection = (stage: string, reason: string): SessionArtifact => ({
  type: "rejection",
  stage,
  reason,
  ref: `checkpoints/${stage}-002.yml`,
});

describe("continuous monitor", () => {
  it("extracts deterministic observations from AIW artifacts", () => {
    const observations = extractObservations([
      gateFailure("specification"),
      rejection("implementation", "tests missing"),
    ]);
    expect(observations).toEqual([
      {
        kind: "rule",
        signature: "gate-specification-quality",
        origin: "monitor",
        evidence: "checkpoints/specification-001.yml",
      },
      {
        kind: "rule",
        signature: "rejection-implementation",
        origin: "monitor",
        evidence: "checkpoints/implementation-002.yml",
      },
    ]);
  });

  it("one proposal for a pattern repeated across sessions, citing each occurrence (REQ-003)", () => {
    const store = createEmptyStore();
    const sessions: SessionArtifact[][] = [
      [gateFailure("specification")],
      [gateFailure("specification")],
      [gateFailure("specification")],
    ];
    for (const artifacts of sessions) monitorSession(store, artifacts);
    expect(store.proposals).toHaveLength(1);
    const proposal = store.proposals[0];
    expect(proposal?.occurrences).toBe(3);
    expect(proposal?.evidence).toHaveLength(3);
    expect(proposal?.evidence.every((ref) => ref.startsWith("checkpoints/"))).toBe(true);
  });

  it("does not surface single-occurrence patterns (REQ-003 acceptance)", () => {
    const store = createEmptyStore();
    const result = monitorSession(store, [gateFailure("plan")]);
    expect(result.surfaced).toEqual([]);
    expect(store.proposals[0]?.occurrences).toBe(1);
  });

  it("surfaces a proposal once the threshold is crossed", () => {
    const store = createEmptyStore();
    let surfaced: string[] = [];
    for (let i = 0; i < defaultPolicy().threshold; i++)
      surfaced = monitorSession(store, [rejection("implementation", "tests missing")]).surfaced;
    expect(surfaced).toEqual(["rejection-implementation"]);
  });

  it("is local: mutates only the passed store, touches no filesystem (REQ-007)", () => {
    const store = createEmptyStore();
    const before = JSON.stringify(store);
    expect(() => monitorSession(store, [gateFailure("review")])).not.toThrow();
    expect(JSON.stringify(store)).not.toBe(before);
  });
});
