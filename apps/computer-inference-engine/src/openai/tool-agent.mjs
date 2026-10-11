import { configureOpenAiCompatibleRequest, exchangeOpenAiCompatibleAssistantMessage } from "./openai-compatible-chat-completion.mjs";
import { CHAT_COMPLETION_TURN_INPUT_SCHEMA } from "./chat-turn-contract.mjs";
import { admit, defineType, createTypeSystem } from "@red-cup-engineering/computer-data-engineering-services-section/type-system";
import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { declareCapabilityOperation } from "@red-cup-engineering/computer-code-engineering-services-section/typed-operation";
import { bindingsProviders, createComputerPlatform } from "@red-cup-engineering/computer-system-platform";

const required = (result) => { if (!result.ok) throw new TypeError(result.refusal.message); return result.value; };

/** Project a function-tool wire catalog into the platform's typed operation system.
 * Schemas and granted handlers are boundary data; admission and execution belong
 * to the same core as local and network operation calls.
 */
export function createToolPlatform({ tools = [], toolHandlers = {}, toolResultSchemas = {} } = {}) {
  const types = [];
  const operations = tools.map((tool) => {
    const name = validateTool(tool);
    const declare = (side, schema) => required(defineType({ id: `tool:${name}:${side}`, name, description: `${name} ${side}`, parents: [], schema }));
    const domain = declare("input", tool.function.parameters ?? true);
    const codomain = declare("output", toolResultSchemas[name] ?? true);
    types.push(domain, codomain);
    return required(declareCapabilityOperation({ id: name, domain, codomain, effects: [name] }));
  });
  return createComputerPlatform({
    id: "receiver-tools", typeSystem: required(createTypeSystem(types)), operations,
    providers: bindingsProviders(toolHandlers),
  });
}

function validateTool(tool) {
  const operation = tool?.function;
  if (tool?.type !== "function" || typeof operation?.name !== "string" || operation.name.length === 0) {
    throw new TypeError("each offered tool must be one named function operation");
  }
  return operation.name;
}

function parseArguments(call, name) {
  const source = call?.function?.arguments;
  let value;
  try { value = source === "" || source === null || source === undefined ? {} : typeof source === "string" ? JSON.parse(source) : source; }
  catch { throw new TypeError(`provider supplied invalid JSON arguments for ${name}`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`provider supplied non-object arguments for ${name}`);
  }
  return Object.freeze({ ...value });
}

function usageProjection(source) {
  const usage = source?.usage;
  return Object.freeze({
    promptTokens: Number.isInteger(usage?.prompt_tokens) ? usage.prompt_tokens : null,
    outputTokens: Number.isInteger(usage?.completion_tokens) ? usage.completion_tokens : null,
    totalTokens: Number.isInteger(usage?.total_tokens) ? usage.total_tokens : null,
    // What the provider says this exchange cost, as it wrote it (OpenRouter's usage.cost); never derived.
    reportedCost: typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? String(usage.cost)
      : typeof usage?.cost === "string" && /^\d+(?:\.\d+)?(?:e-?\d+)?$/iu.test(usage.cost) ? usage.cost : null,
  });
}

/** Project completed transport observations independently of assistant admission. */
export function normalizeAssistantExchange(result) {
  const response = result.body;
  const choice = response?.choices?.[0];
  return { ok: result.ok, ...(result.ok ? {} : { cause: result.cause }),
    ...(response === undefined ? {} : { response, model: response?.model,
      message: choice?.message, finishReason: choice?.finish_reason ?? null,
      usage: usageProjection(response) }),
  };
}

