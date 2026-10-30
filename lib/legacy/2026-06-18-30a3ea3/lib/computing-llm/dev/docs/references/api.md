# @emsenn/computing-llm — API reference

> Generated from source by `jsnode-doc-computer reference`.
> Each entry is the exported symbol's verbatim signature and its leading JSDoc; regenerate after changing the public surface.

## Modules

- `@emsenn/computing-llm/algebra`
- `@emsenn/computing-llm/codecs/anthropic`
- `@emsenn/computing-llm/codecs/openai`
- `@emsenn/computing-llm/holography`
- `@emsenn/computing-llm/topology`

## `@emsenn/computing-llm/algebra`

### `amountForResource` — function

```ts
export function amountForResource(cost: CostAmount, resourceKind: BudgetResourceKind): number
```

Projects a CostAmount onto a single resource kind: dollars, input plus output tokens, or settlement fuel.

### `assistant` — const

```ts
export const assistant = (content: string): ChatMessage => …
```

Constructs a chat message with the "assistant" role from a content string.

### `Budget` — type-alias

```ts
export type Budget = Readonly<{ id: string; resourceKind: BudgetResourceKind; boundValue: number; scope: string; exhaustionPolicy: BudgetExhaustionPolicy; resetPolicy?: string; evidence: readonly string[]; }>
```

A spending bound on one resource: its id, the resource kind it limits, the bound value, a scope label, the policy to apply on exhaustion, an optional reset policy, and supporting evidence.

### `BudgetCheck` — type-alias

```ts
export type BudgetCheck = Readonly<{ budget: Budget; status: BudgetStatus; policy?: BudgetExhaustionPolicy; currentConsumption: number; proposedAmount: number; projectedConsumption: number; remaining?: number; charge: ChargeCarrier; }>
```

The verdict of checking a proposed charge against a budget: the budget, the resulting status and policy, current and proposed and projected consumption, optional remaining headroom, and a ChargeCarrier encoding the admission verdict in the charge bilattice.

### `BudgetExhaustionPolicy` — type-alias

```ts
export type BudgetExhaustionPolicy = "abort" | "defer" | "escalate" | "degrade"
```

What to do when a budget would be exceeded: "abort", "defer", "escalate", or "degrade".

### `BudgetResourceKind` — type-alias

```ts
export type BudgetResourceKind = "dollars" | "tokens" | "settlement-fuel"
```

Which resource a budget bounds: "dollars", "tokens" (input plus output), or "settlement-fuel".

### `BudgetStatus` — type-alias

```ts
export type BudgetStatus = "available" | "exhausted" | "downgrade"
```

The outcome of a budget check: "available" (within bound), "exhausted" (over bound, aborting), or "downgrade" (over bound under a defer/escalate/degrade policy).

### `ChatMessage` — type-alias

```ts
export type ChatMessage = Readonly<{ role: Role; content: string; /** assistant tool-call name or tool-result name, when the role carries one */ name?: string; /** links a tool result back to the assistant tool call that requested it */ toolCallId?: string; }>
```

One turn in a conversation: a role and its text content, optionally carrying a tool name and a tool-call id when the turn is a tool call or tool result.

### `checkBudget` — function

```ts
export function checkBudget(budget: Budget, currentConsumption: number, proposedAmount: number): BudgetCheck
```

Tests a proposed charge against a budget given current consumption, returning a BudgetCheck: "available" with a witnessed potential charge when projected consumption stays within the bound, "exhausted" with a negated charge under an abort policy, or "downgrade" with the knowledge join of a witnessed and a negated charge under defer/escalate/degrade policies.

### `composeCost` — function

```ts
export function composeCost(events: readonly CostAmount[], mode: CostCompositionMode = "serial"): CostAmount
```

Combines cost amounts under a composition mode, summing each resource in "serial" mode and taking the per-resource maximum in "parallel" mode; returns the zero cost for an empty list and validates each value as nonnegative.

### `consumedForBudget` — function

```ts
export function consumedForBudget(events: readonly CostAmount[], budget: Budget, mode: CostCompositionMode = "serial"): number
```

Composes the given cost events under a mode and returns the amount consumed in the budget's resource kind.

### `Conversation` — type-alias

```ts
export type Conversation = readonly ChatMessage[]
```

An ordered, readonly sequence of chat messages.

### `CostAmount` — type-alias

```ts
export type CostAmount = Readonly<{ settlementFuel: number; dollars: number; tokens: CostTokens; }>
```

The cost of an operation across three resources: settlement fuel, dollars, and input/output tokens.

