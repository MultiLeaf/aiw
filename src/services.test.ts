import { describe, expect, it } from "vitest";
import type { WorkflowDependencies } from "./services.js";

describe("domain service contracts", () => {
  it("allows independent services to be injected", async () => {
    const dependencies: WorkflowDependencies = {
      scanner: { scan: async () => ({ files: [], evidence: [] }) },
      profiler: {
        profile: async () => ({
          runtime: { languages: [] },
          frameworks: [],
          packageManager: "unknown",
          quality: {},
          ci: [],
          workspaces: [],
          facts: [],
        }),
      },
    };
    await expect(dependencies.scanner?.scan(".")).resolves.toEqual({ files: [], evidence: [] });
    expect(dependencies.profiler).toBeDefined();
  });
});