function admittedToolCalls(calls, offeredNames, runtime, usedCallIds) {
  const callIds = new Set(usedCallIds);
  const admitted = [];
  const toolRefusals = [];
  for (const call of calls) {
    const name = call?.function?.name;
    if (!offeredNames.has(name)) return { reason: "ungranted-tool-request" };
    if (typeof call.id !== "string" || call.id.length === 0 || callIds.has(call.id)) return { reason: "invalid-or-duplicate-tool-call-id" };
    callIds.add(call.id);
    try {
      const args = parseArguments(call, name);
      const admission = admit(runtime.operation(name).domain, args);
      if (!admission.ok) {
        toolRefusals.push(Object.freeze({ id: call.id, operation: name, refusal: admission.refusal }));
      } else {
        admitted.push({ call, name, args });
      }
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return toolRefusals.length > 0
    ? { reason: "tool-input-schema-refusal", toolRefusals: Object.freeze(toolRefusals) }
    : { calls: admitted };
}

export function validateChatCompletionTurn(chatCompletion) {
  if (!validateJsonSchema(chatCompletion, CHAT_COMPLETION_TURN_INPUT_SCHEMA).valid) return false;
  const offeredNames = new Set((chatCompletion.tools ?? []).map((tool) => tool.function.name));
  if (offeredNames.size !== (chatCompletion.tools ?? []).length) return false;
  const selected = chatCompletion.tool_choice;
  if (selected?.type === "function" && !offeredNames.has(selected.function.name)) return false;
  const pending = new Set();
  for (const message of chatCompletion.messages) {
    if (message.role === "tool") {
      if (typeof message.content !== "string" || typeof message.tool_call_id !== "string" || !pending.delete(message.tool_call_id)) return false;
      continue;
    }
    if (pending.size > 0 || (message.role !== "assistant" && message.tool_calls !== undefined)) return false;
    if (message.role !== "assistant" && typeof message.content !== "string") return false;
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        if (!offeredNames.has(call.function.name) || pending.has(call.id)) return false;
        try { parseArguments(call, call.function.name); } catch { return false; }
        pending.add(call.id);
      }
    }
  }
  return pending.size === 0;
}

function effectEvidence(invocations) {
  const toolHandlersStarted = invocations.filter((invocation) => invocation.executed === true).length;
  return { toolHandlersStarted, prohibitedEffectsPerformed: toolHandlersStarted === 0 ? false : null };
}

function failureResidue({ provider, model, invocations, exchanges, started, kind, reason, phase, status, retryAfterSeconds, toolRefusals, providerMessage, unmet }) {
  return Object.freeze({
    type: "ReceiverOwnedToolAgentResidue",
    disposition: "provider-exchange-failed",
    provider,
    model,
    cause: Object.freeze({ kind, reason, ...(typeof providerMessage === "string" ? { providerMessage: providerMessage.slice(0,1000) } : {}), ...(Array.isArray(unmet) ? { unmet: unmet.filter(value=>typeof value === "string").slice(0,16) } : {}), ...(phase === undefined ? {} : { phase }), ...(toolRefusals === undefined ? {} : { toolRefusals }), ...(Number.isInteger(status) ? { status } : {}), ...(Number.isSafeInteger(retryAfterSeconds) ? { retryAfterSeconds } : {}) }),
    invocations: Object.freeze(invocations),
    exchanges: Object.freeze(exchanges),
    durationMs: Math.round(performance.now() - started),
    ...effectEvidence(invocations),
  });
}

/**
 * Runs one bounded OpenAI-compatible tool-calling exchange loop.
 * @param {object} options
 * @param {object} [options.responseFormat] - an OpenAI-compatible `response_format` body field
 *   (e.g. `{type: "json_schema", json_schema: {name, schema, strict}}`), merged into every
 *   request verbatim when supplied. The caller decides provider-side schema enforcement; this
 *   function never infers or validates the schema's shape.
 * @returns {Promise<object>} a ReceiverOwnedToolAgentCompletion or ReceiverOwnedToolAgentResidue
 */
