import { afterEach, describe, expect, it, vi } from "vitest";
import { debugLog, isDebugEnabled } from "./debug.js";

describe("debug diagnostics", () => {
  const originalDebug = process.env.AIW_DEBUG;

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.AIW_DEBUG;
    } else {
      process.env.AIW_DEBUG = originalDebug;
    }
    vi.restoreAllMocks();
  });

  it("is disabled by default and for falsy values", () => {
    delete process.env.AIW_DEBUG;
    expect(isDebugEnabled("onboarding")).toBe(false);

    process.env.AIW_DEBUG = "0";
    expect(isDebugEnabled("onboarding")).toBe(false);

    process.env.AIW_DEBUG = "false";
    expect(isDebugEnabled("onboarding")).toBe(false);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("onboarding", "probe failed", new Error("ECONNREFUSED"));
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("enables all scopes for 1, true, and *", () => {
    for (const value of ["1", "true", "TRUE", "*"]) {
      process.env.AIW_DEBUG = value;
      expect(isDebugEnabled("onboarding")).toBe(true);
      expect(isDebugEnabled("orchestration")).toBe(true);
    }
  });

  it("filters by comma-separated scope names", () => {
    process.env.AIW_DEBUG = "orchestration, setup";
    expect(isDebugEnabled("orchestration")).toBe(true);
    expect(isDebugEnabled("setup")).toBe(true);
    expect(isDebugEnabled("onboarding")).toBe(false);
  });

  it("writes formatted messages to stderr only", () => {
    process.env.AIW_DEBUG = "workflow";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    debugLog("workflow", "read trace failed", new Error("ENOENT"));
    debugLog("workflow", "fallback triggered", "bad yaml");
    debugLog("workflow", "plain note");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenNthCalledWith(
      1,
      "[aiw:debug:workflow] read trace failed: ENOENT\n",
    );
    expect(stderrSpy).toHaveBeenNthCalledWith(
      2,
      "[aiw:debug:workflow] fallback triggered: bad yaml\n",
    );
    expect(stderrSpy).toHaveBeenNthCalledWith(3, "[aiw:debug:workflow] plain note\n");
  });
});