### `CostCompositionMode` — type-alias

```ts
export type CostCompositionMode = "serial" | "parallel"
```

How two costs combine: "serial" sums each resource, "parallel" takes the per-resource maximum.

### `CostEvent` — type-alias

```ts
export type CostEvent = CostAmount & Readonly<{ id: string; operation: string; endpoint?: string; model?: string; /** an ISO-8601 instant supplied by the caller; the algebra reads no clock */ transactionTime: string; evidence: readonly string[]; }>
```

A CostAmount tagged with provenance: a unique id, the operation name, optional endpoint and model, a caller-supplied ISO-8601 transaction time, and supporting evidence.

### `CostTokens` — type-alias

```ts
export type CostTokens = Readonly<{ input: number; output: number; }>
```

A token count split into input and output, each a nonnegative integer.

### `EndpointDialect` — type-alias

```ts
export type EndpointDialect = "openai" | "anthropic"
```

The wire dialect a host applies to an endpoint, naming which codec to use: "openai" or "anthropic".

### `ENDPOINTS` — variable

```ts
export const ENDPOINTS
```

The built-in endpoint specs keyed by id: groq, nvidia, and cerebras on the openai dialect, and anthropic on the anthropic dialect.

### `EndpointSpec` — type-alias

```ts
export type EndpointSpec = Readonly<{ id: string; dialect: EndpointDialect; baseUrl: string; /** request path; defaults by dialect when omitted (see endpointUrl) */ path?: string; /** environment variable names a host may resolve a key from, most-preferred first */ apiKeyEnv?: readonly string[]; defaultModel?: string; headers?: Readonly<Record<string, string>>; }>
```

Pure data describing an inference endpoint: its id, wire dialect, base URL, optional request path, candidate api-key environment variable names, default model, and extra headers.

### `endpointUrl` — function

```ts
export function endpointUrl(endpoint: EndpointSpec): string
```

The pure request target for an endpoint: base URL joined with its (dialect-defaulted) path.

### `inferenceCostEvent` — function

```ts
export function inferenceCostEvent(result: InferenceResult, options: InferenceCostOptions): CostEvent
```

Builds a CostEvent from an inference result and pricing options: takes token counts from the result's usage or estimates them from prompt bytes and text length via charsPerToken, computes dollars from the per-million-token rates, and fills in id, operation, endpoint, model, settlement fuel, transaction time, and evidence.

### `InferenceCostOptions` — type-alias

```ts
export type InferenceCostOptions = Readonly<{ id?: string; operation?: string; /** an ISO-8601 instant; required so the algebra stays clock-free */ transactionTime: string; settlementFuel?: number; dollarsPerMillionInputTokens?: number; dollarsPerMillionOutputTokens?: number; charsPerToken?: number; evidence?: readonly string[]; }>
```

Inputs for pricing an inference into a CostEvent: optional id and operation, a required ISO-8601 transaction time, settlement fuel, per-million-token dollar rates for input and output, a chars-per-token divisor for estimating missing usage, and evidence.

### `InferenceRequest` — type-alias

```ts
export type InferenceRequest = Readonly<{ endpoint: EndpointSpec; model: string; messages: Conversation; system?: string; temperature?: number; maxTokens?: number; tools?: readonly ToolDefinition[]; extraBody?: Readonly<Record<string, JsonValue>>; }>
```

A complete request for one inference: the target endpoint and model, the conversation, and optional system prompt, temperature, max tokens, tool definitions, and extra request body fields.

### `InferenceResult` — type-alias

```ts
export type InferenceResult = Readonly<{ endpoint: string; model: string; text: string; toolCalls?: readonly ToolCall[]; usage?: TokenUsage; /** the decoded wire response, kept for provenance and re-reading */ raw: unknown; /** size of the prompt the host sent, in bytes, for cost estimation */ promptBytes: number; }>
```

The result of one inference: the endpoint id and model, the generated text, any tool calls, token usage, the decoded wire response kept for provenance, and the prompt size in bytes.

### `JsonObject` — type-alias

```ts
export type JsonObject = { readonly [key: string]: JsonValue }
```

A readonly string-keyed object whose values are JSON values.

### `JsonPrimitive` — type-alias

```ts
export type JsonPrimitive = null | boolean | number | string
```

The set of JSON scalar values: null, boolean, number, or string.

### `JsonValue` — type-alias

```ts
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
```

Any JSON value: a primitive, a readonly array of values, or a readonly string-keyed object of values.

### `message` — function

```ts
export function message(role: Role, content: string): ChatMessage
```

