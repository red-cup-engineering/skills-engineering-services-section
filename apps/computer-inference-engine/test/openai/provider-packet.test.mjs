import assert from "node:assert/strict";
import test from "node:test";
import { providerPacket as packetFor } from "../../src/openai/provider-runtime.mjs";
const providerPacket = (marks) => packetFor("nvidia-nim", marks);

test("the customer schema and output allocation reach NVIDIA's HTTP packet without a carrier-specific mode label", () => {
  const schema = {
    type: "object",
    required: ["action", "args", "reason"],
    properties: {
      action: { const: "edit" },
      args: { type: "object" },
      reason: { type: "string" },
    },
    additionalProperties: false,
  };
  const packet = providerPacket({
    instruction: "Return only the contracted JSON value.",
    input: JSON.stringify({
      context: {
        suppliedContext: JSON.stringify({
          messages: [
            { role: "system", content: "Operate one software process node." },
            { role: "user", content: "CURRENT ADMITTED WRITABLE WORKSPACE: exact source bytes" },
          ],
          purpose: "Produce one bounded action.",
        }),
      },
      executionBounds: { maximumOutputTokens: 2400 },
      outputContract: { format: "json", schema },
    }),
    model: "meta/llama-3.1-8b-instruct",
  });
  assert.equal(packet["max-tokens"], 2400);
  assert.deepEqual(packet.params, { guided_json: schema });
  assert.deepEqual(packet.messages.map(({ role }) => role), ["system", "user"]);
  assert.match(packet.messages[0].content, /Operate one software process node/u);
  assert.equal(packet.messages[1].content, "CURRENT ADMITTED WRITABLE WORKSPACE: exact source bytes");
  assert.doesNotMatch(packet.messages[1].content, /suppliedContext|extendedRoutingRationale|customerAcceptanceRequired/u);
});

test("the consuming work lot may allocate more than the former local 4096-token ceiling", () => {
  const packet = providerPacket({
    instruction: "Return JSON.",
    input: JSON.stringify({
      executionBounds: { maximumOutputTokens: 6001 },
      outputContract: { format: "json", schema: { type: "object" } },
    }),
    model: "meta/llama-3.1-8b-instruct",
  });
  assert.equal(packet["max-tokens"], 6001);
});

test("a host-projected source carrier reaches NVIDIA without probabilistic JSON serialization", () => {
  const packet = providerPacket({
    instruction: "Conclude with one fenced source block.",
    input: JSON.stringify({
      executionBounds: { maximumOutputTokens: 1800 },
      outputContract: {
        format: "projected",
        projection: { type: "single-file-create", path: "src/new.mjs" },
        schema: { type: "object" },
      },
    }),
    model: "meta/llama-3.1-8b-instruct",
  });
  assert.equal(packet["max-tokens"], 1800);
  assert.equal(packet.params, undefined);
});

test("the provider refuses to advertise schema guidance it cannot construct", () => {
  assert.throws(() => providerPacket({
    instruction: "Return JSON.",
    input: JSON.stringify({ executionBounds: { maximumOutputTokens: 2400 } }),
    model: "meta/llama-3.1-8b-instruct",
  }), /requires one customer output schema/u);
});
