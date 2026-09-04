import { describe, expect, it } from "vitest";
import {
  parsePrivateRegistries,
  parseTeamPreset,
  serializePrivateRegistries,
  serializeTeamPreset,
} from "./team-configuration.js";

describe("team configuration", () => {
  it("normalizes shareable presets deterministically", () => {
    const preset = parseTeamPreset(
      "schema: 1\nname: Platform defaults\npackages: [team/testing@^1.0.0, team/lint@2.0.0, team/testing@^1.0.0]\nregistries: [engineering]\n",
    );

    expect(serializeTeamPreset(preset)).toBe(
      "schema: 1\nname: Platform defaults\npackages: [team/lint@2.0.0, team/testing@^1.0.0]\nregistries: [engineering]\n",
    );
  });

  it("stores registry credential references without accepting secrets", () => {
    const registries = parsePrivateRegistries(
      "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test/aiw, token_env: AIW_ENGINEERING_TOKEN }\n",
    );

    expect(serializePrivateRegistries(registries)).toBe(
      "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test/aiw, token_env: AIW_ENGINEERING_TOKEN }\n",
    );
    expect(() =>
      parsePrivateRegistries(
        "schema: 1\nregistries:\n  - { name: engineering, url: https://registry.example.test, token: secret }\n",
      ),
    ).toThrow("token_env");
  });

  it("rejects unsafe or ambiguous team configuration", () => {
    expect(() => parseTeamPreset("schema: 1\nname: \npackages: []\nregistries: []\n")).toThrow(
      "name",
    );
    expect(() =>
      parsePrivateRegistries(
        "schema: 1\nregistries:\n  - { name: engineering, url: http://registry.example.test, token_env: token-name }\n",
      ),
    ).toThrow("HTTPS");
  });
});
