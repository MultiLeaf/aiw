# Project Intelligence

AI Workflow uses a hybrid analysis pipeline.

```text
Deterministic detectors → Detected project profile → Relevant context selection
→ AI interpreter → Insights and recommendations → User confirmation
→ Confirmed project profile
```

## Deterministic layer

Detectors establish observable facts: files, dependencies, versions, package managers, scripts, frameworks, quality tools, tests, CI, workspaces, ignored paths, and configuration files. Each fact includes its source and detection method.

```yaml
fact: tool.eslint
value: true
source: eslint.config.js
method: deterministic
confidence: 1.0
```

## AI interpretation layer

The interpreter handles architecture conventions, naming patterns, testing style, implicit policies, documentation consistency, contradictions, and capability recommendations. It receives filtered context rather than the entire repository.

The runtime exposes a provider-neutral `AiProvider` interface. Provider adapters receive an English system instruction, a scoped prompt, a token ceiling, and a JSON response requirement. The interpreter validates and normalizes that response into evidence facts; provider output cannot choose evidence state or cite a file outside the supplied context.

```yaml
fact: architecture.style
value: feature-based
sources: [src/features]
confidence: 0.78
method: ai-inference
requires_confirmation: true
```

## Evidence states

- `detected`: observed by a deterministic detector.
- `inferred`: proposed by the AI interpreter.
- `confirmed`: accepted or edited by the user.

Only detected and confirmed data may drive automatic generation. Inferred data requires confirmation when it changes generated behavior.

## Context controls

The interpreter excludes secrets, binaries, generated output, dependencies, Git internals, and checkpoints by default. It receives only files relevant to the active analysis task.

Before a provider call, the interpreter:

- normalizes and filters relative paths;
- reads only eligible text files inside the project root;
- redacts common credential assignments, bearer tokens, and private keys;
- rejects inferred evidence that cites any file outside the scoped request.

The workflow accepts an injected interpreter service. A configured interpreter runs during `aiw scan`, and its structured facts are stored in `.aiw/profile.yml` alongside deterministic facts. Facts below the confidence threshold are marked `requires_confirmation: true`. Without a configured provider, scans remain deterministic and do not make a network request.
