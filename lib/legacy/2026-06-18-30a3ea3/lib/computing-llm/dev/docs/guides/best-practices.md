# @emsenn/computing-llm - best practices

How to consume `@emsenn/computing-llm` well.
Concept-level background is in the overview explanation; this guide is task-oriented.

## Import the named subpaths, not deep paths

The package publishes exactly these import specifiers (from `package.json` `exports`):

 - `@emsenn/computing-llm` - the root; re-exports every module under its own namespace (`algebra`, `topology`, `holography`, `codecs`).
 - `@emsenn/computing-llm/algebra` - the carrier model and cost arithmetic.
 - `@emsenn/computing-llm/topology` - the agentic-loop run carrier and its trace projection.
 - `@emsenn/computing-llm/holography` - the inference host (keys, fetch, clock).
 - `@emsenn/computing-llm/codecs/anthropic` - the Anthropic Messages wire codec.
 - `@emsenn/computing-llm/codecs/openai` - the OpenAI chat-completions wire codec.

Import the subpaths directly for the flat symbol surface of each module:

```ts
import { user, system, ENDPOINTS, type InferenceRequest } from "@emsenn/computing-llm/algebra";
import { emptyRun, appendTurn, classifyRun } from "@emsenn/computing-llm/topology";
import { witnessInference } from "@emsenn/computing-llm/holography";
import * as anthropic from "@emsenn/computing-llm/codecs/anthropic";
```

The root namespaces are for discoverability:

```ts
import { algebra, topology } from "@emsenn/computing-llm";
const msg = algebra.user("hi");
```

Never import `@emsenn/computing-llm/dist/...
` or any internal file path.
Only the specifiers above are part of the package's contract; anything under `dist/` is a build artifact whose layout can change without a version bump.

### There is no `./codecs` subpath

The `codecs` namespace is exposed only through the root (`import { codecs } from "@emsenn/computing-llm"` -> `codecs.anthropic`, `codecs.openai`).
There is deliberately no `@emsenn/computing-llm/codecs` subpath: the two providers share verbatim symbol names (`encodeRequestBody`, `decodeResponse`, `decodeText`, `decodeUsage`, `DecodedResponse`), so import the nested subpaths and namespace them yourself:

```ts
import * as anthropic from "@emsenn/computing-llm/codecs/anthropic";
import * as openai from "@emsenn/computing-llm/codecs/openai";
```

## Which subpath per task

 - Build messages, requests, or reference an endpoint -> `algebra` (`message`/`system`/`user`/`assistant`, `ENDPOINTS`, `endpointUrl`, `InferenceRequest`).
 - Price an inference or admit it against a budget -> `algebra` (`inferenceCostEvent`, `composeCost`, `checkBudget`, `consumedForBudget`).
 - Drive or classify an agent run -> `topology` (`emptyRun`, `appendTurn`, `settleRun`, `classifyRun`, `runCost`, `runTrace`).
 - Resolve a key, project an endpoint, or make a live call -> `holography` (`resolveApiKey`, `endpointProjection`, `witnessInference`).
 - Encode/decode a provider body without doing IO -> `codecs/anthropic` or `codecs/openai`.

## I/O enters as values, never as ambient access

Only `holography` touches the host, and even there the host arrives through `HolographyOptions` - `fetch`, `env`, and `now`.
Each defaults to the live host when omitted, so pass them explicitly when you need determinism or isolation:

```ts
import { witnessInference } from "@emsenn/computing-llm/holography";
import { ENDPOINTS, type InferenceRequest } from "@emsenn/computing-llm/algebra";

const outcome = await witnessInference(ENDPOINTS.anthropic, request, {
  fetch: myFetch,            // injected; no socket the function was not handed
  env: { ANTHROPIC_API_KEY: key },
  now: "2026-06-15T00:00:00.000Z",
});
```

