/**
 * Pure literal JSON codec for Anthropic Messages. Ported from MetroPlat's
 * `src/integrations/anthropic/messages/codec.mts`.
 */
import { isJsonRecord, parse } from "@red-cup-engineering/json-services-section";
import { anthropicMessageRequestContract, anthropicMessageResponseContract } from "./messages-schema.mjs";

export * from "./messages-schema.mjs";

export function anthropicMessageRequest(input) {
  return anthropicMessageRequestContract.assert(input, "Anthropic Messages request");
}
export function anthropicMessageResponse(input) {
  return anthropicMessageResponseContract.assert(input, "Anthropic Messages response");
}
export function anthropicMessageStreamEvent(input) {
  if (!isJsonRecord(input) || typeof input.type !== "string" || input.type.length === 0) {
    throw new TypeError("Anthropic Messages stream event requires a non-empty type");
  }
  return Object.freeze({ ...input });
}
export function anthropicMessageRequestToWireJson(input) { return JSON.stringify(anthropicMessageRequest(input)); }
export function anthropicMessageRequestOfWireJson(text) { return anthropicMessageRequest(parse(text)); }
export function anthropicMessageResponseOfWireJson(text) { return anthropicMessageResponse(parse(text)); }
