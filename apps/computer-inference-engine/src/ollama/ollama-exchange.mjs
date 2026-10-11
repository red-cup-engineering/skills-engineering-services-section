import { executeBoundedToolAgent, normalizeAssistantExchange } from "../openai/tool-agent.mjs";
import { exchangeRecorder } from "../command/exchange.mjs";
import { generateExchangeId, readProviderResponseJson } from "../openai/openai-compatible-chat-completion.mjs";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

function endpoint(baseUrl, path) {
  return `${String(baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, "")}${path}`;
}

async function exchangeJson(fetchImpl, url, options, timeoutMs) {
  const response = await fetchImpl(url, {
    ...options,
    signal: options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Ollama refused ${new URL(url).pathname} with HTTP ${response.status}: ${body?.error ?? "no detail"}`,
    );
  }
  if (body === null || typeof body !== "object")
    throw new Error(
      `Ollama returned no JSON object from ${new URL(url).pathname}`,
    );
  return body;
}

export async function observeOllamaResource({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 5_000,
  signal,
} = {}) {
  if (signal?.aborted)
    throw new Error("Ollama resource observation cancelled before I/O");
  const [version, catalog, resident] = await Promise.all([
    exchangeJson(
      fetchImpl,
      endpoint(baseUrl, "/api/version"),
      { signal },
      timeoutMs,
    ),
    exchangeJson(
      fetchImpl,
      endpoint(baseUrl, "/api/tags"),
      { signal },
      timeoutMs,
    ),
    exchangeJson(
      fetchImpl,
      endpoint(baseUrl, "/api/ps"),
      { signal },
      timeoutMs,
    ),
  ]);
  return Object.freeze({
    type: "OllamaResourceObservation",
    address: String(baseUrl).replace(/\/$/u, ""),
    version: version.version ?? null,
    models: Object.freeze(
      (catalog.models ?? [])
        .map((model) => model.name)
        .filter(Boolean)
        .sort(),
    ),
    residentModels: Object.freeze(
      (resident.models ?? []).map((model) =>
        Object.freeze({
          name: model.name,
          size: model.size ?? null,
          sizeVram: model.size_vram ?? null,
          contextLength: model.context_length ?? null,
        }),
      ),
    ),
  });
}

/** One native wire binding for both purchased assistant turns and receiver tool loops.
 * It transports data only; tool admission, execution, and budgets remain receiver-owned.
 */
export async function exchangeOllamaAssistantMessage(body, config = {}, request = fetch) {
  if (body.tool_choice !== undefined && body.tool_choice !== "auto") {
    return { ok: false, cause: { kind: "policy", reason: "ollama-tool-choice-not-supported" } };
  }
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const address = config.chatCompletionsUrl
    ? config.chatCompletionsUrl.replace(/\/v1\/chat\/completions$/u, "/api/chat")
    : endpoint(baseUrl, "/api/chat");
  const callNames = new Map(body.messages.flatMap(message =>
    (message.tool_calls ?? []).map(call => [call.id, call.function?.name])));
  const messages = body.messages.map(message => {
    if (message.role === "tool") return { role: "tool", tool_name: callNames.get(message.tool_call_id), content: message.content };
    if (!message.tool_calls) return message;
    return { ...message, tool_calls: message.tool_calls.map(call => ({
      ...call, function: { ...call.function, arguments: typeof call.function?.arguments === "string"
        ? JSON.parse(call.function.arguments || "{}") : call.function?.arguments },
    })) };
  });
  // num_predict -1 lets the model finish; an explicit max_tokens is the caller's own accounting.
  const options = { num_ctx: config.contextTokens ?? 32_768, num_predict: body.max_tokens ?? -1 };
  for (const name of ["temperature", "top_p", "seed", "stop"]) {
    if (body[name] !== undefined) options[name] = body[name];
  }
  const format = body.response_format?.type === "json_schema" ? body.response_format.json_schema?.schema
    : body.response_format?.type === "json_object" ? "json" : config.format;
  const timeoutMs = config.timeoutMs === undefined ? null : config.timeoutMs;
  const timeoutSignal = timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs);
  const signal = config.signal && timeoutSignal ? AbortSignal.any([config.signal, timeoutSignal]) : config.signal ?? timeoutSignal;
  const refuse = (kind, reason, details = {}) => ({ ok: false, cause: { kind, reason, ...details } });
  if (signal?.aborted) return refuse("cancelled", "receiver-cancelled");
  let response;
  try {
    response = await request(address, { method: "POST", headers: { "content-type": "application/json" }, signal,
      body: JSON.stringify({ model: body.model, messages, ...(body.tools?.length ? { tools: body.tools } : {}),
        stream: false, think: false, keep_alive: config.keepAlive ?? "10m", ...(format ? { format } : {}), options }),
    });
  } catch (error) {
    return refuse("transport", error?.name === "AbortError" || error?.name === "TimeoutError" ? "timeout" : "request-failed");
  }
  if (!response || typeof response.ok !== "boolean") return refuse("protocol", "invalid-http-response");
  if (!response.ok) return refuse("http", "provider-refused", { status: response.status });
  const received = await readProviderResponseJson(response, signal);
  if (!received.ok) return received;
  const native = received.body;
  if (!native || typeof native !== "object" || Array.isArray(native)) {
    return refuse("protocol", "missing-assistant-message");
  }
  // Completed-exchange observations survive refusal of its assistant payload.
  const observed = { model: native.model ?? body.model,
    usage: { prompt_tokens: Number.isInteger(native.prompt_eval_count) ? native.prompt_eval_count : null,
      completion_tokens: Number.isInteger(native.eval_count) ? native.eval_count : null },
  };
  if (!native.message || typeof native.message !== "object" || Array.isArray(native.message)) {
    return { ...refuse("protocol", "missing-assistant-message"), body: observed };
  }
  if (body.parallel_tool_calls === false && (native.message.tool_calls?.length ?? 0) > 1) {
    return { ...refuse("protocol", "parallel-tool-calls-refused"), body: observed };
  }
  // Ollama does not supply call IDs. These fresh correlation IDs are receiver
  // observations, explicitly attributed as such, never provider identity claims.
  const exchangeId = `ollama:${generateExchangeId()}`;
  const generatedCallIds = [];
  const message = { ...native.message, ...(native.message.tool_calls ? {
    tool_calls: native.message.tool_calls.map((call, index) => {
      const id = call.id ?? `${exchangeId}:${index}`;
      if (!call.id) generatedCallIds.push(Object.freeze({ id, source: "receiver", index }));
      return { ...call, id, type: "function", function: { ...call.function,
        arguments: typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments ?? {}),
      } };
    }),
  } : {}) };
  return { ok: true, body: { ...observed, id: exchangeId, object: "chat.completion",
    choices: [{ index: 0, message, finish_reason: message.tool_calls?.length ? "tool_calls" : native.done_reason ?? null }],
    receiverGeneratedCallIds: generatedCallIds,
  } };
}

export async function executeOllamaToolExchange({
  model, messages, tools = [], toolHandlers = {}, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch,
  // No fixed counts or deadline: the turn runs until the model answers or the caller's signal aborts;
  // the context is the model's own (Ollama's 2,048-token default truncates an agent's work silently).
  timeoutMs = null, maximumToolRounds = Infinity, maximumOutputTokens, contextTokens = 32_768,
  keepAlive = "10m", format, ...bounds
} = {}) {
  if (!Number.isInteger(contextTokens) || contextTokens < 256) throw new TypeError("contextTokens must be an integer of at least 256");
  const generatedCallIds = [];
  const result = await executeBoundedToolAgent({
    provider: "ollama", model, messages, tools, toolHandlers, maximumToolRounds, maximumOutputTokens, ...bounds,
    exchangeAssistantMessage: async ({ messages, tools }) => {
      const exchange = await exchangeOllamaAssistantMessage({ model, messages, tools, max_tokens: maximumOutputTokens },
        { baseUrl, timeoutMs, contextTokens, keepAlive, format, signal: bounds.signal }, fetchImpl);
      if (exchange.ok) generatedCallIds.push(...exchange.body.receiverGeneratedCallIds);
      return normalizeAssistantExchange(exchange);
    },
  });
  if (result.type !== "ReceiverOwnedToolAgentCompletion") {
    const error = new Error(result.cause?.reason ?? result.disposition ?? "Ollama tool exchange refused");
    error.residue = result;
    throw error;
  }
  const usage = result.exchanges.reduce((total, exchange) => ({
    promptTokens: total.promptTokens === null || exchange.usage?.promptTokens === null ? null : total.promptTokens + exchange.usage.promptTokens,
    outputTokens: total.outputTokens === null || exchange.usage?.outputTokens === null ? null : total.outputTokens + exchange.usage.outputTokens,
  }), { promptTokens: 0, outputTokens: 0 });
  return Object.freeze({ type: "OllamaToolExchangeCompletion", model: result.model, text: result.text,
    invocations: result.invocations, usage: Object.freeze(usage), durationMs: result.durationMs,
    exchanges: result.exchanges, generatedCallIds: Object.freeze(generatedCallIds) });
}

/**
 * One chat packet through Ollama's native /api/chat (thinking off, so reasoning
 * models answer in content), settled as an exchange record like every provider.
 * @param {{model: string, messages: Array, "max-tokens"?: number, params?: {format?: object}}} packet
 */
export async function runOllamaChatExchange(packet, { env = process.env, fetchImpl = fetch, contextTokens = 32_768, timeoutMs = null, signal } = {}) {
  const record = exchangeRecorder(packet, "ollama-requests");
  try {
    const completion = await executeOllamaToolExchange({
      baseUrl: env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL,
      fetchImpl,
      model: packet.model,
      messages: packet.messages,
      maximumOutputTokens: packet["max-tokens"] ?? 1_024,
      contextTokens,
      timeoutMs,
      signal,
      ...(packet.params?.format ? { format: packet.params.format } : {}),
    });
    if (!completion.text?.trim()) return record.refusal("Ollama returned no completion content", ["missing-completion-content"]);
    return record.completion({ model: completion.model, text: completion.text, raw: { usage: { input_tokens: completion.usage.promptTokens, output_tokens: completion.usage.outputTokens } }, usagePrefix: "ollama" });
  } catch (error) {
    return record.refusal(error.message, [/does not hold model/u.test(error.message) ? "missing-model" : "ollama-exchange-failed"]);
  }
}

/**
 * Admit one bounded typed-inference request against a local provider's declared
 * bounds (work types, source words and characters, request characters, output
 * tokens). Returns the admitted payload and output bound; throws on the first unmet bound.
 */
export function admitBoundedTypedInference({ instruction, input, model }, bounds) {
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model must be nonempty text");
  if (bounds.model && model !== bounds.model) throw new Error(`provider does not offer model ${model}`);
  let payload;
  try { payload = JSON.parse(input); } catch { throw new Error("provider requires one bounded typed inference payload"); }
  if (!bounds.workTypes.includes(payload?.workType)) throw new Error(`provider does not offer work type ${payload?.workType ?? "missing"}`);
  if (instruction.length + input.length > bounds.maximumRequestCharacters) throw new Error(`request exceeds its ${bounds.maximumRequestCharacters}-character envelope`);
  const source = payload?.context?.suppliedContext;
  if (typeof source !== "string") throw new Error("provider requires one exact suppliedContext string");
  const sourceWords = source.trim() === "" ? 0 : source.trim().split(/\s+/u).length;
  if (sourceWords < 1 || sourceWords > bounds.maximumSourceWords || source.length > bounds.maximumSourceCharacters) throw new Error(`source exceeds its nonempty ${bounds.maximumSourceWords}-word/${bounds.maximumSourceCharacters}-character bound`);
  const maximumOutputTokens = payload?.executionBounds?.maximumOutputTokens;
  if (!Number.isInteger(maximumOutputTokens) || maximumOutputTokens < 1 || maximumOutputTokens > bounds.maximumOutputTokens) throw new Error(`output request exceeds its ${bounds.maximumOutputTokens}-token bound`);
  return { payload, maximumOutputTokens };
}
