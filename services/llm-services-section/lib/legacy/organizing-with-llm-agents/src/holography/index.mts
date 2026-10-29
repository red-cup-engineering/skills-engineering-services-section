// @emsenn/organizing-with-llm-agents/holography — the inference host projected as charge readings.
//
// Sibling of posix-holography (filesystem) and javascript-holography (JS platform).
// Where those project host facilities as MemeCharge readings, this projects an
// inference endpoint: whether its API key is present, and whether a live call
// settles. Charges come from @emsenn/relating (NOT the deprecated memetics
// stack). This is the only llm-* package that reads the environment or the network.
//
// Redaction law — presence, never value: a resolved key may carry its secret only
// for the duration of a call; every projection, charge, and returned carrier holds
// only { present, redacted: true }. The raw value never enters a persisted shape.

import { action, carrierFrom, bottom, mark, tm, witnessedPotential, type ChargeCarrier } from "@emsenn/relating";

import {
  InferenceResultSchema,
  type EndpointSpec,
  type InferenceRequest,
  type InferenceResult,
  endpointUrl,
} from "../algebra/index.mjs";
import * as openai from "../codecs/openai/index.mjs";
import * as anthropic from "../codecs/anthropic/index.mjs";

/**
 * A read-only environment map: variable names to their string values or
 * undefined, as seen by key resolution.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Injectable host facilities for projection: a fetch implementation, an
 * environment map, and a fixed now timestamp - each defaulting to the live host
 * when omitted.
 */
export type HolographyOptions = Readonly<{
  fetch?: typeof fetch;
  env?: EnvLike;
  now?: string;
}>;

export const HolographyOptionsSchema = { "$id": "organizing/agents/llm/holography/options", "title": "LlmHolographyOptions", "additionalProperties": false, type: "object", properties: { "fetch": {}, "env": { type: "object", additionalProperties: { type: "string" } }, "now": { type: "string", "minLength": 1 } } } as const;

export const holographyOptionsCarrier = carrierFrom(HolographyOptionsSchema);

// ── API keys: resolution, redaction, charge ───────────────────────────────────
/**
 * A resolved API key carrying its secret value: the endpoint it serves, the env
 * var it came from, the raw value, and when it was resolved. Held only for the
 * duration of a call, never persisted.
 */
export type ApiKeyBearer = Readonly<{
  forEndpoint: string;
  envVarName: string;
  value: string;
  resolvedAt: string;
}>;

/**
 * A redacted projection of an API key: the endpoint, env var name, resolution
 * time, and whether a key was present - never the value, with redacted always
 * true.
 */
export type ApiKeyProjection = Readonly<{
  forEndpoint: string;
  envVarName: string;
  resolvedAt: string;
  present: boolean;
  redacted: true;
}>;

const ApiKeyProjectionShape = { "forEndpoint": { type: "string", "minLength": 1 }, "envVarName": { type: "string" }, "resolvedAt": { type: "string", "minLength": 1 }, "present": { type: "boolean" }, "redacted": { const: true } } as const;

const ApiKeyProjectionInlineSchema = { "additionalProperties": false, type: "object", required: ["forEndpoint", "envVarName", "resolvedAt", "present", "redacted"], properties: { "forEndpoint": { type: "string", "minLength": 1 }, "envVarName": { type: "string" }, "resolvedAt": { type: "string", "minLength": 1 }, "present": { type: "boolean" }, "redacted": { const: true } } } as const;

export const ApiKeyProjectionSchema = { "$id": "organizing/agents/llm/holography/api-key-projection", "title": "LlmApiKeyProjection", "additionalProperties": false, type: "object", required: ["forEndpoint", "envVarName", "resolvedAt", "present", "redacted"], properties: { "forEndpoint": { type: "string", "minLength": 1 }, "envVarName": { type: "string" }, "resolvedAt": { type: "string", "minLength": 1 }, "present": { type: "boolean" }, "redacted": { const: true } } } as const;

export const apiKeyProjectionCarrier = carrierFrom(ApiKeyProjectionSchema);

