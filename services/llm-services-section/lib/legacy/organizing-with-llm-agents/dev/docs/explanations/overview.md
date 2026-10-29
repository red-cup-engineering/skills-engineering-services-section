# @emsenn/organizing-with-llm-agents - overview

Language-model inference in the computing domain, operationalized as one package.
Each concern is a module subpath; nothing in the carrier or settling layers touches the network.
This document explains what the package models and how the modules layer together.
It is conceptual; for usage see the best-practices guide.

## The domain

An agent's contact with a language model is a small set of facts:

 - a conversation (an ordered list of role/content messages);
 - an inference request against an endpoint and model, with optional tools;
 - an inference result (text, tool calls, token usage, the raw wire reply);
 - the exact cost of that inference, and whether it fits a budget;
 - the agentic loop that drives request -> tool runs -> next request until it settles on a final answer or is halted by a bound.

This package operationalizes those facts as pure algebra wherever it can, and quarantines the two impure concerns - reading the host (keys, sockets, clock) and parsing provider wire formats - into their own layers.
It lives downstream of `@emsenn/animating` so LLM transport does not become animating ontology.

The charge algebra throughout is `@emsenn/relating/algebra` (a bilattice of `ChargeCarrier` values).
Verdicts are charges, not booleans: a witnessed thing reads as potential, a denied thing as its negation, an unknown thing as bottom (`bottom()`), and a held contradiction as the knowledge-join of a thing and its negation (the "stable"/top value).
Contradictions are kept first-class, never collapsed.

## The modules

### `@emsenn/organizing-with-llm-agents/algebra` - the pure carrier substrate

The set of initial objects every layer above shares, plus exact cost arithmetic.
No IO, no wire parsing, no settling.
Two source files back it:

 - The carrier model (`model.mts`): `JsonValue` and friends; `Role`, `ChatMessage`, `Conversation` with the `message`/`system`/`user`/`assistant` constructors; `EndpointDialect`, `EndpointSpec`, `endpointUrl`, and the built-in `ENDPOINTS` (openai, groq, nvidia, cerebras on the openai dialect; anthropic on the anthropic dialect); `ToolDefinition`, `ToolCall`, `ToolResult`; `InferenceRequest`, `TokenUsage`, `InferenceResult`.
   An `EndpointSpec` carries no codec function - it names a `dialect`, so it stays pure data that can be serialized and compared.
 - Cost and budget (`cost.mts`): `CostAmount` over three resources (settlement fuel, dollars, input/output tokens); `composeCost` as a monoid (serial sums each resource, parallel takes the per-resource maximum); `CostEvent` (a `CostAmount` tagged with provenance and a caller-supplied ISO-8601 `transactionTime` - the algebra reads no clock); `Budget`, `checkBudget`, and the three-way `BudgetCheck` verdict (available -> potential charge, exhausted/abort -> negated charge, downgrade under defer/escalate/degrade -> the knowledge join of the two); `amountForResource`, `consumedForBudget`; and `inferenceCostEvent`, which prices an `InferenceResult` into a `CostEvent` (using reported usage when present, otherwise estimating tokens from prompt bytes and text length via a chars-per-token divisor).

### `@emsenn/organizing-with-llm-agents/running` - the agentic loop as a settling trace

An agent run is a monotone, append-only accumulation of turns.
The `AgentRun` carrier holds a growing `Conversation`, the `Turn` list, the emitted `CostEvent`s, and - once halted - its `LoopStop` and final answer.
`appendTurn` enforces the monotone-growth law (a stage may only add to its predecessor; appending to a stopped run throws); `settleRun` records the stop.

A run reaches one of three regimes (`RunRegime` via `regimeOf`):

 - stabilized - a `final-answer` stop with no further tool calls (a fixed point);
 - contested - a `contested-tool` stop, holding a contradiction;
 - obstructed - a `max-steps` / `cost-bound` / `max-unsettled` bound halted it before settling.
   An obstruction is a bound, never a "settled" claim.

The module projects onto the trace bedrock rather than hand-rolling a fold: `runTrace` yields `TraceEntry`s (one per turn, one per tool run); `runJudgments` yields one `AdmissionJudgment` per tool run plus one for the stop; and `settleRunJudgments` settles the run by the knowledge-join of those judgments via `settleJudgments` - the same settlement the trace topology uses for any admission layer.
`classifyRun` returns the witness-or-obstruction verdict (`RunClassification`).
`runCost` is a serial fold over the emitted cost events - a projection over the log, not a replay.

