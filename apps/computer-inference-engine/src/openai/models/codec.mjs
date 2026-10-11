/**
 * integrations/openai/codec/models — the literal `/models` and `/models/{id}`
 * wire codec: admits and emits the exact JSON a real OpenAI-compatible host
 * sends for model listings, mirroring
 * `integrations/openai/codec/chat-completions`'s wire-fidelity role.
 *
 * @packageDocumentation
 */
import { parse } from "@red-cup-engineering/json-services-section";
import {
  openaiModelWireContract,
  openaiModelsListResponseContract,

} from "./schema.mjs";

export {
  openaiModelWireContract,
  openaiModelsListResponseContract,
} from "./schema.mjs";

/** Admit one `/models/{id}` model listing. */
export function openaiModelWire(input) {
  return openaiModelWireContract.assert(input, "OpenAI model");
}

/** Admit a full `/models` list response body. */
export function openaiModelsListResponse(input) {
  return openaiModelsListResponseContract.assert(input, "OpenAI models list response");
}

/** Parse and admit one model listing from wire JSON text. */
export function modelWireOfWireJson(text) {
  return openaiModelWire(parse(text));
}

/** Parse and admit a `/models` list response from wire JSON text. */
export function modelsListResponseOfWireJson(text) {
  return openaiModelsListResponse(parse(text));
}