export async function executeBoundedToolAgent({
  provider,
  model,
  messages,
  platform: suppliedPlatform,
  onEvent = async () => {},
  tools = suppliedPlatform?.operations().map((operation) => ({ type: "function", function: { name: operation.id, description: operation.description, parameters: operation.domain.schema } })) ?? [],
  toolHandlers = {},
  // No fixed counts: a turn runs until the model answers, the work's signal aborts, or the shared
  // budget (the Resource the work is accounted against) refuses. A caller may still pass a bound.
  maximumToolRounds = Infinity,
  maximumToolCalls = Infinity,
  maximumOutputTokens,
  responseFormat,
  signal,
  budget = createToolAgentBudget(),
  delegation,
  depth = 0,
  maximumDepth = 0,
  toolResultSchemas = {},
  exchangeAssistantMessage,
  returnAssistantTurn = false,
} = {}) {
  if (typeof provider !== "string" || provider.length === 0) throw new TypeError("provider name is required");
  if (typeof exchangeAssistantMessage !== "function") throw new TypeError("one receiver-supplied normalized exchange is required");
  if (typeof model !== "string" || model.length === 0) throw new TypeError("provider model is required");
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError("one nonempty message sequence is required");
  const count = (value) => value === Infinity || (Number.isInteger(value) && value >= 0);
  if (!count(maximumToolRounds)) throw new TypeError("maximumToolRounds must be a nonnegative integer or unbounded");
  if (!count(maximumToolCalls)) throw new TypeError("maximumToolCalls must be a nonnegative integer or unbounded");
  if (maximumOutputTokens !== undefined && !(Number.isInteger(maximumOutputTokens) && maximumOutputTokens >= 1)) throw new TypeError("maximumOutputTokens must be a positive integer when given");
  if (responseFormat !== undefined && (typeof responseFormat !== "object" || responseFormat === null || Array.isArray(responseFormat))) {
    throw new TypeError("responseFormat must be one OpenAI-compatible response_format object");
  }
  if (typeof returnAssistantTurn !== "boolean") throw new TypeError("returnAssistantTurn must be boolean");
  if (returnAssistantTurn && (Object.keys(toolHandlers).length > 0 || delegation !== undefined)) throw new TypeError("assistant turn mode does not admit receiver handlers or delegation");

  if (!Number.isSafeInteger(depth) || depth < 0 || !Number.isSafeInteger(maximumDepth) || maximumDepth < depth) throw new TypeError("invalid delegation depth bounds");
  if (!budget || typeof budget.reserve !== "function" || typeof budget.snapshot !== "function") throw new TypeError("one shared receiver budget is required");
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function");
  if (suppliedPlatform && (Object.keys(toolHandlers).length || delegation)) throw new TypeError("an existing platform owns its tool handlers and delegation");
  tools = structuredClone(tools);
  toolHandlers = { ...toolHandlers };
  if (delegation !== undefined) {
    if (typeof delegation !== "function") throw new TypeError("delegation must be one receiver-owned route");
    if (tools.some((tool) => tool?.function?.name === "delegate_inference")) throw new TypeError("delegate_inference is reserved for the receiver route");
    const inheritedTools = tools;
    const inheritedHandlers = toolHandlers;
    tools = [...tools, DELEGATE_INFERENCE_TOOL];
    toolHandlers = { ...toolHandlers, async delegate_inference(args) {
      if (depth >= maximumDepth) throw new Error("delegation-depth-bound-exhausted");
      const names = new Set(args.tools ?? []);
      if ([...names].some((name) => !inheritedTools.some((tool) => tool.function.name === name))) throw new Error("child-capability-not-granted");
      return delegation({ objective: args.objective, tools: inheritedTools.filter((tool) => names.has(tool.function.name)), toolHandlers: Object.fromEntries([...names].map((name) => [name, inheritedHandlers[name]])), toolResultSchemas, budget, depth: depth + 1, maximumDepth, maximumToolRounds, maximumToolCalls, maximumOutputTokens, responseFormat, signal });
    } };
  }
  const offeredNames = new Set(tools.map(validateTool));
  if (offeredNames.size !== tools.length) throw new TypeError("offered tool names must be unique");
  if (suppliedPlatform && [...offeredNames].some((name) => !suppliedPlatform.operation(name))) throw new TypeError("offered tools must belong to the supplied platform");
  for (const name of offeredNames) {
    if (returnAssistantTurn || suppliedPlatform) break;
    if (typeof toolHandlers[name] !== "function") throw new Error(`offered tool ${name} has no receiver-owned handler`);
  }

  const startedTools = new Set();
  const platform = suppliedPlatform ?? createToolPlatform({ tools, toolResultSchemas, toolHandlers: Object.fromEntries(
    Object.entries(toolHandlers).map(([name, handler]) => [name, (args) => { startedTools.add(name); return handler(args); }]),
  ) });

  const conversation = messages.map((message) => structuredClone(message));
  const invocations = [];
  const exchanges = [];
  const started = performance.now();
  let observedModel = model;
  const usedCallIds = new Set();

  try {
  for (let round = 0; ; round += 1) {
    if (signal?.aborted) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "cancelled", reason: "receiver-cancelled" });
    // A request holds at most what the shared budget has left, and asks the provider for no more.
    const hold = Math.min(maximumOutputTokens ?? Infinity, budget.snapshot().outputTokens ?? Infinity);
    if (hold < 1) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "resource", reason: "shared-output-token-budget-exhausted" });
    if (!budget.reserve({ requests: 1, outputTokens: hold })) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "resource", reason: "shared-request-budget-exhausted" });
    const remaining = budget.snapshot();
    const delegationAvailable = depth < maximumDepth && invocations.length < maximumToolCalls && round < maximumToolRounds
      && (remaining.toolCalls ?? Infinity) > 0 && (remaining.requests ?? Infinity) > 0;
    const offeredTools = tools.filter((tool) => delegation === undefined || tool.function.name !== "delegate_inference" || delegationAvailable);
    const turnOfferedNames = new Set(offeredTools.map((tool) => tool.function.name));
    const exchange = await exchangeAssistantMessage({ messages: conversation, tools: offeredTools, maximumOutputTokens: hold });
    const answered = exchange?.ok || exchange?.response !== undefined;
    if (answered) {
      if (typeof exchange.model === "string" && exchange.model.length > 0) observedModel = exchange.model;
      exchanges.push(Object.freeze({ finishReason: exchange.finishReason ?? null, usage: exchange.usage ?? { promptTokens: null, outputTokens: null, totalTokens: null },
        ...(exchange.message === undefined ? {} : { message: structuredClone(exchange.message) }) }));
    }
    // Settle the hold to measured use: an unanswered transport failure spent no provider request and
    // no output; a provider's HTTP refusal spent the request but returned no completion, which is its
    // own statement of the output it made (none); otherwise unmeasured output stays spent.
    const measuredOutput = exchange?.usage?.outputTokens;
    const refusedByStatus = !answered && exchange?.cause?.kind === "http";
    budget.release?.(!answered && exchange?.cause?.kind === "transport"
      ? { requests: 1, outputTokens: hold }
      : refusedByStatus ? { outputTokens: hold }
        : { outputTokens: Number.isSafeInteger(measuredOutput) && measuredOutput >= 0 ? Math.max(0, hold - measuredOutput) : 0 });
    if (!exchange?.ok) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, ...(exchange?.cause ?? { kind: "protocol", reason: "normalized-exchange-invalid" }) });
    const assistant = exchange.message;
    if (assistant === null || typeof assistant !== "object") {
      return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "protocol", reason: "missing-assistant-message" });
    }
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    await onEvent({ type: "assistant", message: structuredClone(assistant) });
    if (returnAssistantTurn) {
      const admission = admittedToolCalls(calls, turnOfferedNames, platform, usedCallIds);
      if (admission.reason) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "protocol", reason: admission.reason, toolRefusals: admission.toolRefusals });
      return Object.freeze({
        type: "ReceiverOwnedAssistantTurn",
        provider,
        model: observedModel,
        response: exchange.response,
        message: structuredClone(assistant),
        invocations: Object.freeze(invocations),
        exchanges: Object.freeze(exchanges),
        durationMs: Math.round(performance.now() - started),
      });
    }
    if (calls.length === 0) {
      if (typeof assistant.content !== "string" || assistant.content.length === 0) {
        return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "protocol", reason: "missing-completion-content" });
      }
      return Object.freeze({
        type: "ReceiverOwnedToolAgentCompletion",
        provider,
        model: observedModel,
        text: assistant.content,
        messages: Object.freeze([...conversation, structuredClone(assistant)]),
        invocations: Object.freeze(invocations),
        exchanges: Object.freeze(exchanges),
        durationMs: Math.round(performance.now() - started),
      });
    }
    if (round >= maximumToolRounds) {
      return Object.freeze({
        type: "ReceiverOwnedToolAgentResidue",
        disposition: "tool-round-bound-exhausted",
        provider,
        model: observedModel,
        maximumToolRounds,
        refusedCalls: Object.freeze(calls.map((call) => Object.freeze({ id: call?.id ?? null, name: call?.function?.name ?? null }))),
        invocations: Object.freeze(invocations),
        exchanges: Object.freeze(exchanges),
        durationMs: Math.round(performance.now() - started),
        ...effectEvidence(invocations),
      });
    }
    if (invocations.length + calls.length > maximumToolCalls) {
      return Object.freeze({
        type: "ReceiverOwnedToolAgentResidue",
        disposition: "tool-call-bound-exhausted",
        provider,
        model: observedModel,
        maximumToolCalls,
        refusedCalls: Object.freeze(calls.map((call) => Object.freeze({ id: call?.id ?? null, name: call?.function?.name ?? null }))),
        invocations: Object.freeze(invocations),
        exchanges: Object.freeze(exchanges),
        durationMs: Math.round(performance.now() - started),
        ...effectEvidence(invocations),
      });
    }
    if (!budget.reserve({ toolCalls: calls.length })) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "resource", reason: "shared-tool-budget-exhausted" });
    const admission = admittedToolCalls(calls, turnOfferedNames, platform, usedCallIds);
    if (admission.reason === "tool-input-schema-refusal") {
      const admittedCalls = calls.map((call) => ({ call, name: call?.function?.name, args: null }));
      conversation.push(structuredClone(assistant));
      for (const { call, name, args } of admittedCalls) {
        const result = Object.freeze({ type: "ReceiverToolRefusal", operation: name, reason: admission.reason, toolRefusals: admission.toolRefusals, prohibitedEffectsPerformed: false });
        invocations.push(Object.freeze({ id: call?.id ?? null, name: name ?? null, arguments: args, result, executed: false }));
        conversation.push({ role: "tool", tool_call_id: call?.id ?? null, content: JSON.stringify(result) });
      }
      continue;
    }
    if (admission.reason) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "protocol", reason: admission.reason, toolRefusals: admission.toolRefusals });
    const admittedCalls = admission.calls;
    conversation.push(structuredClone(assistant));
    for (const { call, name, args } of admittedCalls) {
      if (signal?.aborted) return failureResidue({ provider, model: observedModel, invocations, exchanges, started, kind: "cancelled", reason: "receiver-cancelled-before-tool-effect" });
      usedCallIds.add(call.id);
      await onEvent({ type: "tool_call", name, args, id: call.id });
      const outcome = await platform.execute(name, args, { allowedEffects: platform.operation(name).effects });
      const handlerStarted = suppliedPlatform ? outcome.ok || !["InvalidInput", "OperationUnavailable", "EffectRefused", "HostUnavailable"].includes(outcome.refusal.code) : startedTools.delete(name);
      const result = outcome.ok ? outcome.value : Object.freeze({
        type: "ReceiverToolRefusal", operation: name,
        reason: outcome.refusal.code === "InvalidOutput" ? "tool-result-schema-refusal" : outcome.refusal.message,
        prohibitedEffectsPerformed: handlerStarted ? null : false,
      });
      invocations.push(Object.freeze({ id: call.id, name, arguments: args ?? null, result, executed: handlerStarted }));
      await onEvent({ type: "tool_result", name, result, id: call.id });
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  } finally { if (!suppliedPlatform) await platform.close(); }
}

