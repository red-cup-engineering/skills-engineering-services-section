/** Pure OpenAI Chat Completions reading of provider-neutral inference material. */
import { requireJsonValue } from "@red-cup-engineering/json-services-section";
import { tokenUsageCounts } from "../../cost/token-usage/core.mjs";
import {
  inferenceCall,
  inferenceMessage,
  inferenceResult,
  inferenceTool,
  inferenceToolMove,
  isNeutralConstraint,
} from "../../dispatch/inference-model.mjs";
import { inferenceStreamMove } from "../../dispatch/inference-source-kind.mjs";

import {
  openaiChatCompletion,
  openaiChatCompletionChunk,
  openaiChatCompletionRequest,
} from "./codec.mjs";

const OPENAI_CHAT_TOOL_CALL_EXTRA_CONTENT = "openai.chat-completions.tool-call.extra-content";

function streamedStop(reason) {
  if (reason === "tool_calls" || reason === "function_call") return "tool-moves";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content-filter";
  return reason === "stop" ? "completed" : "incomplete";
}

/** Project one vendor chunk to zero or more provider-neutral incremental moves. */
export function inferenceMovesFromOpenAIChatChunk(
  chunk,
  firstSequence,
  observedAt,
) {
  let sequence = firstSequence;
  const moves = [];
  for (const choice of chunk.choices) {
    if (choice.delta.content !== undefined && choice.delta.content !== null && choice.delta.content.length > 0) {
      moves.push(inferenceStreamMove({
        type: "inference.text-delta",
        channel: `choice:${choice.index}`,
        sequence: sequence++,
        body: Object.freeze({ choice: choice.index, text: choice.delta.content }),
        observedAt,
      }));
    }
    for (const tool of choice.delta.tool_calls ?? []) {
      moves.push(inferenceStreamMove({
        type: "inference.tool-call-delta",
        channel: `choice:${choice.index}:tool:${tool.index}`,
        sequence: sequence++,
        body: Object.freeze({
          choice: choice.index,
          index: tool.index,
          ...(tool.id === undefined ? {} : { request: tool.id }),
          ...(tool.function?.name === undefined ? {} : { name: tool.function.name }),
          ...(tool.function?.arguments === undefined ? {} : { arguments: tool.function.arguments }),
        }),
        observedAt,
      }));
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      moves.push(inferenceStreamMove({
        type: "inference.finish",
        channel: `choice:${choice.index}`,
        sequence: sequence++,
        body: Object.freeze({ choice: choice.index, stop: streamedStop(choice.finish_reason) }),
        observedAt,
      }));
    }
  }
  if (chunk.usage !== undefined && chunk.usage !== null) {
    moves.push(inferenceStreamMove({
      type: "inference.usage",
      channel: "usage",
      sequence: sequence++,
      body: usageFromWire(chunk.usage),
      observedAt,
    }));
  }
  return Object.freeze(moves);
}

function toolInput(call) {
  try {
    return requireJsonValue(JSON.parse(call.function.arguments), "OpenAI chat tool input");
  } catch {
    return call.function.arguments;
  }
}

function moveOf(call) {
  return inferenceToolMove({
    request: call.id,
    name: call.function.name,
    input: toolInput(call),
    ...(call.extra_content === undefined ? {} : {
      extensions: Object.freeze({
        [OPENAI_CHAT_TOOL_CALL_EXTRA_CONTENT]: requireJsonValue(call.extra_content, "OpenAI chat tool-call extra_content"),
      }),
    }),
  });
}

function extraContentOf(move) {
  const extension = move.extensions?.[OPENAI_CHAT_TOOL_CALL_EXTRA_CONTENT];
  if (extension === undefined) return undefined;
  if (extension === null || typeof extension !== "object" || Array.isArray(extension)) {
    throw new TypeError("OpenAI chat tool-call extra_content extension must be an object");
  }
  return extension;
}

function messageFromWire(message) {
  return inferenceMessage({
    role: message.role,
    content: message.content ?? null,
    ...(message.name === undefined ? {} : { name: message.name }),
    ...(message.tool_call_id === undefined ? {} : { toolRequest: message.tool_call_id }),
    ...(message.tool_calls === undefined ? {} : { toolMoves: message.tool_calls.map(moveOf) }),
  });
}

function messageToWire(message) {
  const toolCalls = message.toolMoves?.map((move) => {
    const extraContent = extraContentOf(move);
    return Object.freeze({
      id: move.request,
      type: "function",
      function: Object.freeze({ name: move.name, arguments: JSON.stringify(move.input) }),
      ...(extraContent === undefined ? {} : { extra_content: extraContent }),
    });
  });
  return Object.freeze({
    role: message.role,
    content: message.content,
    ...(message.name === undefined ? {} : { name: message.name }),
    ...(message.toolRequest === undefined ? {} : { tool_call_id: message.toolRequest }),
    ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
  });
}

