# @red-cup-engineering/computer-inference-system-engineering-services-section

computer-inference-system-engineering-services-section is a services section of the 561 Group.

This section is the system locus for services which make, project, execute, or observe models through composed runtimes, providers, agents, records, and interfaces.
Descending service sections add capability predicates; they do not grant an ancestor authority to perform the terminal Actor's operation.

`inference-dispatch-service` is the customer-side boundary for contracting bounded external inference, assaying its returned candidate, and retaining compact, receipt, consideration, and receiver-disposition evidence.
It is not a free-cloud controller and provider availability is not an authority grant.
Artificial Agent Science studies the reliability and failure questions raised by those observations under `science-services-section/.../artificial-agent-science-services-section`.
Union Officer Academy, under `operations-services-section/services/agent-services-section`, owns character and office formation and explains why an inference call is only an ephemeral animation.
A receiving enterprise alone decides whether an assayed candidate becomes one of its effects.

## Shared execution

`./inference-fabric` owns scheduling, bounded queues, per-provider capacity, rate pacing, fallback, output verification, and multi-endpoint batches.
`./inference-broker` adds durable submission/replay; `./inference-jsonl-session` provides framing; `./inference-activitystreams` carries its existing contract.
One socket service owns the broker and settlement journal.
OpenAI-compatible HTTP execution belongs to `openai-compatible-chat-completion-service`, and JSON validation uses Ajv.

`dispatch-inference-jobs` runs JSONL jobs through that same scheduler.
Each job has an `id`, `messages`, and optional `maxTokens`, `preferEndpoints`, or `outputContract`.
Without `--registry`, endpoints come from the shared provider catalog and only configured, explicitly zero-cash entries are admitted.
Credentials are read from the process environment and never placed in results.

```sh
node --env-file=/path/to/operator.env /path/to/installed/scripts/dispatch-jsonl.mjs \
  --input jobs.jsonl --output results.jsonl \
  --providers ollama-local,openrouter-cohere-north-free \
  --roundtable --concurrency 2 --attempts 1
```

Roundtable mode submits one identified job per selected endpoint and retains separate results.
A refused job makes the CLI exit nonzero.
`--registry` accepts explicit operator endpoint profiles, including process harnesses; `--resume`, `--history`, and `--summary` retain the recovered batch interface.
Resume verifies the original job fingerprint and execution mode; changed jobs or older journals without a fingerprint require a new output journal.
Resumed refusals remain failures.
A returned model response is a candidate requiring the caller's acceptance.

The same package supplies `prepare-code-review-job`, `prepare-throughput-benchmark`, `probe-openai-endpoint`, `serve-inference-socket`, `request-inference-socket`, and the private-worker preparation/admission commands.
These recovered commands share the scheduler, registry loader, broker, and framing modules.
Source preparation and worker admission remain explicit steps.
`request-inference-socket` streams jobs or ActivityStreams contract activities from stdin or `--input` through the same durable socket owner.
There is no separate stdio broker host or contract-specific socket client.

## Earlier work

- Restored files at `lib/legacy/2026-06-16-8347014` (restore commit 8347014); `lib/legacy/2026-06-18-30a3ea3` (restore commit 30a3ea3), from the 561-group/bare-cedar-fog history.
- Added free-compute provider package manifests (`services/free-compute-dev/...`) to `lib/legacy/2026-07-28-free-compute-dev` (restore commit 78303d7), from the 561-group/bare-cedar-fog history.