Constructs a chat message from a role and content string.

### `Role` — type-alias

```ts
export type Role = "system" | "user" | "assistant" | "tool"
```

The author of a chat message: "system", "user", "assistant", or "tool".

### `system` — const

```ts
export const system = (content: string): ChatMessage => …
```

Constructs a chat message with the "system" role from a content string.

### `TokenUsage` — type-alias

```ts
export type TokenUsage = Readonly<{ input?: number; output?: number; }>
```

Token counts reported for an inference: optional input and output token totals.

### `ToolCall` — type-alias

```ts
export type ToolCall = Readonly<{ id?: string; name: string; /** decoded arguments; codecs may leave these as a raw string when malformed */ arguments: JsonValue; }>
```

A tool invocation emitted by the model: an optional id, the tool name, and its decoded arguments (which codecs may leave as a raw string when malformed).

### `ToolDefinition` — type-alias

```ts
export type ToolDefinition = Readonly<{ name: string; description?: string; /** JSON Schema for the tool's parameters */ parameters?: JsonObject; }>
```

A tool offered to the model: its name, an optional description, and an optional JSON Schema for its parameters.

### `ToolResult` — type-alias

```ts
export type ToolResult = Readonly<{ toolCallId?: string; name: string; content: string; ok: boolean; }>
```

The outcome of running a tool call: the originating tool-call id, the tool name, the result content, and whether the call succeeded.

### `user` — const

```ts
export const user = (content: string): ChatMessage => …
```

Constructs a chat message with the "user" role from a content string.

## `@emsenn/computing-llm/codecs/anthropic`

### `DecodedResponse` — type-alias

```ts
export type DecodedResponse = Readonly<{ text: string; usage?: TokenUsage; }>
```

The decoded form of an Anthropic Messages response: the first text content block as `text`, and `usage` token counts when the response carries them.

### `decodeResponse` — function

```ts
export function decodeResponse(raw: unknown): DecodedResponse
```

Decode an Anthropic response into text and usage.

### `decodeText` — function

```ts
export function decodeText(raw: unknown): string
```

Read the first text content block of an Anthropic response.

### `decodeUsage` — function

```ts
export function decodeUsage(raw: unknown): TokenUsage | undefined
```

Read the token usage from an Anthropic response: returns a TokenUsage with `input` and `output` from `usage.input_tokens` / `usage.output_tokens`, omitting either field that is missing or non-finite, and undefined when neither is present.

### `encodeRequestBody` — function

```ts
export function encodeRequestBody(request: InferenceRequest): JsonObject
```

Encode an computing-llm algebra request into the Anthropic Messages request body.

## `@emsenn/computing-llm/codecs/openai`

### `DecodedResponse` — type-alias

```ts
export type DecodedResponse = Readonly<{ text: string; toolCalls?: readonly ToolCall[]; usage?: TokenUsage; }>
```

The decoded result of an OpenAI response body: the assistant text, any tool calls the model requested, and token usage. toolCalls and usage are omitted when absent.

### `decodeResponse` — function

```ts
export function decodeResponse(raw: unknown): DecodedResponse
```

Decode an OpenAI response body into text, tool calls, and usage.

### `decodeText` — function

```ts
export function decodeText(raw: unknown): string
```

Read just the assistant text, tolerant of the chat/completion/responses shapes.

### `decodeToolCalls` — function

```ts
export function decodeToolCalls(raw: unknown): readonly ToolCall[]
```

Read the tool calls from the first choice of an OpenAI response body.
Returns one ToolCall per well-formed function entry, carrying its id when present and its parsed arguments; skips entries without a string name.

### `decodeUsage` — function

```ts
export function decodeUsage(raw: unknown): TokenUsage | undefined
```

Read token usage from an OpenAI response body, mapping prompt_tokens to input and completion_tokens to output.
Returns undefined when neither finite count is present.

### `encodeRequestBody` — function

```ts
export function encodeRequestBody(request: InferenceRequest): JsonObject
```

Encode an computing-llm algebra request into the OpenAI chat-completions request body.

## `@emsenn/computing-llm/holography`

### `absentApiKey` — function

```ts
export function absentApiKey(endpoint: EndpointSpec, resolvedAt: string): ApiKeyProjection
```

An absent-key projection for an endpoint whose key could not be resolved.

### `ApiKeyBearer` — type-alias

```ts
export type ApiKeyBearer = Readonly<{ forEndpoint: string; envVarName: string; value: string; resolvedAt: string; }>
```