function requestExtensions(request) {
  const {
    model: _model,
    messages: _messages,
    tools: _tools,
    response_format: _format,
    ...extensions
  } = request;
  return Object.keys(extensions).length === 0
    ? undefined
    : requireJsonValue(extensions, "OpenAI chat request extensions");
}

/** Decode a foreign Chat Completions request into the one canonical agent call. */
export function inferenceCallFromOpenAIChat(
  input,
  context,
) {
  const request = openaiChatCompletionRequest(input);
  const extensions = requestExtensions(request);
  return inferenceCall({
    request: context.request,
    subject: context.subject,
    model: request.model,
    messages: request.messages.map(messageFromWire),
    tools: (request.tools ?? []).map((tool) => inferenceTool({
      name: tool.function.name,
      ...(tool.function.description === undefined ? {} : { description: tool.function.description }),
      inputSchema: requireJsonValue(tool.function.parameters ?? {}, "OpenAI tool parameters"),
      ...(tool.function.strict === undefined ? {} : { strict: tool.function.strict }),
    })),
    ...([request.max_completion_tokens, request.max_tokens, request.temperature, request.top_p, request.stop].every((value) => value === undefined) ? {} : { generation: {
      ...(request.max_completion_tokens === undefined && request.max_tokens === undefined ? {} : { maxOutputTokens: request.max_completion_tokens ?? request.max_tokens }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.top_p === undefined ? {} : { topP: request.top_p }),
      ...(request.stop === undefined ? {} : { stopSequences: typeof request.stop === "string" ? [request.stop] : request.stop }),
    } }),
    ...(request.response_format === undefined ? {} : { responseConstraint: request.response_format }),
    ...(extensions === undefined ? {} : { extensions: Object.freeze({ "openai.chat-completions.request": extensions }) }),
    caller: context.caller ?? Object.freeze({ protocol: "openai.chat-completions" }),
    observedAt: context.observedAt,
    causes: context.causes ?? [],
  });
}

/** Encode one canonical agent call for an OpenAI-compatible provider. */
export function inferenceCallToOpenAIChat(call, policyExtensions = Object.freeze({})) {
  const extension = call.extensions?.["openai.chat-completions.request"];
  const callerExtras = extension !== null && typeof extension === "object" && !Array.isArray(extension)
    ? extension
    : {};
  const extras = Object.freeze({ ...callerExtras, ...policyExtensions });
  return openaiChatCompletionRequest(Object.freeze({
    ...extras,
    model: call.model,
    messages: call.messages.map(messageToWire),
    ...(call.tools.length === 0 ? {} : {
      tools: call.tools.map((tool) => Object.freeze({
        type: "function",
        function: Object.freeze({
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          parameters: tool.inputSchema,
          ...(tool.strict === undefined ? {} : { strict: tool.strict }),
        }),
      })),
    }),
    ...(call.responseConstraint === undefined ? {} : { response_format: isNeutralConstraint(call.responseConstraint)
      ? Object.freeze({ type: "json_schema", json_schema: Object.freeze({ name: call.responseConstraint.name, schema: call.responseConstraint.schema, strict: false }) })
      : call.responseConstraint }),
    ...(call.generation?.maxOutputTokens === undefined || extras["max_tokens"] !== undefined || extras["max_completion_tokens"] !== undefined ? {} : { max_completion_tokens: call.generation.maxOutputTokens }),
    ...(call.generation?.temperature === undefined ? {} : { temperature: call.generation.temperature }),
    ...(call.generation?.topP === undefined ? {} : { top_p: call.generation.topP }),
    ...(call.generation?.stopSequences === undefined ? {} : { stop: call.generation.stopSequences }),
    user: typeof extras["user"] === "string" ? extras["user"] : call.subject,
  }));
}

function stopOf(reason, moves) {
  if (moves.length > 0 || reason === "tool_calls" || reason === "function_call") return "tool-moves";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content-filter";
  return reason === "stop" ? "completed" : "incomplete";
}

function detail(details, key) {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return undefined;
  const value = (details)[key];
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function usageFromWire(usage) {
  return tokenUsageCounts({
    inputTokens: usage?.prompt_tokens,
    cachedInputTokens: detail(usage?.prompt_tokens_details, "cached_tokens"),
    outputTokens: usage?.completion_tokens,
    reasoningOutputTokens: detail(usage?.completion_tokens_details, "reasoning_tokens"),
    totalTokens: usage?.total_tokens,
  });
}

function wireUsage(usage) {
  if (![usage?.inputTokens, usage?.outputTokens, usage?.totalTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) return undefined;
  return Object.freeze({ prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.totalTokens,
    ...(usage.cachedInputTokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: usage.cachedInputTokens } }),
    ...(usage.reasoningOutputTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: usage.reasoningOutputTokens } }) });
}

