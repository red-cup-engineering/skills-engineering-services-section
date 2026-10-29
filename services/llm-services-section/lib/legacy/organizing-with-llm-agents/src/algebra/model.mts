// @emsenn/organizing-with-llm-agents/algebra — the carrier model of language-model inference.
//
// Pure data and total functions over it. No IO, no network, no parsing of wire
// formats (that is the codec layer: @emsenn/organizing-with-llm-agents/codecs/openai, -anthropic), and no
// settling (that is @emsenn/organizing-with-llm-agents/running). The model here is the set of initial
// objects every layer above shares.

import { action, carrierFrom, tm, type FromSchema } from "@emsenn/relating";
import {
  ChatMessageSchema,
  TokenUsageSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
} from "@emsenn/organizing-with-agents/algebra";
import type {
  Conversation,
  JsonValue,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "@emsenn/organizing-with-agents/algebra";

export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  Role,
  ChatMessage,
  Conversation,
  ToolDefinition,
  ToolCall,
  ToolResult,
  TokenUsage,
} from "@emsenn/organizing-with-agents/algebra";
export {
  message,
  system,
  user,
  assistant,
} from "@emsenn/organizing-with-agents/algebra";

// ── endpoints ─────────────────────────────────────────────────────────────────
// The dialect names which codec a host applies; the spec itself carries no codec
// function, so it stays pure data that can be serialized and compared.
/**
 * The wire dialect a host applies to an endpoint, naming which codec to use:
 * "openai" or "anthropic".
 */
export const EndpointDialectSchema = { anyOf: [{ const: "openai" }, { const: "anthropic" }] } as const;

export type EndpointDialect = FromSchema<typeof EndpointDialectSchema>;

export const EndpointSpecSchema = { "$id": "organizing/agents/llm/algebra/endpoint", "title": "LlmEndpointSpec", "additionalProperties": false, type: "object", required: ["id", "dialect", "baseUrl"], properties: { "id": { type: "string", "minLength": 1 }, "dialect": EndpointDialectSchema, "baseUrl": { type: "string", "minLength": 1 }, "path": { type: "string", "minLength": 1 }, "apiKeyEnv": { type: "array", items: { type: "string", "minLength": 1 } }, "defaultModel": { type: "string", "minLength": 1 }, "headers": { type: "object", additionalProperties: { type: "string" } } } } as const;

/**
 * Pure data describing an inference endpoint: its id, wire dialect, base URL,
 * optional request path, candidate api-key environment variable names, default
 * model, and extra headers.
 */
export type EndpointSpec = Readonly<FromSchema<typeof EndpointSpecSchema>>;

export const endpointSpecCarrier = carrierFrom(EndpointSpecSchema);

const DEFAULT_PATH: Record<EndpointDialect, string> = {
  openai: "/chat/completions",
  anthropic: "/v1/messages",
};

/** The pure request target for an endpoint: base URL joined with its (dialect-defaulted) path. */
export function endpointUrl(endpoint: EndpointSpec): string {
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  const path = endpoint.path ?? DEFAULT_PATH[endpoint.dialect];
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The built-in endpoint specs keyed by id: openai, groq, nvidia, and cerebras on
 * the openai dialect, and anthropic on the anthropic dialect.
 */
export const ENDPOINTS = {
  openai: {
    id: "openai",
    dialect: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: ["OPENAI_API_KEY"],
    defaultModel: "gpt-5-codex",
  },
  groq: {
    id: "groq",
    dialect: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: ["GROQ_API_KEY", "API_KEY_GROQ_GROQCLOUD"],
  },
  nvidia: {
    id: "nvidia",
    dialect: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: ["NVIDIA_API_KEY", "API_KEY_NVIDIA_NIM"],
  },
  cerebras: {
    id: "cerebras",
    dialect: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: ["CEREBRAS_API_KEY", "API_KEY_CEREBRAS_INFERENCE"],
  },
  anthropic: {
    id: "anthropic",
    dialect: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    defaultModel: "claude-haiku-4-5-20251001",
  },
} as const satisfies Record<string, EndpointSpec>;

// ── inference request / result ──────────────────────────────────────────────────
/**
 * A complete request for one inference: the target endpoint and model, the
 * conversation, and optional system prompt, temperature, max tokens, tool
 * definitions, and extra request body fields.
 */
export const InferenceRequestSchema = { "$id": "organizing/agents/llm/algebra/inference-request", "title": "LlmInferenceRequest", "additionalProperties": false, type: "object", required: ["endpoint", "model", "messages"], properties: { "endpoint": EndpointSpecSchema, "model": { type: "string", "minLength": 1 }, "messages": { type: "array", items: ChatMessageSchema }, "system": { type: "string" }, "temperature": { type: "number" }, "maxTokens": { type: "number" }, "tools": { type: "array", items: ToolDefinitionSchema }, "extraBody": { type: "object", additionalProperties: {} } } } as const;

export type InferenceRequest = Readonly<Omit<FromSchema<typeof InferenceRequestSchema>, "messages" | "tools" | "extraBody"> & {
  readonly messages: Conversation;
  readonly tools?: readonly ToolDefinition[];
  readonly extraBody?: Readonly<Record<string, JsonValue>>;
}>;

export const inferenceRequestCarrier = carrierFrom(InferenceRequestSchema);

/**
 * The result of one inference: the endpoint id and model, the generated text,
 * any tool calls, token usage, the decoded wire response kept for provenance,
 * and the prompt size in bytes.
 */
export const InferenceResultSchema = { "$id": "organizing/agents/llm/algebra/inference-result", "title": "LlmInferenceResult", "additionalProperties": false, type: "object", required: ["endpoint", "model", "text", "raw", "promptBytes"], properties: { "endpoint": { type: "string", "minLength": 1 }, "model": { type: "string", "minLength": 1 }, "text": { type: "string" }, "toolCalls": { type: "array", items: ToolCallSchema }, "usage": TokenUsageSchema, "raw": {}, "promptBytes": { type: "number", "minimum": 0 } } } as const;

export type InferenceResult = Readonly<Omit<FromSchema<typeof InferenceResultSchema>, "toolCalls" | "usage"> & {
  readonly toolCalls?: readonly ToolCall[];
  readonly usage?: TokenUsage;
}>;

export const inferenceResultCarrier = carrierFrom(InferenceResultSchema);

export const canonicalizeEndpointSpecAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-endpoint",
  description: "Canonicalize an LLM endpoint specification carrier.",
  domain: endpointSpecCarrier,
  codomain: endpointSpecCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeInferenceRequestAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-inference-request",
  description: "Canonicalize an LLM inference request carrier.",
  domain: inferenceRequestCarrier,
  codomain: inferenceRequestCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeInferenceResultAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-inference-result",
  description: "Canonicalize an LLM inference result carrier.",
  domain: inferenceResultCarrier,
  codomain: inferenceResultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const actions = Object.freeze([
  canonicalizeEndpointSpecAction,
  canonicalizeInferenceRequestAction,
  canonicalizeInferenceResultAction,
]);