/**
 * Adapts an OpenAI-compatible transport to the receiver-owned bounded loop.
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function executeOpenAiCompatibleToolAgent({
  endpoint, apiKey, auth, fetchImpl = fetch, timeoutMs = null,
  temperature = 0, maximumOutputTokens, responseFormat, ...options
} = {}) {
  const transport = { providerId: options.provider, chatCompletionsUrl: endpoint, apiKey, auth, timeoutMs, signal: options.signal, ...(options.env === undefined ? {} : { env: options.env }) };
  configureOpenAiCompatibleRequest(transport);
  return executeBoundedToolAgent({
    ...options, maximumOutputTokens, responseFormat,
    exchangeAssistantMessage: async ({ messages, tools, maximumOutputTokens: bound = maximumOutputTokens }) => {
      const result = await exchangeOpenAiCompatibleAssistantMessage({
        model: options.model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
        ...(Number.isFinite(bound) ? { max_tokens: bound } : {}), temperature,
      }, transport, fetchImpl);
      return normalizeAssistantExchange(result);
    },
  });
}

/**
 * Performs exactly one admitted OpenAI-compatible assistant turn without
 * executing a receiver tool or delegation.
 * @param {object} options
 * @returns {Promise<object>} A ReceiverOwnedAssistantTurn or residue.
 */