/** Resolve a key from the first environment variable that holds a non-empty value. Returns null when absent. */
export function resolveApiKey(endpoint: EndpointSpec, options: HolographyOptions = {}): ApiKeyBearer | null {
  const env = options.env ?? readProcessEnv();
  const resolvedAt = options.now ?? nowIso();
  for (const envVarName of endpoint.apiKeyEnv ?? []) {
    const value = env[envVarName];
    if (typeof value === "string" && value.length > 0) {
      return { forEndpoint: endpoint.id, envVarName, value, resolvedAt };
    }
  }
  return null;
}

/** Strip the secret, keeping only its presence. */
export function projectApiKey(key: ApiKeyBearer): ApiKeyProjection {
  return {
    forEndpoint: key.forEndpoint,
    envVarName: key.envVarName,
    resolvedAt: key.resolvedAt,
    present: true,
    redacted: true,
  };
}

/** An absent-key projection for an endpoint whose key could not be resolved. */
export function absentApiKey(endpoint: EndpointSpec, resolvedAt: string): ApiKeyProjection {
  return {
    forEndpoint: endpoint.id,
    envVarName: (endpoint.apiKeyEnv ?? [])[0] ?? "",
    resolvedAt,
    present: false,
    redacted: true,
  };
}

/** Charge reading of key presence: present → potential, absent → ⊥ (unknown/absurd). */
export function apiKeyCharge(key: ApiKeyBearer | null): ChargeCarrier {
  return key === null ? bottom : witnessedPotential(mark({ apiKey: key.forEndpoint, present: true }));
}

// ── endpoint projection ────────────────────────────────────────────────────────
/**
 * The capability readings of an endpoint without a live call: its id and point,
 * base url, optional default model, the redacted api key projection, and the
 * charge of that key's presence.
 */
export type EndpointProjection = Readonly<{
  endpoint: string;
  point: string;
  baseUrl: string;
  defaultModel?: string;
  apiKey: ApiKeyProjection;
  apiKeyCharge: ChargeCarrier;
}>;

export const EndpointProjectionSchema = { "$id": "organizing/agents/llm/holography/endpoint-projection", "title": "LlmEndpointProjection", "additionalProperties": false, type: "object", required: ["endpoint", "point", "baseUrl", "apiKey", "apiKeyCharge"], properties: { "endpoint": { type: "string", "minLength": 1 }, "point": { type: "string", "minLength": 1 }, "baseUrl": { type: "string", "minLength": 1 }, "defaultModel": { type: "string", "minLength": 1 }, "apiKey": ApiKeyProjectionInlineSchema, "apiKeyCharge": {} } } as const;

export const endpointProjectionCarrier = carrierFrom(EndpointProjectionSchema);

/**
 * The point identifier for an endpoint: the string "endpoint:" prefixed to the
 * endpoint's id.
 */
export function endpointPoint(endpoint: EndpointSpec): string {
  return `endpoint:${endpoint.id}`;
}

/** Project an endpoint's capability readings without making a call. */
export function endpointProjection(endpoint: EndpointSpec, options: HolographyOptions = {}): EndpointProjection {
  const resolvedAt = options.now ?? nowIso();
  const key = resolveApiKey(endpoint, { ...options, now: resolvedAt });
  return {
    endpoint: endpoint.id,
    point: endpointPoint(endpoint),
    baseUrl: endpoint.baseUrl,
    ...(endpoint.defaultModel === undefined ? {} : { defaultModel: endpoint.defaultModel }),
    apiKey: key === null ? absentApiKey(endpoint, resolvedAt) : projectApiKey(key),
    apiKeyCharge: apiKeyCharge(key),
  };
}

// ── witnessing a live inference call ────────────────────────────────────────────
/**
 * A successful inference witness: the decoded result, a potential charge for
 * the reachable reply, and the redacted api key projection. Discriminated by ok
 * being true.
 */
export type LlmReading = Readonly<{
  ok: true;
  result: InferenceResult;
  charge: ChargeCarrier;
  apiKey: ApiKeyProjection;
}>;

const LlmReadingShape = { "ok": { const: true }, "result": InferenceResultSchema, "charge": {}, "apiKey": ApiKeyProjectionInlineSchema } as const;

export const LlmReadingSchema = { "$id": "organizing/agents/llm/holography/reading", "title": "LlmInferenceReading", "additionalProperties": false, type: "object", required: ["ok", "result", "charge", "apiKey"], properties: { "ok": { const: true }, "result": InferenceResultSchema, "charge": {}, "apiKey": ApiKeyProjectionInlineSchema } } as const;