### `@emsenn/organizing-with-llm-agents/holography` - the inference host as charge readings

The only module that reads the environment or the network.
Sibling of posix-holography (filesystem) and javascript-holography (JS platform): where those project host facilities as charge readings, this projects an inference endpoint - whether its API key is present, and whether a live call settles.

Host facilities enter as injected values via `HolographyOptions` (`fetch`, `env`, `now`), each defaulting to the live host when omitted.
`resolveApiKey` reads the first non-empty env var from the endpoint's `apiKeyEnv`; `endpointProjection` reads an endpoint's capabilities without a call; `witnessInference` performs the live call.
With no key it returns an "absent" fault and makes no call; otherwise it encodes the request with the endpoint's dialect codec, fetches, and decodes the reply.
A reachable, decoded reply reads as a potential charge (`LlmReading`); a transport or HTTP failure is an `LlmFault` (condition `absent` / `unreachable` / `rejected`).

The redaction law is presence, never value: a resolved key (`ApiKeyBearer`) may carry its secret only for the duration of a call; every projection, charge, and returned carrier holds only `{ present, redacted: true }` (`ApiKeyProjection`).
The raw value never enters a persisted shape.

### `@emsenn/organizing-with-llm-agents/codecs/anthropic` and `@emsenn/organizing-with-llm-agents/codecs/openai` - the wire codecs

Pure functions with zero runtime dependencies beyond the carrier they decode into.
Each `encodeRequestBody` turns an `InferenceRequest` into a provider request body; each `decodeResponse` reads a raw reply back into a `DecodedResponse` (`text`, plus `usage`, plus `toolCalls` for openai).
Authentication, the request target, and fetching are the holography layer's business, not the codec's.

The two providers differ in body shape: the Anthropic codec hoists the system prompt to a top-level field and makes `max_tokens` mandatory (defaulting to 4096); the OpenAI codec prepends the system prompt as a `system` message, encodes tools, and decodes tool calls and prompt/completion token usage.
They share verbatim symbol names (`encodeRequestBody`, `decodeResponse`, `decodeText`, `decodeUsage`, `DecodedResponse`), which is why each is its own subpath.

## How the modules depend on each other

The dependency direction is strictly downward toward the pure core:

```
codecs/anthropic ─┐
codecs/openai ────┼──> algebra   (carrier + cost; pure, no IO, no wire)
topology ─────────┘
holography ──> algebra + codecs/anthropic + codecs/openai
```

 - `algebra` depends on nothing in this package (only the charge algebra).
 - `codecs/*` import only carrier types from `algebra`.
 - `running` imports carrier types and `composeCost` from `algebra`, and the trace/judgment machinery from `@emsenn/animating/trace`.
   It does no IO.
 - `holography` is the join point: it imports the carrier from `algebra`, both codec namespaces, and dispatches by `endpoint.dialect`.
   It is the single place keys, sockets, and the clock enter.
 - `dreaming` is the LLM boundary where genuinely new generators can enter from outside the settled fibers - aperiodic dreaming through an LLM enactor (animating owns the inward, deterministic learning dreams).
 - `harness` composes agent + content into a settled relating topology: it equips an agent (animating topology) with the channels it speaks over (content topology), and carries no protocol of its own.

The package root (`@emsenn/organizing-with-llm-agents`) re-exports each module under its own namespace (`algebra`, `running`, `dreaming`, `holography`, `harness`, `codecs`) for discoverability.
The `codecs` namespace nests `anthropic` and `openai`; it is not published as a `./codecs` subpath because the two providers share verbatim symbol names.

## The mental model

Hold four ideas at once:

 1. Carrier vs. boundary. The carrier (`algebra`, `codecs`, `running`) is pure
    and total; the boundary (`holography`) is the only place the host is touched,
    and even there host facilities arrive as injected values.

 2. Verdicts are charges. Budget admission, tool-run outcomes, run stops, and key
    presence are all `ChargeCarrier` readings on the bilattice - potential,
    negated, bottom, or a first-class held contradiction - not pass/fail booleans.

 3. A run is a settling trace. The agentic loop is a monotone accumulation that
    settles on a fixed point, is obstructed by a bound, or holds a contradiction;
    its verdict is the knowledge-join of its judgments, projected onto the trace
    topology.

 4. Cost is a projection over a log. Costs are exact arithmetic over emitted
    cost events with caller-supplied timestamps; the total is a serial fold, not
    a re-execution.