export async function executeOpenAiCompatibleAssistantTurn({
  endpoint, apiKey, auth, fetchImpl = fetch, timeoutMs = null, maximumOutputTokens,
  chatCompletion, toolHandlers, delegation, ...options
} = {}) {
  if (toolHandlers !== undefined && Object.keys(toolHandlers).length > 0) throw new TypeError("assistant turn mode does not admit receiver handlers");
  if (delegation !== undefined) throw new TypeError("assistant turn mode does not admit delegation");
  if (!validateChatCompletionTurn(chatCompletion)) throw new TypeError("chatCompletion does not satisfy the admitted chat turn contract");
  const transport = { providerId: options.provider, chatCompletionsUrl: endpoint, apiKey, auth, timeoutMs, signal: options.signal, ...(options.env === undefined ? {} : { env: options.env }) };
  configureOpenAiCompatibleRequest(transport);
  return executeBoundedToolAgent({
    ...options,
    messages: chatCompletion.messages,
    tools: chatCompletion.tools ?? [],
    maximumOutputTokens,
    returnAssistantTurn: true,
    exchangeAssistantMessage: async ({ messages, tools, maximumOutputTokens: bound = maximumOutputTokens }) => {
      const body = { ...chatCompletion, messages, ...(tools.length ? { tools } : {}), model: options.model, max_tokens: bound };
      const result = await exchangeOpenAiCompatibleAssistantMessage(body, transport, fetchImpl);
      return normalizeAssistantExchange(result);
    },
  });
}