/**
 * A failed inference witness: the endpoint, a bottom charge, a condition of
 * "absent", "unreachable", or "rejected", a reason string, and the redacted api
 * key projection. Discriminated by ok being false.
 */
export type LlmFault = Readonly<{
  ok: false;
  endpoint: string;
  charge: ChargeCarrier;
  condition: "absent" | "unreachable" | "rejected";
  reason: string;
  apiKey: ApiKeyProjection;
}>;

export const LlmFaultConditionSchema = { anyOf: [{ const: "absent" }, { const: "unreachable" }, { const: "rejected" }] } as const;

const LlmFaultShape = { "ok": { const: false }, "endpoint": { type: "string", "minLength": 1 }, "charge": {}, "condition": LlmFaultConditionSchema, "reason": { type: "string" }, "apiKey": ApiKeyProjectionInlineSchema } as const;

export const LlmFaultSchema = { "$id": "organizing/agents/llm/holography/fault", "title": "LlmInferenceFault", "additionalProperties": false, type: "object", required: ["ok", "endpoint", "charge", "condition", "reason", "apiKey"], properties: { "ok": { const: false }, "endpoint": { type: "string", "minLength": 1 }, "charge": {}, "condition": LlmFaultConditionSchema, "reason": { type: "string" }, "apiKey": ApiKeyProjectionInlineSchema } } as const;

/**
 * The result of witnessing an inference call: either an LlmReading on success
 * or an LlmFault on failure.
 */
export type LlmOutcome = LlmReading | LlmFault;

export const LlmOutcomeSchema = { "$id": "organizing/agents/llm/holography/outcome", "title": "LlmInferenceOutcome", anyOf: [{ "additionalProperties": false, type: "object", required: ["ok", "result", "charge", "apiKey"], properties: { "ok": { const: true }, "result": InferenceResultSchema, "charge": {}, "apiKey": ApiKeyProjectionInlineSchema } }, { "additionalProperties": false, type: "object", required: ["ok", "endpoint", "charge", "condition", "reason", "apiKey"], properties: { "ok": { const: false }, "endpoint": { type: "string", "minLength": 1 }, "charge": {}, "condition": LlmFaultConditionSchema, "reason": { type: "string" }, "apiKey": ApiKeyProjectionInlineSchema } }] } as const;

export const llmReadingCarrier = carrierFrom(LlmReadingSchema);

export const llmFaultCarrier = carrierFrom(LlmFaultSchema);

export const llmOutcomeCarrier = carrierFrom(LlmOutcomeSchema);

