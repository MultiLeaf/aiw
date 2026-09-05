import { describe, expect, it, vi } from "vitest";
import { buildDashboardModel, renderDashboard, startDashboard } from "./dashboard.js";
import { memoryFileSystem } from "./fixtures/plugin-files.js";

const fixture = (): ReturnType<typeof memoryFileSystem> =>
  memoryFileSystem({
    "/project/.aiw/manifest.yml": "schema: 1\nproject:\n  name: atlas\ntarget:\n  active: codex\n",
    "/project/.aiw/profile.yml":
      "schema: 1\nfacts:\n  - key: runtime.language\n    value: typescript\n    state: detected\n    confidence: 1\n",
    "/project/.aiw/recommendations.yml":
      "schema: 1\nrecommendations:\n  - id: tdd-development\n    provider: multileaf\n    selected: true\n",
    "/project/.aiw/generated/artifacts/traceability.yml":
      'schema: 1\nlinks:\n  - requirement: REQ-001\n    decisions: [ADR-001]\n    tasks: [TASK-001]\n    evidence: ["report, npm test"]\n',
  });

describe("dashboard", () => {
  it("builds a deterministic project view model and escapes rendered project data", () => {
    const fs = fixture();
    const model = buildDashboardModel("/project", fs);
    expect(model).toEqual({
      project: "atlas",
      target: "codex",
      facts: [{ key: "runtime.language", value: "typescript", state: "detected", confidence: "1" }],
      recommendations: [{ id: "tdd-development", provider: "multileaf", selected: true }],
      traceability: [
        {
          requirement: "REQ-001",
          decisions: ["ADR-001"],
          tasks: ["TASK-001"],
          evidence: ["report, npm test"],
        },
      ],
    });
    const html = renderDashboard({ ...model, project: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Requirement → decision → task → evidence");
    expect(html).toContain("Local-only dashboard");
  });

  it("serves local HTML and JSON without invoking commands", async () => {
    const execute = vi.fn();
    const dashboard = await startDashboard("/project", fixture(), execute);
    try {
      const page = await fetch(dashboard.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(await page.text()).toContain("atlas");
      const data = await fetch(`${dashboard.url}/api/dashboard`);
      expect(await data.json()).toMatchObject({ project: "atlas", target: "codex" });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await dashboard.close();
    }
  });

  it("requires explicit confirmation and delegates migration to the workflow", async () => {
    const execute = vi.fn(async () => ({ exitCode: 0, output: "Migrated to claude." }));
    const dashboard = await startDashboard("/project", fixture(), execute);
    try {
      const crossOrigin = await fetch(`${dashboard.url}/migrate`, {
        method: "POST",
        headers: { Origin: "https://example.com" },
        body: new URLSearchParams({ target: "claude", confirmation: "MIGRATE" }),
        redirect: "manual",
      });
      expect(crossOrigin.status).toBe(400);
      expect(await crossOrigin.text()).toContain("must originate from this dashboard");
      const rejected = await fetch(`${dashboard.url}/migrate`, {
        method: "POST",
        headers: { Origin: dashboard.url },
        body: new URLSearchParams({ target: "claude", confirmation: "yes" }),
        redirect: "manual",
      });
      expect(rejected.status).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const accepted = await fetch(`${dashboard.url}/migrate`, {
        method: "POST",
        headers: { Origin: dashboard.url },
        body: new URLSearchParams({ target: "claude", confirmation: "MIGRATE" }),
        redirect: "manual",
      });
      expect(accepted.status).toBe(303);
      expect(execute).toHaveBeenCalledWith(["target", "claude"]);
    } finally {
      await dashboard.close();
    }
  });

  it("requires an installed workflow", async () => {
    await expect(startDashboard("/project", memoryFileSystem(), vi.fn())).rejects.toThrow(
      "aiw install",
    );
  });
});
