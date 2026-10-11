import assert from "node:assert/strict";
import test from "node:test";
import { main, parseArguments } from "../../scripts/dispatch/record-codex-inference-outcome.mjs";

const argv = [
  "--input", "/tmp/disposition.json",
  "--output", "/tmp/observation.json",
  "--pricing-root", "http://127.0.0.1:8800",
];

test("requires an exact disposition carrier and pricing observer", () => {
  assert.deepEqual(parseArguments(argv), {
    input: "/tmp/disposition.json",
    output: "/tmp/observation.json",
    pricingRoot: "http://127.0.0.1:8800",
  });
  assert.throws(() => parseArguments(["--input", "/tmp/disposition.json"]), /--pricing-root is required/u);
});

test("records only the supplied receiver disposition and preserves output custody", async () => {
  const disposition = { workLot: "urn:lot:fixture", outcome: "refused" };
  const observation = { outcome: "receiver-outcome-recorded", observation: { id: "urn:observation:fixture" } };
  let written;
  const result = await main(argv, {
    read: async () => JSON.stringify(disposition),
    record: async (observed, options) => {
      assert.deepEqual(observed, disposition);
      assert.deepEqual(options, { pricingRoot: "http://127.0.0.1:8800" });
      return observation;
    },
    write: async (...args) => { written = args; },
  });
  assert.deepEqual(result, observation);
  assert.equal(written[0], "/tmp/observation.json");
  assert.deepEqual(written[2], { flag: "wx", mode: 0o600 });
  assert.deepEqual(JSON.parse(written[1]), observation);
});