The cost algebra carries the same discipline: `inferenceCostEvent` and `CostEvent` require a caller-supplied ISO-8601 `transactionTime` precisely so the algebra never reads a wall clock.
Supply the timestamp; do not expect the library to fetch one.

Corollary: keep `algebra`, `codecs`, and `topology` out of any IO path.
If you find yourself wanting a clock or a socket in those layers, the call belongs in `holography` (or in your own boundary code that injects the value).

## Redaction: never persist a resolved key

`resolveApiKey` returns an `ApiKeyBearer` that holds the raw secret only for the duration of a call.
Everything you would store or log - `ApiKeyProjection`, `EndpointProjection`, `LlmReading`, `LlmFault` - carries only `{ present, redacted: true }`.
Do not reach for `ApiKeyBearer.value` to stash it; project it (`projectApiKey`) before it leaves the call boundary.

## sideEffects: false

The package sets `"sideEffects": false`, declaring that importing a module runs no top-level side effects.
A bundler may tree-shake away any export you do not use.
Two consequences:

 - Import only the symbols you need; unused ones are dropped.
 - Do not rely on import-for-effect - importing `@emsenn/computing-llm/holography` does not register or initialize anything globally; the modules are pure value producers.

## Semver and stability

Every published subpath is part of the contract.
This package ships no `*/internal` subpath - there is nothing under a no-promise namespace to import.
That also means the boundary is the only stable surface: deep `dist/` paths are not exported and carry no compatibility promise, so importing them couples you to build layout that can change at any time.

## Tests are theorem-shaped

Each test name is a falsifiable claim about the code, and the body is its proof.
For example, in `algebra/cost.test.mts`:

 - "composeCost serial sums every resource"
 - "composeCost parallel takes the max per resource"
 - "composeCost of nothing is the zero cost"
 - "the three budget verdicts carry three distinct charges"
 - "inferenceCostEvent estimates tokens from bytes when usage is absent"

and in `topology/index.test.mts`:

 - "regimeOf maps each stop to its settling regime"
 - "appendTurn accumulates conversation and cost events monotonically"

When you extend this package, write the test name as the theorem you intend to hold, then make the body prove it.
To learn what a function guarantees, read its test names first - they are the spec.

## Common pitfalls

 - Asking for an OpenAI feature from the Anthropic codec.
   Only the OpenAI codec decodes tool calls (`decodeToolCalls`) and prepends the system prompt as a message; the Anthropic codec hoists `system` to a top-level field, makes `max_tokens` mandatory (default 4096), and its `decodeResponse` returns no `toolCalls`.
   Pick the codec for the endpoint's `dialect`, or let `witnessInference` dispatch by `endpoint.dialect` for you.

 - Appending to a stopped run.
   `appendTurn` and `settleRun` throw if the run has already stopped, and `appendTurn` throws if a turn adds no messages.
   Respect the monotone-growth law: a stage may only add to its predecessor.

 - Treating an obstruction as a settled answer.
   A `max-steps` / `cost-bound` / `max-unsettled` stop is obstructed, not stabilized.
   Read the regime via `classifyRun`/`regimeOf`; only a stabilized run carries a real `finalAnswer`.

 - Collapsing a contested verdict.
   Budget downgrades, contested tool runs, and contested stops are first-class held contradictions (knowledge-joins on the bilattice).
   Do not flatten them to true/false; compare charges with `sameCharge` and branch on the regime/status instead.

 - Expecting `composeCost` to coerce.
   It validates every resource as nonnegative (and tokens as integers) and throws otherwise; the per-resource semantics differ by mode (serial sums, parallel maxes), so pass the mode you mean.

 - Forgetting the timestamp.
   `inferenceCostEvent` requires `transactionTime`; there is no default, by design.

 - Calling without a key.
   `witnessInference` with no resolvable key returns an "absent" `LlmFault` and makes no network call - it does not throw.
   Branch on `outcome.ok` rather than catching.
