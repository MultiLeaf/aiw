import { describe, expect, it } from "vitest";
import {
  getAdapterCapabilities,
  ADAPTER_CAPABILITIES,
  LIFECYCLE_EVENTS,
} from "./adapter-contract.js";
import { TARGETS } from "./types.js";

describe("adapter capability contract", () => {
  it("declares capabilities for every supported target", () => {
    for (const target of TARGETS) {
      const adapter = ADAPTER_CAPABILITIES[target];
      expect(adapter.target).toBe(target);
      expect(adapter.resources.length).toBeGreaterThan(0);
      expect(adapter.events).toEqual([...LIFECYCLE_EVENTS]);
    }
  });

  it("rejects unsupported targets and exposes fallback behavior", () => {
    expect(getAdapterCapabilities("universal").fallback).toBe(true);
    expect(() => getAdapterCapabilities("unknown")).toThrow("Unsupported adapter target");
  });
});