A resolved API key carrying its secret value: the endpoint it serves, the env var it came from, the raw value, and when it was resolved.
Held only for the duration of a call, never persisted.

### `apiKeyCharge` — function

```ts
export function apiKeyCharge(key: ApiKeyBearer | null): ChargeCarrier
```

Charge reading of key presence: present → potential, absent → ⊥ (unknown/absurd).

### `ApiKeyProjection` — type-alias

```ts
export type ApiKeyProjection = Readonly<{ forEndpoint: string; envVarName: string; resolvedAt: string; present: boolean; redacted: true; }>
```

A redacted projection of an API key: the endpoint, env var name, resolution time, and whether a key was present - never the value, with redacted always true.

### `endpointPoint` — function

```ts
export function endpointPoint(endpoint: EndpointSpec): string
```

The point identifier for an endpoint: the string "endpoint:" prefixed to the endpoint's id.

### `endpointProjection` — function

```ts
export function endpointProjection(endpoint: EndpointSpec, options: HolographyOptions = {}): EndpointProjection
```

Project an endpoint's capability readings without making a call.

### `EndpointProjection` — type-alias

```ts
export type EndpointProjection = Readonly<{ endpoint: string; point: string; baseUrl: string; defaultModel?: string; apiKey: ApiKeyProjection; apiKeyCharge: ChargeCarrier; }>
```

The capability readings of an endpoint without a live call: its id and point, base url, optional default model, the redacted api key projection, and the charge of that key's presence.

### `EnvLike` — type-alias

```ts
export type EnvLike = Readonly<Record<string, string | undefined>>
```

A read-only environment map: variable names to their string values or undefined, as seen by key resolution.

### `HolographyOptions` — type-alias

```ts
export type HolographyOptions = Readonly<{ fetch?: typeof fetch; env?: EnvLike; now?: string; }>
```

Injectable host facilities for projection: a fetch implementation, an environment map, and a fixed now timestamp - each defaulting to the live host when omitted.

### `LlmFault` — type-alias

```ts
export type LlmFault = Readonly<{ ok: false; endpoint: string; charge: ChargeCarrier; condition: "absent" | "unreachable" | "rejected"; reason: string; apiKey: ApiKeyProjection; }>
```

A failed inference witness: the endpoint, a bottom charge, a condition of "absent", "unreachable", or "rejected", a reason string, and the redacted api key projection.
Discriminated by ok being false.

### `LlmOutcome` — type-alias

```ts
export type LlmOutcome = LlmReading | LlmFault
```

The result of witnessing an inference call: either an LlmReading on success or an LlmFault on failure.

### `LlmReading` — type-alias

```ts
export type LlmReading = Readonly<{ ok: true; result: InferenceResult; charge: ChargeCarrier; apiKey: ApiKeyProjection; }>
```

A successful inference witness: the decoded result, a potential charge for the reachable reply, and the redacted api key projection.
Discriminated by ok being true.

### `projectApiKey` — function

```ts
export function projectApiKey(key: ApiKeyBearer): ApiKeyProjection
```

Strip the secret, keeping only its presence.

### `resolveApiKey` — function

```ts
export function resolveApiKey(endpoint: EndpointSpec, options: HolographyOptions = {}): ApiKeyBearer | null
```

Resolve a key from the first environment variable that holds a non-empty value.
Returns null when absent.

### `witnessInference` — function

```ts
export async function witnessInference( endpoint: EndpointSpec, request: InferenceRequest, options: HolographyOptions = {}, ): Promise<LlmOutcome>
```

Witness a live inference call as a charge reading.
With no key, returns an "absent" fault and makes no call.
Otherwise it encodes the request with the endpoint's dialect codec, performs the fetch, and decodes the reply.
A reachable, decoded reply reads as a potential charge; a transport or HTTP failure is a fault.

## `@emsenn/computing-llm/topology`

### `AgentRun` — type-alias

```ts
export type AgentRun = Readonly<{ id: string; /** the accumulating conversation; only ever grows */ conversation: Conversation; turns: readonly Turn[]; costEvents: readonly CostEvent[]; stop: LoopStop | null; finalAnswer: string | null; }>
```

The run carrier: a monotone, append-only accumulation of a run's id, its growing conversation, its turns and cost events, and - once halted - its stop reason and final answer.

### `appendTurn` — function

```ts
export function appendTurn(run: AgentRun, turn: Turn, messagesAdded: readonly ChatMessage[]): AgentRun
```

Append a turn and the messages it produced.
Enforces the monotone-growth law: a settling stage may only add to its predecessor, never drop.
Appending to an already-stopped run is rejected.

