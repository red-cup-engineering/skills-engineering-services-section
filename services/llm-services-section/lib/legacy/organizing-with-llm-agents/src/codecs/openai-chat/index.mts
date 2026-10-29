// OpenAI Chat Completions as a wire projection of the animating agent loop.
//
// This module stays at the de-facto /v1/chat/completions surface used by vLLM,
// Ollama, OpenRouter, and similar hosts: messages, tools/tool_calls, and
// structured outputs. It deliberately does not model Responses, Assistants,
// Realtime, batches, files, or provider-specific extensions.

import { carrierFrom, type FromSchema } from "@emsenn/relating";

import type {
  Conversation,
  EndpointSpec,
  InferenceRequest,
  InferenceResult,
  JsonObject,
  JsonValue,
  Role,
  ToolCall,
  ToolDefinition,
} from "../../algebra/index.mjs";
import { decodeResponse, encodeRequestBody } from "../openai/index.mjs";

const roleSchema = { enum: ["system", "user", "assistant", "tool"] } as const;
const finishReasonSchema = { enum: ["stop", "length", "tool_calls", "content_filter", "function_call"] } as const;

export const OpenAiChatToolCallSchema = {
  $id: "organizing/agents/llm/openai/chat/tool-call",
  title: "OpenAIChatToolCall",
  type: "object",
  required: ["id", "type", "function"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    type: { const: "function" },
    function: {
      type: "object",
      required: ["name", "arguments"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1 },
        arguments: { type: "string" },
      },
    },
  },
} as const;

export const OpenAiChatMessageSchema = {
  $id: "organizing/agents/llm/openai/chat/message",
  title: "OpenAIChatMessage",
  type: "object",
  required: ["role", "content"],
  additionalProperties: false,
  properties: {
    role: roleSchema,
    content: { type: ["string", "null"] },
    name: { type: "string" },
    tool_call_id: { type: "string" },
    tool_calls: { type: "array", items: OpenAiChatToolCallSchema },
  },
} as const;

export const OpenAiChatFunctionToolSchema = {
  $id: "organizing/agents/llm/openai/chat/function-tool",
  title: "OpenAIChatFunctionTool",
  type: "object",
  required: ["type", "function"],
  additionalProperties: false,
  properties: {
    type: { const: "function" },
    function: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        parameters: { type: "object", additionalProperties: {} },
      },
    },
  },
} as const;

export const OpenAiResponseFormatSchema = {
  $id: "organizing/agents/llm/openai/chat/response-format",
  title: "OpenAIResponseFormat",
  type: "object",
  required: ["type"],
  additionalProperties: false,
  properties: {
    type: { enum: ["text", "json_object", "json_schema"] },
    json_schema: {
      type: "object",
      required: ["name", "schema"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        strict: { type: "boolean" },
        schema: { type: "object", additionalProperties: {} },
      },
    },
  },
} as const;

export const OpenAiChatCompletionRequestSchema = {
  $id: "organizing/agents/llm/openai/chat/completion-request",
  title: "OpenAIChatCompletionRequest",
  type: "object",
  required: ["model", "messages"],
  additionalProperties: true,
  properties: {
    model: { type: "string", minLength: 1 },
    messages: { type: "array", minItems: 1, items: OpenAiChatMessageSchema },
    temperature: { type: "number" },
    max_tokens: { type: "number" },
    tools: { type: "array", items: OpenAiChatFunctionToolSchema },
    tool_choice: {},
    response_format: OpenAiResponseFormatSchema,
    stream: { type: "boolean" },
  },
} as const;

export const OpenAiChatCompletionSchema = {
  $id: "organizing/agents/llm/openai/chat/completion",
  title: "OpenAIChatCompletion",
  type: "object",
  required: ["id", "object", "created", "model", "choices"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    object: { const: "chat.completion" },
    created: { type: "integer", minimum: 0 },
    model: { type: "string", minLength: 1 },
    choices: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "message", "finish_reason"],
        additionalProperties: false,
        properties: {
          index: { type: "integer", minimum: 0 },
          message: OpenAiChatMessageSchema,
          finish_reason: finishReasonSchema,
        },
      },
    },
    usage: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt_tokens: { type: "integer", minimum: 0 },
        completion_tokens: { type: "integer", minimum: 0 },
        total_tokens: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