/** Decode a provider reply without authorizing or dispatching its tool moves. */
export function inferenceResultFromOpenAIChat(
  input,
  call,
  observedAt,
  causes = [],
) {
  // The literal wire contract remains strict. Partial vendor observations
  // belong to the canonical evidence carrier, independently of that contract.
  const { usage: rawUsage, ...reply } = input;
  const observedUsage = rawUsage === undefined ? undefined : usageFromWire(rawUsage);
  const response = openaiChatCompletion({ ...reply, ...(wireUsage(observedUsage) === undefined ? {} : { usage: rawUsage }) });
  const choice = response.choices[0];
  const message = choice?.message === undefined ? undefined : messageFromWire(choice.message);
  const moves = Object.freeze(message?.toolMoves ?? []);
  const usage = rawUsage;
  return inferenceResult({
    call: call.id,
    model: response.model,
    stop: stopOf(choice?.finish_reason ?? null, moves),
    ...(message === undefined ? {} : { message }),
    toolMoves: moves,
    ...(usage === undefined ? {} : { usage: {
      ...observedUsage,
      extensions: Object.freeze({ "openai.chat-completions.usage": requireJsonValue(usage, "OpenAI chat usage") }),
    } }),
    extensions: Object.freeze({
      "openai.chat-completions.response": requireJsonValue(response, "OpenAI chat response"),
      "openai.chat-completions.id": response.id,
    }),
    observedAt,
    causes,
  });
}

function finishReason(stop) {
  if (stop === "tool-moves") return "tool_calls";
  if (stop === "length") return "length";
  if (stop === "content-filter" || stop === "refused") return "content_filter";
  return stop === "completed" ? "stop" : null;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/** Project one admitted canonical move into an OpenAI chunk, when the wire can express it. */
export function openAIChatChunkFromEncounterMove(
  move,
  context,
) {
  const body = record(move.body);
  const choice = typeof body?.choice === "number" ? body.choice : 0;
  const base = {
    id: context.id,
    object: "chat.completion.chunk",
    created: context.created,
    model: context.model,
  };
  if (move.type === "inference.response-start") {
    return openaiChatCompletionChunk({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  }
  if (move.type === "inference.text-delta" && typeof body?.text === "string") {
    return openaiChatCompletionChunk({ ...base, choices: [{ index: choice, delta: { content: body.text }, finish_reason: null }] });
  }
  if (move.type === "inference.tool-call-delta" && typeof body?.index === "number") {
    const request = typeof body.request === "string" ? body.request : undefined;
    const name = typeof body.name === "string" ? body.name : undefined;
    const arguments_ = typeof body.arguments === "string" ? body.arguments : undefined;
    return openaiChatCompletionChunk({
      ...base,
      choices: [{
        index: choice,
        delta: { tool_calls: [{
          index: body.index,
          ...(request === undefined ? {} : { id: request, type: "function" }),
          ...(name === undefined && arguments_ === undefined ? {} : { function: {
            ...(name === undefined ? {} : { name }),
            ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
          } }),
        }] },
        finish_reason: null,
      }],
    });
  }
  if (move.type === "inference.finish" && typeof body?.stop === "string") {
    return openaiChatCompletionChunk({ ...base, choices: [{ index: choice, delta: {}, finish_reason: finishReason(body.stop) }] });
  }
  if (move.type === "inference.usage"
    && typeof body?.inputTokens === "number"
    && typeof body.outputTokens === "number"
    && typeof body.totalTokens === "number") {
    return openaiChatCompletionChunk({
      ...base,
      choices: [],
      usage: {
        prompt_tokens: body.inputTokens,
        completion_tokens: body.outputTokens,
        total_tokens: body.totalTokens,
        ...(body.cachedInputTokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: body.cachedInputTokens } }),
        ...(body.reasoningOutputTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: body.reasoningOutputTokens } }),
      },
    });
  }
  return undefined;
}

/** Encode a canonical result for a foreign OpenAI-compatible client. */
export function inferenceResultToOpenAIChat(result) {
  const preserved = result.extensions?.["openai.chat-completions.response"];
  if (preserved !== null && typeof preserved === "object" && !Array.isArray(preserved)) {
    return openaiChatCompletion(preserved);
  }
  const message = result.message ?? inferenceMessage({
    role: "assistant",
    content: result.toolMoves.length === 0 ? "" : null,
    ...(result.toolMoves.length === 0 ? {} : { toolMoves: result.toolMoves }),
  });
  const created = Math.max(0, Math.trunc(Date.parse(result.observedAt) / 1000));
  return openaiChatCompletion({
    id: result.id,
    object: "chat.completion",
    created: Number.isFinite(created) ? created : 0,
    model: result.model,
    choices: Object.freeze([Object.freeze({
      index: 0,
      message: messageToWire(message),
      finish_reason: finishReason(result.stop),
    })]),
    ...(wireUsage(result.usage) === undefined ? {} : { usage: wireUsage(result.usage) }),
  });
}