export const canonicalizeHolographyOptionsAction = action({
  verb: "organizing.agents.llm.holography.canonicalize-options",
  description: "Canonicalize LLM holography options.",
  domain: holographyOptionsCarrier,
  codomain: holographyOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeApiKeyProjectionAction = action({
  verb: "organizing.agents.llm.holography.canonicalize-api-key-projection",
  description: "Canonicalize a redacted LLM API key projection.",
  domain: apiKeyProjectionCarrier,
  codomain: apiKeyProjectionCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeEndpointProjectionAction = action({
  verb: "organizing.agents.llm.holography.canonicalize-endpoint-projection",
  description: "Canonicalize an LLM endpoint projection.",
  domain: endpointProjectionCarrier,
  codomain: endpointProjectionCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeLlmReadingAction = action({
  verb: "organizing.agents.llm.holography.canonicalize-reading",
  description: "Canonicalize an LLM inference reading.",
  domain: llmReadingCarrier,
  codomain: llmReadingCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeLlmFaultAction = action({
  verb: "organizing.agents.llm.holography.canonicalize-fault",
  description: "Canonicalize an LLM inference fault.",
  domain: llmFaultCarrier,
  codomain: llmFaultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeLlmOutcomeAction = action({
  verb: "organizing.agents.llm.holography.canonicalize-outcome",
  description: "Canonicalize an LLM inference outcome carrier.",
  domain: llmOutcomeCarrier,
  codomain: llmOutcomeCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const actions = Object.freeze([
  canonicalizeHolographyOptionsAction,
  canonicalizeApiKeyProjectionAction,
  canonicalizeEndpointProjectionAction,
  canonicalizeLlmReadingAction,
  canonicalizeLlmFaultAction,
  canonicalizeLlmOutcomeAction,
]);

/**
 * Witness a live inference call as a charge reading. With no key, returns an
 * "absent" fault and makes no call. Otherwise it encodes the request with the
 * endpoint's dialect codec, performs the fetch, and decodes the reply. A reachable,
 * decoded reply reads as a potential charge; a transport or HTTP failure is a fault.
 */
export async function witnessInference(
  endpoint: EndpointSpec,
  request: InferenceRequest,
  options: HolographyOptions = {},
): Promise<LlmOutcome> {
  const resolvedAt = options.now ?? nowIso();
  const key = resolveApiKey(endpoint, { ...options, now: resolvedAt });
  if (key === null) {
    return {
      ok: false,
      endpoint: endpoint.id,
      charge: bottom,
      condition: "absent",
      reason: `no API key for ${endpoint.id} in ${(endpoint.apiKeyEnv ?? []).join(", ") || "(no env vars configured)"}`,
      apiKey: absentApiKey(endpoint, resolvedAt),
    };
  }
  const projection = projectApiKey(key);
  const model = request.model || endpoint.defaultModel;
  if (!model) {
    return rejected(endpoint, projection, "no model given and endpoint has no defaultModel");
  }

  const body = encodeBody(endpoint, { ...request, model });
  const promptBytes = byteLength(JSON.stringify(body));
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(endpointUrl(endpoint), {
      method: "POST",
      headers: authHeaders(endpoint, key.value),
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      endpoint: endpoint.id,
      charge: bottom,
      condition: "unreachable",
      reason: error instanceof Error ? error.message : String(error),
      apiKey: projection,
    };
  }

  const rawText = await response.text();
  const raw = parseJson(rawText);
  if (!response.ok) {
    return rejected(endpoint, projection, `HTTP ${response.status}: ${errorText(raw, rawText)}`);
  }

  const decoded = decodeBody(endpoint, raw);
  const result: InferenceResult = {
    endpoint: endpoint.id,
    model,
    text: decoded.text,
    ...(decoded.toolCalls === undefined ? {} : { toolCalls: decoded.toolCalls }),
    ...(decoded.usage === undefined ? {} : { usage: decoded.usage }),
    raw,
    promptBytes,
  };
  return {
    ok: true,
    result,
    charge: witnessedPotential(mark({ endpoint: endpoint.id, model })),
    apiKey: projection,
  };
}

// ── dialect dispatch ───────────────────────────────────────────────────────────
function encodeBody(endpoint: EndpointSpec, request: InferenceRequest): Record<string, unknown> {
  return endpoint.dialect === "anthropic"
    ? anthropic.encodeRequestBody(request) as Record<string, unknown>
    : openai.encodeRequestBody(request) as Record<string, unknown>;
}

type Decoded = { text: string; toolCalls?: InferenceResult["toolCalls"]; usage?: InferenceResult["usage"] };

function decodeBody(endpoint: EndpointSpec, raw: unknown): Decoded {
  return endpoint.dialect === "anthropic" ? anthropic.decodeResponse(raw) : openai.decodeResponse(raw);
}

function authHeaders(endpoint: EndpointSpec, key: string): Record<string, string> {
  const base = endpoint.dialect === "anthropic"
    ? { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${key}` };
  return { ...base, ...(endpoint.headers ?? {}) };
}

// ── helpers ────────────────────────────────────────────────────────────────────
function rejected(endpoint: EndpointSpec, apiKey: ApiKeyProjection, reason: string): LlmFault {
  return { ok: false, endpoint: endpoint.id, charge: bottom, condition: "rejected", reason, apiKey };
}

function readProcessEnv(): EnvLike {
  const proc = (globalThis as { process?: { env?: EnvLike } }).process;
  return proc?.env ?? {};
}

function nowIso(): string {
  return new Date().toISOString();
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(raw: unknown, fallback: string): string {
  if (!raw || typeof raw !== "object") return fallback.slice(0, 500);
  const record = raw as { readonly error?: { readonly message?: unknown }; readonly message?: unknown };
  const message = record.error?.message ?? record.message;
  return typeof message === "string" ? message : fallback.slice(0, 500);
}