export type OpenAiChatToolCall = FromSchema<typeof OpenAiChatToolCallSchema>;
export type OpenAiChatMessage = Omit<FromSchema<typeof OpenAiChatMessageSchema>, "tool_calls"> & {
  readonly tool_calls?: readonly OpenAiChatToolCall[];
};
export type OpenAiChatFunctionTool = FromSchema<typeof OpenAiChatFunctionToolSchema>;
export type OpenAiResponseFormat = FromSchema<typeof OpenAiResponseFormatSchema>;
export type OpenAiChatCompletionRequest = Omit<FromSchema<typeof OpenAiChatCompletionRequestSchema>, "messages" | "tools" | "response_format"> & {
  readonly messages: readonly OpenAiChatMessage[];
  readonly tools?: readonly OpenAiChatFunctionTool[];
  readonly response_format?: OpenAiResponseFormat;
  readonly tool_choice?: unknown;
};
export type OpenAiChatCompletion = Omit<FromSchema<typeof OpenAiChatCompletionSchema>, "choices"> & {
  readonly choices: readonly {
    readonly index: number;
    readonly message: OpenAiChatMessage;
    readonly finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call";
  }[];
};

export const openAiChatToolCallCarrier = carrierFrom(OpenAiChatToolCallSchema);
export const openAiChatMessageCarrier = carrierFrom(OpenAiChatMessageSchema);
export const openAiChatFunctionToolCarrier = carrierFrom(OpenAiChatFunctionToolSchema);
export const openAiResponseFormatCarrier = carrierFrom(OpenAiResponseFormatSchema);
export const openAiChatCompletionRequestCarrier = carrierFrom(OpenAiChatCompletionRequestSchema);
export const openAiChatCompletionCarrier = carrierFrom(OpenAiChatCompletionSchema);

export type SearleForce = "assertive" | "directive" | "commissive" | "expressive" | "declarative";
export type FourValuedAnswer = "absurd" | "potential" | "active" | "stable";

