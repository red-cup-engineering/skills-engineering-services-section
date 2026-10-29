/**
 * endpoints — resolve and project ANY OpenAI-compatible inference endpoint.
 *
 * Where @emsenn/computing-with-openai-codex pins the single `openai` endpoint,
 * this package is endpoint-agnostic: it works against any host that speaks the
 * OpenAI chat-completions dialect — the built-in clouds (openai, nvidia, groq,
 * cerebras) or a caller-supplied EndpointSpec. An endpoint is named two ways:
 *
 *   - by id, resolved against the @emsenn/organizing-with-llm-agents/algebra
 *     ENDPOINTS registry (whose api-key env vars already include the in-environment
 *     NVIDIA_API_KEY / GROQ_API_KEY / CEREBRAS_API_KEY names); or
 *   - by value, as a full EndpointSpec passed through verbatim.
 *
 * Pure except `availableEndpoints`, which reads key presence via holography
 * (presence, never value). No key value ever enters a returned shape.
 */
import {
  ENDPOINTS,
  EndpointSpecSchema,
  type EndpointSpec,
} from "@emsenn/organizing-with-llm-agents/algebra";
import {
  EndpointProjectionSchema,
  endpointProjection,
  type EndpointProjection,
  type HolographyOptions,
} from "@emsenn/organizing-with-llm-agents/holography";

import { action, carrierFrom, tm } from "@emsenn/relating";

export type { EndpointSpec, EndpointProjection, HolographyOptions };

/** Either a built-in endpoint id ("openai" | "nvidia" | …) or a full spec. */
export type EndpointRef = string | EndpointSpec;

export const EndpointRefSchema = { "$id": "organizing/agents/openai/endpoints/ref", "title": "OpenaiEndpointRef", anyOf: [{ type: "string", "minLength": 1 }, EndpointSpecSchema] } as const;

export const endpointRefCarrier = carrierFrom(EndpointRefSchema);

export const OpenaiEndpointSelectionSchema = { "$id": "organizing/agents/openai/endpoints/selection", "title": "OpenaiEndpointSelection", "additionalProperties": false, type: "object", required: ["endpoint"], properties: { "endpoint": EndpointProjectionSchema } } as const;

export const openaiEndpointSelectionCarrier = carrierFrom(OpenaiEndpointSelectionSchema);

export const canonicalizeEndpointRefAction = action({
  verb: "organizing.agents.openai.endpoints.canonicalize-ref",
  description: "Canonicalize an OpenAI-dialect endpoint reference carrier.",
  domain: endpointRefCarrier,
  codomain: endpointRefCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeOpenaiEndpointSelectionAction = action({
  verb: "organizing.agents.openai.endpoints.canonicalize-selection",
  description: "Canonicalize an OpenAI-dialect endpoint selection carrier.",
  domain: openaiEndpointSelectionCarrier,
  codomain: openaiEndpointSelectionCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const endpointActions = Object.freeze([
  canonicalizeEndpointRefAction,
  canonicalizeOpenaiEndpointSelectionAction,
]);

/** The built-in endpoint ids that speak the OpenAI dialect. */
export const OPENAI_DIALECT_ENDPOINT_IDS = Object.freeze(
  Object.values(ENDPOINTS)
    .filter((spec) => spec.dialect === "openai")
    .map((spec) => spec.id),
) as readonly string[];

/** The built-in OpenAI-dialect endpoint specs, keyed by id. */
export const OPENAI_DIALECT_ENDPOINTS: Readonly<Record<string, EndpointSpec>> = Object.freeze(
  Object.fromEntries(
    Object.values(ENDPOINTS)
      .filter((spec) => spec.dialect === "openai")
      .map((spec) => [spec.id, spec]),
  ),
);

/** True when a spec speaks the OpenAI chat-completions dialect. */
export function isOpenaiDialect(spec: EndpointSpec): boolean {
  return spec.dialect === "openai";
}

/**
 * A small, free-tier-friendly default model per built-in endpoint, used when an
 * endpoint carries no defaultModel of its own (the NVIDIA / Groq clouds don't).
 * Override per call; this only keeps the zero-config path working.
 */
export const DEFAULT_MODELS: Readonly<Record<string, string>> = Object.freeze({
  nvidia: "meta/llama-3.1-8b-instruct",
  groq: "llama-3.1-8b-instant",
  cerebras: "llama3.1-8b",
  openai: "gpt-5-codex",
});

/** The default model for an endpoint ref: its own defaultModel, else the built-in
 *  fallback for its id, else the empty string (caller must then pass a model). */
export function defaultModelFor(ref: EndpointRef): string {
  const spec = resolveEndpoint(ref);
  return spec.defaultModel ?? DEFAULT_MODELS[spec.id] ?? "";
}

/**
 * Resolve an endpoint reference to a concrete spec. A spec is returned verbatim;
 * an id is looked up in the built-in registry. Throws when an id is unknown.
 */
export function resolveEndpoint(ref: EndpointRef): EndpointSpec {
  if (typeof ref !== "string") return ref;
  const spec = (ENDPOINTS as Readonly<Record<string, EndpointSpec>>)[ref];
  if (spec === undefined) {
    throw new Error(
      `unknown endpoint "${ref}" — known ids: ${Object.keys(ENDPOINTS).join(", ")}, ` +
        `or pass a full EndpointSpec`,
    );
  }
  return spec;
}

/**
 * Project the capability readings of every built-in OpenAI-dialect endpoint:
 * its id, base url, default model, and whether its api key is present — the
 * redacted holography projection, never the key value. Use this to pick a
 * working endpoint at runtime.
 */
export function availableEndpoints(options: HolographyOptions = {}): readonly EndpointProjection[] {
  return Object.freeze(
    Object.values(OPENAI_DIALECT_ENDPOINTS).map((spec) => endpointProjection(spec, options)),
  );
}

/**
 * The first OpenAI-dialect endpoint whose api key is present, or null when none
 * is configured. Honors a preferred-id order; otherwise uses registry order.
 */
export function firstAvailableEndpoint(
  options: HolographyOptions & { readonly prefer?: readonly string[] } = {},
): EndpointProjection | null {
  const projections = availableEndpoints(options);
  const present = projections.filter((p) => p.apiKey.present);
  if (present.length === 0) return null;
  for (const id of options.prefer ?? []) {
    const hit = present.find((p) => p.endpoint === id);
    if (hit !== undefined) return hit;
  }
  return present[0] ?? null;
}
