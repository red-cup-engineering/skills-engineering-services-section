import assert from "node:assert/strict";
import test from "node:test";
import { boundedGroqRequest, MAXIMUM_OUTPUT_TOKENS } from "../src/request-budget.mjs";

const packet = Object.freeze({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: "bounded" }], params: { temperature: 0 }, provider: "foreign" });

test("the provider always sends its advertised completion ceiling to Groq", () => {
  assert.deepEqual(boundedGroqRequest(packet), { model: packet.model, messages: packet.messages, temperature: 0, max_tokens: MAXIMUM_OUTPUT_TOKENS });
});

test("a customer may narrow but never widen the provider's advertised ceiling", () => {
  assert.equal(boundedGroqRequest({ ...packet, "max-tokens": 128 }).max_tokens, 128);
  assert.equal(boundedGroqRequest({ ...packet, "max-tokens": MAXIMUM_OUTPUT_TOKENS + 1 }).max_tokens, MAXIMUM_OUTPUT_TOKENS);
  assert.equal(boundedGroqRequest({ ...packet, "max-tokens": "900" }).max_tokens, MAXIMUM_OUTPUT_TOKENS);
});
