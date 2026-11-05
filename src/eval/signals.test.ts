import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectSignals,
  parseEvidenceBundle,
  serializeEvidenceBundle,
  type GitSummary,
} from "./signals.js";

const fixture = (name: string): string[] => {
  const root = join(__dirname, "..", "fixtures", "eval-signals", name);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  walk(root);
  return files.sort();
};

const git: GitSummary = {
  available: true,
  topPaths: ["src/main/java/com/example/Service.java"],
  commitTypeRatio: { fix: 0.5, feat: 0.3, chore: 0.2 },
  hotspots: ["src/main/java/com/example"],
};

describe("signal collector", () => {
  it("detects Gradle build and test commands for a Java project (REQ-002)", () => {
    const bundle = collectSignals(fixture("java-gradle"), git);
    const fact = (key: string): string | undefined =>
      bundle.facts.find((entry) => entry.key === key)?.value;
    expect(fact("build.system")).toBe("gradle");
    expect(fact("test.command")).toBe("./gradlew test");
    expect(bundle.facts.find((entry) => entry.key === "build.system")?.evidence).toContain(
      "build.gradle.kts",
    );
    expect(fact("git.top-path")).toBe("src/main/java/com/example/Service.java");
    expect(fact("git.commit-ratio.fix")).toBe("0.5");
  });

  it("detects pytest tooling for a Python project (REQ-002)", () => {
    const root = join(__dirname, "..", "fixtures", "eval-signals", "python-pytest");
    const bundle = collectSignals(fixture("python-pytest"), undefined, (path) =>
      readFileSync(join(root, path), "utf8"),
    );
    const fact = (key: string): string | undefined =>
      bundle.facts.find((entry) => entry.key === key)?.value;
    expect(fact("build.system")).toBe("python-pyproject");
    expect(fact("test.command")).toBe("pytest");
    expect(fact("framework")).toBe("fastapi");
  });

  it("detects CMake and ctest for a C++ project (REQ-002)", () => {
    const bundle = collectSignals(fixture("cpp-cmake"));
    const fact = (key: string): string | undefined =>
      bundle.facts.find((entry) => entry.key === key)?.value;
    expect(fact("build.system")).toBe("cmake");
    expect(fact("test.command")).toBe("ctest --output-on-failure");
    expect(fact("language")).toBe("cpp");
  });

  it("degrades to tree signals without git and records the limitation (REQ-001)", () => {
    const bundle = collectSignals(fixture("java-gradle"));
    expect(bundle.facts.some((entry) => entry.key.startsWith("git."))).toBe(false);
    expect(bundle.limitations).toContain("git-history-unavailable");
  });

  it("serializes deterministically and round-trips byte-identically", () => {
    const bundle = collectSignals(fixture("python-pytest"), git);
    const first = serializeEvidenceBundle(bundle);
    expect(serializeEvidenceBundle(parseEvidenceBundle(first))).toBe(first);
  });

  it("rejects unknown bundle schemas", () => {
    expect(() => parseEvidenceBundle("schema: 7\n")).toThrow(/schema/i);
  });
});

// ---- AIW-666 follow-ups: content-aware frameworks, robust evidence ----

import { readFileSync } from "node:fs";

describe("content-aware framework detection (A1 fix)", () => {
  const reader =
    (root: string) =>
    (path: string): string => {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return "";
      }
    };

  it("detects fastapi only when the dependency is declared (REQ-002 honesty)", () => {
    const withReader = collectSignals(
      fixture("python-pytest"),
      undefined,
      reader(join(__dirname, "..", "fixtures", "eval-signals", "python-pytest")),
    );
    expect(withReader.facts.find((entry) => entry.key === "framework")?.value).toBe("fastapi");
    const plain = collectSignals(["pyproject.toml"], undefined, () => "[project]\nname = 'x'\n");
    expect(plain.facts.some((entry) => entry.key === "framework")).toBe(false);
  });

  it("detects spring only when declared in the build file", () => {
    const withReader = collectSignals(
      fixture("java-gradle"),
      undefined,
      reader(join(__dirname, "..", "fixtures", "eval-signals", "java-gradle")),
    );
    expect(withReader.facts.find((entry) => entry.key === "framework")?.value).toBe("spring");
    const plain = collectSignals(
      ["build.gradle.kts", "src/main/java/App.java"],
      undefined,
      () => "plugins { java }\n",
    );
    expect(plain.facts.some((entry) => entry.key === "framework")).toBe(false);
  });

  it("detects django and flask from dependency content", () => {
    const django = collectSignals(
      ["pyproject.toml"],
      undefined,
      () => 'dependencies = ["django"]\n',
    );
    expect(django.facts.find((entry) => entry.key === "framework")?.value).toBe("django");
    const flask = collectSignals(["pyproject.toml"], undefined, () => "flask\n");
    expect(flask.facts.find((entry) => entry.key === "framework")?.value).toBe("flask");
  });

  it("keeps build facts when a rule is matched by a secondary file (A3 robustness)", () => {
    // gradlew present, no build.gradle(.kts): rule still fires with gradlew evidence
    const bundle = collectSignals(["gradlew", "src/main/java/App.java"]);
    const build = bundle.facts.find((entry) => entry.key === "build.system");
    expect(build?.value).toBe("gradle");
    expect(build?.evidence).toContain("gradlew");
  });
});
