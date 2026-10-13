# Telemetry and Privacy

AI Workflow telemetry is disabled by default. No event is recorded unless a user explicitly runs `aiw telemetry enable` and a host application provides a telemetry client.

## Installation consent

During an interactive `aiw install`, after the optional model questions, the installer asks whether to enable anonymous telemetry with an explicit default of **No**. The question states the exact event payload: the command name and its outcome only — never arguments, file paths, or file contents. The answer is recorded in `.aiw/settings.yml` under the `telemetry` section (declining is recorded too, so the question is never repeated), and the decision is reversible at any time with `aiw telemetry enable` / `aiw telemetry disable`. Non-interactive installs skip the prompt entirely and leave the section absent, and the prompt itself never emits a telemetry event.

## Controls

```bash
aiw telemetry show            # buffered events summarized by command and outcome
aiw telemetry show --verbose  # ...plus each event verbatim
aiw telemetry status          # configuration only
aiw telemetry enable --commands=include --outcomes=include
aiw telemetry enable --commands=exclude --outcomes=include
aiw telemetry disable
```

Preferences are stored in the local user settings file `.aiw/settings.yml` under the `telemetry` section (the legacy `.aiw/telemetry.yml` file is still read when `settings.yml` does not exist). Command and outcome collection can be enabled or excluded independently. Disabling telemetry takes effect before the next event can be recorded.

Rejected telemetry administration commands never produce telemetry events, even when a previous valid configuration enabled collection. This keeps malformed consent or privacy changes outside the telemetry stream.

## Local buffer

When telemetry is enabled but no host application provides a telemetry client, events accumulate in a rotated local buffer at `.aiw/telemetry-buffer.jsonl` (one JSON event per line, retention cap of 200 events — the oldest events are dropped first). This introduces no network transport: the buffer is written only to the local `.aiw/` directory.

- `aiw telemetry status --verbose` displays the number of buffered events, the retention cap, and each buffered event verbatim.
- `aiw telemetry disable` purges the buffer.
- When a host client is present, events go to the client and the local buffer stays untouched.

## Data contract

An event contains only:

- schema version;
- the top-level command name, when allowed;
- success or failure, when allowed.

Events never contain command arguments, file paths, project names, file contents, environment variables, prompts, output, error messages, credentials, or stable user/project identifiers. Invalid command names are reported as `unknown` instead of being copied into an event.

The telemetry subsystem does not define a network endpoint or transport. Delivery is provided exclusively through the injectable `TelemetryClient` boundary. Other product features, such as private registries, have separate network boundaries and are not telemetry transports. Missing or failing telemetry collectors cannot change a workflow command's result.
