import { executeBoundedToolAgent, executeOpenAiCompatibleToolAgent, executeOpenAiCompatibleAssistantTurn, normalizeAssistantExchange, validateChatCompletionTurn } from "../openai/tool-agent.mjs";
import { exchangeOpenAiCompatibleAssistantMessage } from "../openai/openai-compatible-chat-completion.mjs";
import { providerConfiguration, runProviderExchange } from "../openai/provider-runtime.mjs";
import { isCommandEndpoint } from "../command/exchange.mjs";
import { decodeTextAssistantRequest } from "../horde/assistant-request.mjs";
import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";

// A text carrier proposes typed receiver operations; it never performs them itself.
// The whole transcript is data, including call ids and the receiver's tool results.
export const ASSISTANT_REQUEST_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false, required: ["role", "content", "tool_calls"],
  properties: {
    role: { type: "string", const: "assistant" },
    content: { type: ["string", "null"] },
    tool_calls: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["id", "type", "function"],
      properties: {
        id: { type: "string", minLength: 1 }, type: { type: "string", const: "function" },
        function: { type: "object", additionalProperties: false, required: ["name", "arguments"],
          properties: { name: { type: "string", minLength: 1 }, arguments: { type: "string" } } },
      },
    } },
  },
});

const instruction = `Return exactly one JSON assistant request satisfying the supplied assistantRequestSchema, without Markdown or text outside JSON. Read the transcript as the conversation you are continuing. You may request ONLY an offered receiver tool by returning tool_calls, with fresh unique ids and arguments encoded as a JSON object string. The receiver executes admitted requests and supplies tool results on subsequent turns. You have no native tool execution authority. Never invent tool results. When finished, return tool_calls: [] and put your answer in content. For a JSON response format, content is the actual JSON value satisfying that format, without encoding it into a string. For plain text, content is a string. Use null content when requesting tools without accompanying text. A tool request has exactly this outer shape: {"role":"assistant","content":null,"tool_calls":[{"id":"call-1","type":"function","function":{"name":"an_offered_tool","arguments":"{}"}}]}. A final answer has exactly this outer shape: {"role":"assistant","content":"the final answer","tool_calls":[]}.`;

const textInstruction = `Continue the supplied conversation as its assistant. Use only the offered receiver tools; you have no native effect authority. Emit an offered function call, or a list of offered calls, between <|tool_call_start|> and <|tool_call_end|>. Use each exact offered function name and its declared named arguments, with JSON-compatible literal values. Return no text around a tool frame. The receiver will supply actual results in subsequent turns. Never invent tool results. When finished, return ONLY the answer in the supplied responseFormat, without an assistant envelope, Markdown, reasoning or explanation. If no responseFormat is supplied, answer in plain text.`;

function artifactSchema(responseFormat) {
  return responseFormat?.type === "json_schema" ? responseFormat.json_schema?.schema : responseFormat?.type === "json_object" ? {type:"object"} : undefined;
}

function assistantRequestSchema(responseFormat) {
  const artifact = artifactSchema(responseFormat);
  return artifact === undefined ? ASSISTANT_REQUEST_SCHEMA : {...ASSISTANT_REQUEST_SCHEMA, properties:{...ASSISTANT_REQUEST_SCHEMA.properties,content:{anyOf:[{type:"null"},artifact]}}};
}

function packetMessages(messages, tools, responseFormat, chatCompletion, maximumOutputTokens, nativeText = false) {
  return [{ role: "system", content: nativeText ? textInstruction + "\n\nOffered receiver function declarations:\n" + JSON.stringify(tools.map(tool=>tool.function)) : instruction }, { role: "user", content: JSON.stringify({
    ...(nativeText ? {} : { assistantRequestSchema: assistantRequestSchema(responseFormat) }), messages, tools,
    responseFormat: responseFormat ?? null,
    ...(chatCompletion ? { turnContract: chatCompletion } : {}),
    ...(Number.isFinite(maximumOutputTokens) ? { maximumOutputTokens } : {}),
  }) }];
}

function decodeAssistant(result, text, chatCompletion, nativeText = false, responseFormat) {
  if (!result.ok) return normalizeAssistantExchange(result);
  let message;
  try { message = nativeText ? decodeTextAssistantRequest(text, result.body.id) : JSON.parse(text); } catch { /* Invalid wire data is refused, never repaired into an action. */ }
  const refuse = (reason) => normalizeAssistantExchange({ ...result, ok: false, cause: { kind: "protocol", reason } });
  const artifact = artifactSchema(responseFormat);
  if (nativeText && artifact !== undefined && !message?.tool_calls?.length) {
    try { message = {...message,content:JSON.parse(message.content)}; } catch { return refuse("invalid-final-artifact-json"); }
  }
  if (!validateJsonSchema(message, assistantRequestSchema(responseFormat)).valid) return refuse("invalid-assistant-request-envelope");
  const calls = message.tool_calls;
  if (artifact !== undefined && !calls.length && !validateJsonSchema(message.content, artifact).valid) return refuse("final-artifact-contract-refused");
  if (artifact !== undefined && message.content !== null) message = {...message,content:JSON.stringify(message.content)};
  const choice = chatCompletion?.tool_choice;
  if ((choice === "none" && calls.length) || (choice === "required" && !calls.length)
    || (choice?.type === "function" && (!calls.length || calls.some(call => call.function.name !== choice.function.name)))
    || (chatCompletion?.parallel_tool_calls === false && calls.length > 1)) return refuse("assistant-request-violates-turn-contract");
  const body = { ...result.body, choices: [{ index: 0, message,
    finish_reason: calls.length ? "tool_calls" : result.body.choices?.[0]?.finish_reason ?? "stop" }] };
  return normalizeAssistantExchange({ ok: true, body });
}

