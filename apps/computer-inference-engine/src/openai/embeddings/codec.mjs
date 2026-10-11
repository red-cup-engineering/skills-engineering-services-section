/**
 * integrations/openai/codec/embeddings — the literal `/embeddings` wire codec:
 * admits and emits the exact JSON a real OpenAI-compatible host sends and
 * receives for embedding requests, mirroring
 * `integrations/openai/codec/chat-completions`'s wire-fidelity role.
 *
 * @packageDocumentation
 */
import { parse } from "@red-cup-engineering/json-services-section";
import {
  openaiEmbeddingContract,
  openaiEmbeddingsRequestContract,
  openaiEmbeddingsResponseContract,

} from "./schema.mjs";

export {
  openaiEmbeddingContract,
  openaiEmbeddingsRequestContract,
  openaiEmbeddingsResponseContract,
} from "./schema.mjs";

/** Admit a full `/embeddings` request body. */
export function openaiEmbeddingsRequest(input) {
  return openaiEmbeddingsRequestContract.assert(input, "OpenAI embeddings request");
}

/** Admit one embedding result. */
export function openaiEmbedding(input) {
  return openaiEmbeddingContract.assert(input, "OpenAI embedding");
}

/** Admit a full `/embeddings` response body. */
export function openaiEmbeddingsResponse(input) {
  return openaiEmbeddingsResponseContract.assert(input, "OpenAI embeddings response");
}

/** Serialize an admitted request to its wire JSON text. */
export function embeddingsRequestToWireJson(request) {
  return JSON.stringify(openaiEmbeddingsRequestContract.assert(request, "OpenAI embeddings request"));
}

/** Parse and admit a request from wire JSON text. */
export function embeddingsRequestOfWireJson(text) {
  return openaiEmbeddingsRequest(parse(text));
}

/** Parse and admit a response from wire JSON text. */
export function embeddingsResponseOfWireJson(text) {
  return openaiEmbeddingsResponse(parse(text));
}
