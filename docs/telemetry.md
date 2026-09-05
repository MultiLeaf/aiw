# Telemetry and Privacy

AI Workflow telemetry is disabled by default. No event is recorded unless a user explicitly runs `aiw telemetry enable` and a host application provides a telemetry client.

## Controls

```bash
aiw telemetry status
aiw telemetry enable --commands=include --outcomes=include
aiw telemetry enable --commands=exclude --outcomes=include
aiw telemetry disable
```

Preferences are stored in `.aiw/telemetry.yml`. Command and outcome collection can be enabled or excluded independently. Disabling telemetry takes effect before the next event can be recorded.

## Data contract

An event contains only:

- schema version;
- the top-level command name, when allowed;
- success or failure, when allowed.

Events never contain command arguments, file paths, project names, file contents, environment variables, prompts, output, error messages, credentials, or stable user/project identifiers. Invalid command names are reported as `unknown` instead of being copied into an event.

The telemetry subsystem does not define a network endpoint or transport. Delivery is provided exclusively through the injectable `TelemetryClient` boundary. Other product features, such as private registries, have separate network boundaries and are not telemetry transports. Missing or failing telemetry collectors cannot change a workflow command's result.