/**
 * Create one synchronously reserved budget shared by every attempt and child.
 * @param {{maximumRequests?: number, maximumToolCalls?: number, maximumOutputTokens?: number}} [limits]
 * @returns {{reserve: (units: object) => boolean, snapshot: () => object}}
 * @throws {TypeError} When any bound is neither a nonnegative safe integer nor unbounded.
 */
export function createToolAgentBudget({ maximumRequests = Infinity, maximumToolCalls = Infinity, maximumOutputTokens = Infinity } = {}) {
  // A bound is the amount of a Resource the work is accounted for; Infinity is a Resource the
  // caller does not bound here (its own accounting, an allowance window, governs it elsewhere).
  const remaining = { requests: maximumRequests, toolCalls: maximumToolCalls, outputTokens: maximumOutputTokens };
  const amount = (value) => value === Infinity || (Number.isSafeInteger(value) && value >= 0);
  if (Object.values(remaining).some((value) => !amount(value))) throw new TypeError("shared budget bounds must be nonnegative safe integers or unbounded");
  return Object.freeze({
    reserve(units) {
      if (!units || Object.entries(units).some(([key, value]) => !Object.hasOwn(remaining, key) || !amount(value) || value > remaining[key])) return false;
      for (const [key, value] of Object.entries(units)) if (remaining[key] !== Infinity) remaining[key] -= value;
      return true;
    },
    // A reservation is a hold, not a spend: what an exchange did not measurably use returns.
    release(units) {
      for (const [key, value] of Object.entries(units ?? {})) {
        if (Object.hasOwn(remaining, key) && remaining[key] !== Infinity && Number.isSafeInteger(value) && value > 0) remaining[key] += value;
      }
    },
    // What is left of each bounded Resource. An unbounded one has no amount left to state, so it is
    // absent: a snapshot is evidence (identified as JSON content), and no JSON number is unbounded.
    snapshot() { return Object.freeze(Object.fromEntries(Object.entries(remaining).filter(([, value]) => value !== Infinity))); },
  });
}

/** @type {object} */
export const DELEGATE_INFERENCE_TOOL = Object.freeze({
  type: "function",
  function: {
    name: "delegate_inference",
    description: "Request a bounded child inference through the receiver's existing route. Child tools must be a subset of the offered operations; all children share the parent's remaining budget and output contract.",
    parameters: { type: "object", properties: { objective: { type: "string", minLength: 1, maxLength: 16000 }, tools: { type: "array", items: { type: "string" }, uniqueItems: true } }, required: ["objective"], additionalProperties: false },
  },
});