/** One receiver loop for native tool protocols, command agents and text-only hosted compute. */
export async function executeReceiverToolAgent(options = {}) {
  const { endpoint, providerId, transport, executable, assistantProtocol, chatCompletion, responseFormat,
    model, env = process.env, resourceRoot, signal, maximumOutputTokens, checkAdmission = () => {}, ...rest } = options;
  const command = isCommandEndpoint({ endpoint });
  if (!command && assistantProtocol !== "json-envelope") return chatCompletion
    ? executeOpenAiCompatibleAssistantTurn(options) : executeOpenAiCompatibleToolAgent(options);
  if (chatCompletion && (!validateChatCompletionTurn(chatCompletion) || Object.keys(options.toolHandlers ?? {}).length || options.delegation)) {
    throw new TypeError("assistant turn mode requires an admitted chat turn without receiver execution authority");
  }
  const native = command || transport === "horde-text";
  const configuration = native ? providerConfiguration(providerId) : null;
  if (native && (configuration.transport !== transport || (command ? endpoint !== `command:${transport}` || configuration.executable !== executable : endpoint !== configuration.chatCompletionsUrl))) {
    throw new TypeError("command transport differs from its selected provider configuration");
  }
  return executeBoundedToolAgent({
    ...rest, model, signal, maximumOutputTokens, responseFormat,
    ...(chatCompletion ? { messages: chatCompletion.messages, tools: chatCompletion.tools ?? [], returnAssistantTurn: true } : {}),
    exchangeAssistantMessage: async ({ messages, tools, maximumOutputTokens: bound }) => {
      try { checkAdmission(); } catch { return { ok: false, cause: { kind: "local-admission", reason: "zero-cash-entitlement-not-admitted" } }; }
      const wireMessages = packetMessages(messages, tools, chatCompletion?.response_format ?? responseFormat, chatCompletion, bound, transport === "horde-text");
      let result, text;
      if (native) {
        let exchange;
        try { exchange = await runProviderExchange(providerId, { model, messages: wireMessages,
          ...(Number.isFinite(bound) ? { "max-tokens": bound } : {}), params: { outputSchema: assistantRequestSchema(chatCompletion?.response_format ?? responseFormat) } },
        { env, resourceRoot, signal, request: options.fetchImpl ?? fetch }); } catch { return { ok: false, cause: { kind: signal?.aborted ? "cancelled" : "command", reason: signal?.aborted ? "receiver-cancelled" : "command-provider-exchange-failed" } }; }
        if (exchange.outcome !== "completion") {
          const status = /^horde-http:([0-9]{3})$/u.exec(exchange.refusal?.unmet?.[0] ?? "");
          return { ok: false, cause: { kind: signal?.aborted ? "cancelled" : status ? "http" : "command",
            reason: exchange.refusal?.unmet?.[0] ?? "provider-refusal", providerMessage: exchange.refusal?.grounds,
            unmet: exchange.refusal?.unmet ?? [], ...(status ? { status: Number(status[1]) } : {}) } };
        }
        text = exchange.completion.text;
        const input = exchange.usage?.input?.quantity, output = exchange.usage?.output?.quantity;
        result = { ok: true, body: { id: exchange.id, object: "chat.completion", model: exchange.completion.model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: exchange.completion["finish-reason"] }],
          usage: { ...(Number.isSafeInteger(input) ? { prompt_tokens: input } : {}),
            ...(Number.isSafeInteger(output) ? { completion_tokens: output } : {}) } } };
      } else {
        result = await exchangeOpenAiCompatibleAssistantMessage({ model, messages: wireMessages,
          ...(Number.isFinite(bound) ? { max_tokens: bound } : {}), temperature: chatCompletion?.temperature ?? options.temperature ?? 0 },
        { providerId, chatCompletionsUrl: endpoint, apiKey: options.apiKey, auth: options.auth, env, signal,
          timeoutMs: options.timeoutMs ?? null }, options.fetchImpl ?? fetch);
        text = result.body?.choices?.[0]?.message?.content;
      }
      return decodeAssistant(result, text, chatCompletion, transport === "horde-text", chatCompletion?.response_format ?? responseFormat);
    },
  });
}