export interface OpenAiLoopUtterance {
  readonly kind: "openai.chat.message-as-utterance";
  readonly role: Role;
  readonly force: SearleForce;
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface OpenAiKnowledgeReflection {
  readonly kind: "openai.chat.inference-as-knowing-reflection";
  readonly value: FourValuedAnswer;
  readonly answer: string;
  readonly reason: string;
}

export interface OpenAiPlayingCut {
  readonly kind: "openai.chat.tool-call-as-playing-cut";
  readonly call: ToolCall;
  readonly locus: string;
}

export interface OpenAiAnimatingLoopContext {
  readonly kind: "openai.chat.thread-as-animating-loop";
  readonly threadId: string;
  readonly model: string;
  readonly utterances: readonly OpenAiLoopUtterance[];
  readonly context: {
    readonly communicating: readonly OpenAiLoopUtterance[];
    readonly knowing: {
      readonly reflections: readonly OpenAiKnowledgeReflection[];
      readonly responseFormat?: OpenAiResponseFormat;
    };
    readonly playing: {
      readonly tools: readonly ToolDefinition[];
      readonly cuts: readonly OpenAiPlayingCut[];
    };
  };
}

export interface OpenAiLoopStep {
  readonly kind: "openai.chat.completion-as-loop-step";
  readonly id: string;
  readonly model: string;
  readonly created: number;
  readonly reflection: OpenAiKnowledgeReflection;
  readonly acts: readonly OpenAiPlayingCut[];
  readonly usage?: {
    readonly input?: number;
    readonly output?: number;
  };
}

export function roleToIllocutionaryForce(role: Role): SearleForce {
  switch (role) {
    case "system":
      return "declarative";
    case "user":
      return "directive";
    case "assistant":
      return "assertive";
    case "tool":
      return "commissive";
  }
}

function roleOf(value: unknown): Role {
  return value === "system" || value === "assistant" || value === "tool" ? value : "user";
}

function parseToolArguments(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

function toolCallFromOpenAi(call: OpenAiChatToolCall): ToolCall {
  return {
    id: call.id,
    name: call.function.name,
    arguments: parseToolArguments(call.function.arguments),
  };
}

function toolCallToOpenAi(call: ToolCall, index: number): OpenAiChatToolCall {
  return {
    id: call.id ?? `call_${index}`,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    },
  };
}

function toolDefinitionFromOpenAi(tool: OpenAiChatFunctionTool): ToolDefinition {
  const output: { name: string; description?: string; parameters?: JsonObject } = {
    name: tool.function.name,
  };
  if (tool.function.description !== undefined) output.description = tool.function.description;
  if (tool.function.parameters !== undefined) output.parameters = tool.function.parameters as JsonObject;
  return output;
}

function toolDefinitionToOpenAi(tool: ToolDefinition): OpenAiChatFunctionTool {
  const fn: { name: string; description?: string; parameters?: JsonObject } = { name: tool.name };
  if (tool.description !== undefined) fn.description = tool.description;
  if (tool.parameters !== undefined) fn.parameters = tool.parameters as JsonObject;
  return { type: "function", function: fn };
}

export function messageToUtterance(message: OpenAiChatMessage): OpenAiLoopUtterance {
  const role = roleOf(message.role);
  const toolCalls = message.tool_calls?.map(toolCallFromOpenAi);
  const value: {
    kind: "openai.chat.message-as-utterance";
    role: Role;
    force: SearleForce;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: readonly ToolCall[];
  } = {
    kind: "openai.chat.message-as-utterance",
    role,
    force: roleToIllocutionaryForce(role),
    content: message.content ?? "",
  };
  if (message.name !== undefined) value.name = message.name;
  if (message.tool_call_id !== undefined) value.toolCallId = message.tool_call_id;
  if (toolCalls !== undefined && toolCalls.length > 0) value.toolCalls = toolCalls;
  return value;
}

export function utteranceToMessage(utterance: OpenAiLoopUtterance): OpenAiChatMessage {
  const value: {
    role: Role;
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: readonly OpenAiChatToolCall[];
  } = {
    role: utterance.role,
    content: utterance.content,
  };
  if (utterance.name !== undefined) value.name = utterance.name;
  if (utterance.toolCallId !== undefined) value.tool_call_id = utterance.toolCallId;
  if (utterance.toolCalls !== undefined && utterance.toolCalls.length > 0) {
    value.tool_calls = utterance.toolCalls.map(toolCallToOpenAi);
  }
  return value;
}

export function openAiRequestToAnimatingLoopContext(
  request: OpenAiChatCompletionRequest,
  options: { readonly threadId?: string } = {},
): OpenAiAnimatingLoopContext {
  const admitted = openAiChatCompletionRequestCarrier.assert(request, "OpenAI chat completion request") as OpenAiChatCompletionRequest;
  const utterances = admitted.messages.map(messageToUtterance);
  const tools = (admitted.tools ?? []).map(toolDefinitionFromOpenAi);
  const cuts = utterances.flatMap((utterance) =>
    (utterance.toolCalls ?? []).map((call) => ({
      kind: "openai.chat.tool-call-as-playing-cut" as const,
      call,
      locus: `openai.tool.${call.name}`,
    })));
  const knowing: { reflections: readonly OpenAiKnowledgeReflection[]; responseFormat?: OpenAiResponseFormat } = {
    reflections: [],
  };
  if (admitted.response_format !== undefined) knowing.responseFormat = admitted.response_format;
  return {
    kind: "openai.chat.thread-as-animating-loop",
    threadId: options.threadId ?? `thread:${admitted.model}:${admitted.messages.length}`,
    model: admitted.model,
    utterances,
    context: {
      communicating: utterances,
      knowing,
      playing: { tools, cuts },
    },
  };
}

export function openAiRequestFromAnimatingLoopContext(context: OpenAiAnimatingLoopContext): OpenAiChatCompletionRequest {
  const request: {
    model: string;
    messages: readonly OpenAiChatMessage[];
    tools?: readonly OpenAiChatFunctionTool[];
    response_format?: OpenAiResponseFormat;
  } = {
    model: context.model,
    messages: context.utterances.map(utteranceToMessage),
  };
  if (context.context.playing.tools.length > 0) {
    request.tools = context.context.playing.tools.map(toolDefinitionToOpenAi);
  }
  if (context.context.knowing.responseFormat !== undefined) {
    request.response_format = context.context.knowing.responseFormat;
  }
  return openAiChatCompletionRequestCarrier.assert(request, "OpenAI request from animating context") as OpenAiChatCompletionRequest;
}

export function openAiRequestToInferenceRequest(
  request: OpenAiChatCompletionRequest,
  endpoint: EndpointSpec,
): InferenceRequest {
  const context = openAiRequestToAnimatingLoopContext(request);
  const system = context.utterances.find((m) => m.role === "system")?.content;
  const messages: Conversation = context.utterances
    .filter((m) => m.role !== "system")
    .map((m) => {
      const out: { role: Role; content: string; name?: string; toolCallId?: string } = {
        role: m.role,
        content: m.content,
      };
      if (m.name !== undefined) out.name = m.name;
      if (m.toolCallId !== undefined) out.toolCallId = m.toolCallId;
      return out;
    });
  const extraBody: Record<string, JsonValue> = {};
  if (request.response_format !== undefined) extraBody["response_format"] = request.response_format as unknown as JsonValue;
  if (request.tool_choice !== undefined) extraBody["tool_choice"] = request.tool_choice as JsonValue;
  return {
    endpoint,
    model: request.model,
    messages,
    ...(system === undefined ? {} : { system }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.max_tokens === undefined ? {} : { maxTokens: request.max_tokens }),
    ...(context.context.playing.tools.length === 0 ? {} : { tools: context.context.playing.tools }),
    ...(Object.keys(extraBody).length === 0 ? {} : { extraBody }),
  };
}

export function openAiRequestFromInferenceRequest(request: InferenceRequest): OpenAiChatCompletionRequest {
  return openAiChatCompletionRequestCarrier.assert(
    encodeRequestBody(request),
    "OpenAI request from inference request",
  ) as OpenAiChatCompletionRequest;
}

function reflectionValue(finishReason: string | undefined, message: OpenAiChatMessage | undefined): FourValuedAnswer {
  if (message?.tool_calls !== undefined && message.tool_calls.length > 0) return "active";
  if (finishReason === "stop") return "stable";
  if (finishReason === "content_filter") return "absurd";
  return "potential";
}

export function openAiCompletionToLoopStep(completion: OpenAiChatCompletion): OpenAiLoopStep {
  const admitted = openAiChatCompletionCarrier.assert(completion, "OpenAI chat completion") as OpenAiChatCompletion;
  const choice = admitted.choices[0];
  const message = choice?.message;
  const toolCalls = message?.tool_calls?.map(toolCallFromOpenAi) ?? [];
  const answer = message?.content ?? "";
  const reflection: OpenAiKnowledgeReflection = {
    kind: "openai.chat.inference-as-knowing-reflection",
    value: reflectionValue(choice?.finish_reason, message),
    answer,
    reason: choice?.finish_reason ?? "no-choice",
  };
  const usage = admitted.usage === undefined
    ? undefined
    : {
        ...(admitted.usage.prompt_tokens === undefined ? {} : { input: admitted.usage.prompt_tokens }),
        ...(admitted.usage.completion_tokens === undefined ? {} : { output: admitted.usage.completion_tokens }),
      };
  return {
    kind: "openai.chat.completion-as-loop-step",
    id: admitted.id,
    model: admitted.model,
    created: admitted.created,
    reflection,
    acts: toolCalls.map((call) => ({
      kind: "openai.chat.tool-call-as-playing-cut",
      call,
      locus: `openai.tool.${call.name}`,
    })),
    ...(usage === undefined ? {} : { usage }),
  };
}

export function openAiCompletionFromLoopStep(step: OpenAiLoopStep): OpenAiChatCompletion {
  const message: {
    role: "assistant";
    content: string | null;
    tool_calls?: readonly OpenAiChatToolCall[];
  } = {
    role: "assistant",
    content: step.acts.length > 0 ? null : step.reflection.answer,
  };
  if (step.acts.length > 0) {
    message.tool_calls = step.acts.map((act, index) => toolCallToOpenAi(act.call, index));
  }
  const prompt = Math.max(0, Math.trunc(step.usage?.input ?? 0));
  const completion = Math.max(0, Math.trunc(step.usage?.output ?? 0));
  const value = {
    id: step.id,
    object: "chat.completion" as const,
    created: step.created,
    model: step.model,
    choices: [{
      index: 0,
      message,
      finish_reason: step.acts.length > 0 ? "tool_calls" as const : "stop" as const,
    }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  };
  return openAiChatCompletionCarrier.assert(value, "OpenAI completion from loop step") as OpenAiChatCompletion;
}

export function openAiCompletionFromInferenceResult(result: InferenceResult): OpenAiChatCompletion {
  const decoded = decodeResponse(result.raw);
  const step: OpenAiLoopStep = {
    kind: "openai.chat.completion-as-loop-step",
    id: `chatcmpl-${result.endpoint}-${result.promptBytes}`,
    model: result.model,
    created: 0,
    reflection: {
      kind: "openai.chat.inference-as-knowing-reflection",
      value: decoded.toolCalls === undefined || decoded.toolCalls.length === 0 ? "stable" : "active",
      answer: decoded.text,
      reason: decoded.toolCalls === undefined || decoded.toolCalls.length === 0 ? "stop" : "tool_calls",
    },
    acts: (decoded.toolCalls ?? []).map((call) => ({
      kind: "openai.chat.tool-call-as-playing-cut",
      call,
      locus: `openai.tool.${call.name}`,
    })),
    ...(decoded.usage === undefined ? {} : { usage: decoded.usage }),
  };
  return openAiCompletionFromLoopStep(step);
}
