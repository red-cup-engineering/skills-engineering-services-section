/**
 * integrations/openai/codec/responses — the literal `/responses` wire codec:
 * OpenAI's current primary inference surface, admitted and emitted
 * byte-for-byte. Sibling of `integrations/openai/codec/chat-completions`, same
 * wire-fidelity role, distinct wire shape: flat tool descriptors, an
 * `output[]` array of typed items instead of `choices[].message`, and
 * `input_tokens`/`output_tokens` instead of `prompt_tokens`/`completion_tokens`.
 *
 * Streaming is deliberately not modeled here: NVIDIA NIM and other
 * OpenAI-compatible hosts this package's client actually targets speak
 * `/chat/completions`, not `/responses`; add it the same way
 * chat-completions does (reusing codecs/text/http/sse) if a live `/responses`
 * host is ever wired.
 *
 * @packageDocumentation
 */
import { isJsonRecord, parse } from "@red-cup-engineering/json-services-section";
import {
  openaiResponseFunctionToolContract,
  openaiResponseRequestWireContract,
  openaiResponseWireContract,

} from "./schema.mjs";

export {
  openaiResponseFunctionCallOutputContract,
  openaiResponseFunctionCallOutputItemContract,
  openaiResponseFunctionToolContract,
  openaiResponseInputMessageContract,
  openaiResponseInputTextPartContract,
  openaiResponseMessageOutputContract,
  openaiResponseRequestWireContract,
  openaiResponseTextFormatContract,
  openaiResponseUsageContract,
  openaiResponseWireContract,
} from "./schema.mjs";

export { openaiResponseTokenUsage } from "./token-usage.mjs";

/** Admit a full `/responses` request body. */
export function openaiResponseRequest(input) {
  return openaiResponseRequestWireContract.assert(input, "OpenAI responses request");
}

/** Admit one flat `/responses` function-tool descriptor. */
export function openaiResponseFunctionTool(input) {
  return openaiResponseFunctionToolContract.assert(input, "OpenAI responses function tool");
}

/** Admit a full non-streaming `/responses` response body. */
export function openaiResponse(input) {
  return openaiResponseWireContract.assert(input, "OpenAI responses response");
}

export function openaiResponseStreamEvent(input) {
  if (!isJsonRecord(input) || typeof input.type !== "string" || input.type.length === 0) {
    throw new TypeError("OpenAI Responses stream event requires a non-empty type");
  }
  return Object.freeze({ ...input });
}

/** Serialize an admitted request to its wire JSON text. */
export function responseRequestToWireJson(request) {
  return JSON.stringify(openaiResponseRequestWireContract.assert(request, "OpenAI responses request"));
}

/** Parse and admit a request from wire JSON text. */
export function responseRequestOfWireJson(text) {
  return openaiResponseRequest(parse(text));
}

/** Parse and admit a response from wire JSON text. */
export function responseOfWireJson(text) {
  return openaiResponse(parse(text));
}

/** The function-call output items of a response, in order (the model's emitted tool calls for this turn). */
export function responseFunctionCalls(response) {
  return Object.freeze(response.output.filter((item) => item.type === "function_call"));
}

/** The concatenated output_text of a response's message items (empty string when the turn is tool-calls only). */
export function responseOutputText(response) {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}