### `chargeName` — function

```ts
export function chargeName(charge: ChargeCarrier): ChargeValueName
```

The bilattice value name of a charge — the form animating trace judgments carry.

### `classifyRun` — function

```ts
export function classifyRun(run: AgentRun): RunClassification
```

Classifies a run into its witness-or-obstruction verdict from its judgment settlement and stop: an unstopped run is obstructed, a stabilized stop is settled with the final answer, and any other stop is unsettled.

### `emptyRun` — function

```ts
export function emptyRun(id: string, seed: Conversation = []): AgentRun
```

A fresh, unstopped run with the given id and optional seed conversation: no turns, no cost events, no stop, no final answer.

### `LoopStop` — type-alias

```ts
export type LoopStop = "final-answer" | "contested-tool" | "max-steps" | "cost-bound" | "max-unsettled"
```

The reason a run halted: final-answer (settled), contested-tool (held contradiction), or max-steps / cost-bound / max-unsettled (a bound that obstructed it).

### `regimeOf` — function

```ts
export function regimeOf(stop: LoopStop): RunRegime
```

The run regime a stop reason implies: final-answer maps to stabilized, contested-tool to contested, and the bound stops to obstructed.

### `RunClassification` — type-alias

```ts
export type RunClassification = | Readonly<{ settled: true; regime: "stabilized"; turns: number; finalAnswer: string; settlement: JudgmentSettlement }> | Readonly<{ settled: false; regime: "obstructed" | "contested"; turns: number; reason: LoopStop; settlement: JudgmentSettlement }>
```

The witness-or-obstruction verdict of a run: either settled with a stabilized regime and a final answer, or unsettled with an obstructed or contested regime and the stop reason; both carry the turn count and the judgment settlement.

### `runCost` — function

```ts
export function runCost(run: AgentRun): CostAmount
```

Total cost: a serial fold over the emitted cost events (projection, not replay).

### `runJudgments` — function

```ts
export function runJudgments(run: AgentRun): readonly AdmissionJudgment[]
```

One admission judgment per tool run plus one for the stop.

### `RunRegime` — type-alias

```ts
export type RunRegime = "stabilized" | "obstructed" | "contested"
```

The settlement regime of a run: stabilized (reached a fixed point), obstructed (halted by a bound), or contested (holds a contradiction).

### `runTrace` — function

```ts
export function runTrace(run: AgentRun): readonly TraceEntry[]
```

The run as an animating trace: one entry per turn and per tool run.
Charges are NOT seeded here — they are read from the judgments below, not the trace.

### `settleRun` — function

```ts
export function settleRun(run: AgentRun, stop: LoopStop, finalAnswer: string | null = null): AgentRun
```

Settle (or obstruct) the run, recording the stop and any final answer.

### `settleRunJudgments` — function

```ts
export function settleRunJudgments(run: AgentRun): JudgmentSettlement
```

Settle the run by the knowledge-join of its judgments — animating trace's canonical settlement.

### `stopCharge` — function

```ts
export function stopCharge(stop: LoopStop): ChargeCarrier
```

The bilattice reading of a stop: stabilized→potential, contested→⊤, obstructed→⊥.

### `ToolRun` — type-alias

```ts
export type ToolRun = Readonly<{ call: ToolCall; status: ToolRunStatus; charge: ChargeCarrier; output?: JsonValue; reason?: string; ran: boolean; /** which gate produced this outcome: tool-call, policy, capability, handler, … */ gate: string; }>
```

One executed tool call and its outcome: the originating call, its status, its bilattice charge, optional output and reason, whether it actually ran, and the gate that produced the outcome.

### `toolRunCharge` — function

```ts
export function toolRunCharge(status: ToolRunStatus, witness: unknown): ChargeCarrier
```

The bilattice reading of a tool run: ok→potential, refused→denied, unsettled→⊥, contested→⊤.

### `ToolRunStatus` — type-alias

```ts
export type ToolRunStatus = "ok" | "refused" | "unsettled" | "contested"
```

The outcome of running one tool call: ok (settled), refused (denied), unsettled (no determinate result), or contested (a held contradiction).

### `Turn` — type-alias

```ts
export type Turn = Readonly<{ index: number; assistant: ChatMessage; toolCalls: readonly ToolCall[]; toolRuns: readonly ToolRun[]; cost?: CostEvent; }>
```

One step of the agentic loop: its index, the assistant message, the tool calls it emitted, the resulting tool runs, and an optional cost event.
