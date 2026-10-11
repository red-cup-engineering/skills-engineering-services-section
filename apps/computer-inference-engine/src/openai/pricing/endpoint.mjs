/**
 * economy/endpoint — pure data describing an OpenAI-compatible inference
 * endpoint. No IO, no environment read, no network: a services/ client
 * resolves the base URL and key live and constructs the value this module
 * shapes.
 */

import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";

/** The de-facto default path an OpenAI-compatible chat endpoint answers on. */
export const DEFAULT_CHAT_COMPLETIONS_PATH = "/chat/completions";

export const endpointSpecSchema = {
  $id: "metroplat/contracts/economy/endpoint-spec",
  type: "object",
  required: ["id", "baseUrl"],
  properties: {
    id: { type: "string", minLength: 1 },
    baseUrl: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
    defaultModel: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
  title: "EndpointSpec",
  description: "An OpenAI-compatible inference endpoint: a base URL and, optionally, a non-default request path and a fallback model name.",
};

export const endpointSpecContract = schemaFrom(endpointSpecSchema);

/** An OpenAI-compatible inference endpoint: a base URL and, optionally, a
 *  non-default request path and a fallback model name. */

/** The pure request target for an endpoint: base URL joined with its (default-falling-back) path. */
export function endpointUrl(endpoint) {
  const admitted = endpointSpecContract.assert(endpoint, "OpenAI endpoint");
  const base = admitted.baseUrl.replace(/\/+$/, "");
  const path = admitted.path ?? DEFAULT_CHAT_COMPLETIONS_PATH;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
