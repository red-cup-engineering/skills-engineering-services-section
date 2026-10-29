import { executeBoundedToolAgent } from "@red-cup-engineering/computer-inference-engine/openai/tool-agent";
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

export async function executeOllamaToolExchange({
  model,
  messages,
  tools = [],
  toolHandlers = {},
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 90_000,
  maximumToolRounds = 4,
  maximumOutputTokens = 256,
  contextTokens = 2_048,
  keepAlive = "10m",
  format,
  ...bounds
} = {}) {
  if (!Number.isInteger(contextTokens) || contextTokens < 256)
    throw new TypeError("contextTokens must be an integer of at least 256");
  if (bounds.signal?.aborted)
    throw new Error("Ollama exchange cancelled before resource observation");
  const observation = await observeOllamaResource({
    baseUrl,
    fetchImpl,
    timeoutMs: Math.min(timeoutMs, 5_000),
    signal: bounds.signal,
  });
  if (!observation.models.includes(model))
    throw new Error(`Ollama resource does not hold model ${model}`);
  let responseRound = 0;
  const generatedCallIds = [];
  let lastUngrant = null;
  const result = await executeBoundedToolAgent({
    provider: "ollama",
    model,
    messages,
    tools,
    toolHandlers,
    maximumToolRounds,
    maximumOutputTokens,
    ...bounds,
    exchangeAssistantMessage: async ({
      messages: conversation,
      tools: offeredTools,
    }) => {
      try {
        const callNames = new Map(
          conversation.flatMap((message) =>
            Array.isArray(message.tool_calls)
              ? message.tool_calls.map((call) => [call.id, call.function?.name])
              : [],
          ),
        );
        const nativeMessages = conversation.map((message) => {
          if (message.role === "tool")
            return {
              role: "tool",
              tool_name: callNames.get(message.tool_call_id),
              content: message.content,
            };
          if (Array.isArray(message.tool_calls))
            return {
              ...message,
              tool_calls: message.tool_calls.map((call) => ({
                ...call,
                function: {
                  ...call.function,
                  arguments:
                    typeof call.function?.arguments === "string"
                      ? JSON.parse(call.function.arguments || "{}")
                      : call.function?.arguments,
                },
              })),
            };
          return message;
        });
        const body = await exchangeJson(
          fetchImpl,
          endpoint(baseUrl, "/api/chat"),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: bounds.signal,
            body: JSON.stringify({
              model,
              messages: nativeMessages,
              ...(offeredTools?.length ? { tools: offeredTools } : {}),
              stream: false,
              think: false,
              keep_alive: keepAlive,
              ...(format ? { format } : {}),
              options: {
                num_ctx: contextTokens,
                num_predict: maximumOutputTokens,
              },
            }),
          },
          timeoutMs,
        );
        const message = body.message;
        if (message?.tool_calls)
          message.tool_calls = message.tool_calls.map((call, index) => {
            if (
              !tools.some((tool) => tool.function?.name === call.function?.name)
            )
              lastUngrant = call.function?.name ?? null;
            const id = call.id ?? `ollama:response:${responseRound}:${index}`;
            if (!call.id)
              generatedCallIds.push(
                Object.freeze({ id, source: "receiver", responseRound, index }),
              );
            return {
              ...call,
              id,
              function: {
                ...call.function,
                arguments:
                  typeof call.function?.arguments === "string"
                    ? call.function.arguments
                    : JSON.stringify(call.function?.arguments ?? {}),
              },
            };
          });
        responseRound += 1;
        return {
          ok: true,
          model: body.model ?? model,
          message,
          finishReason: body.done_reason ?? null,
          usage: {
            promptTokens: Number.isInteger(body.prompt_eval_count)
              ? body.prompt_eval_count
              : null,
            outputTokens: Number.isInteger(body.eval_count)
              ? body.eval_count
              : null,
            totalTokens: null,
          },
        };
      } catch (error) {
        return {
          ok: false,
          cause: {
            kind: "transport",
            reason: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  });
  if (result.type !== "ReceiverOwnedToolAgentCompletion") {
    const error = new Error(
      result.cause?.reason === "ungranted-tool-request"
        ? `Ollama requested ungranted tool ${lastUngrant ?? "unknown"}`
        : (result.cause?.reason ??
          result.disposition ??
          "Ollama tool exchange refused"),
    );
    error.residue = result;
    throw error;
  }
  const usage = result.exchanges.reduce(
    (total, exchange) => ({
      promptTokens:
        total.promptTokens === null || exchange.usage?.promptTokens === null
          ? null
          : total.promptTokens + exchange.usage.promptTokens,
      outputTokens:
        total.outputTokens === null || exchange.usage?.outputTokens === null
          ? null
          : total.outputTokens + exchange.usage.outputTokens,
    }),
    { promptTokens: 0, outputTokens: 0 },
  );
  return Object.freeze({
    type: "OllamaToolExchangeCompletion",
    model: result.model,
    text: result.text,
    invocations: result.invocations,
    usage: Object.freeze(usage),
    durationMs: result.durationMs,
    resource: observation,
    exchanges: result.exchanges,
    generatedCallIds: Object.freeze(generatedCallIds),
  });
}
