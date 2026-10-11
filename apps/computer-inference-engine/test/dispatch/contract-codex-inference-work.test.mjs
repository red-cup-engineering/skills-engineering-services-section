import assert from "node:assert/strict";
import test from "node:test";
import { main, parseArguments } from "../../scripts/dispatch/contract-codex-inference-work.mjs";

const pricing = ["--pricing-root", "http://127.0.0.1:8800"];

test("requires one exact input carrier and pricing observer and accepts an optional create-only output", () => {
  assert.deepEqual(parseArguments(["--input", "/tmp/request.json", ...pricing]), {
    input: "/tmp/request.json", output: null, pricingRoot: "http://127.0.0.1:8800",
  });
  assert.deepEqual(parseArguments(["--input", "/tmp/request.json", "--output", "/tmp/result.json", ...pricing]), {
    input: "/tmp/request.json", output: "/tmp/result.json", pricingRoot: "http://127.0.0.1:8800",
  });
  assert.throws(() => parseArguments([]), /--input is required/u);
  assert.throws(() => parseArguments(["--input", "/tmp/request.json"]), /--pricing-root is required/u);
  assert.throws(() => parseArguments(["--unknown", "value"]), /unknown/u);
});

test("returns an unaccepted candidate and preserves create-only output custody", async () => {
  const request = { objective: "fixture", context: "bounded fixture" };
  const candidate = {
    outcome: "candidate-pending-codex-acceptance",
    candidate: { recommendation: 1 },
    integrationAccepted: false,
  };
  let written;
  const result = await main(["--input", "/tmp/request.json", "--output", "/tmp/result.json", ...pricing], {
    read: async () => JSON.stringify(request),
    contract: async (observed, options) => {
      assert.deepEqual(observed, request);
      assert.deepEqual(options, { pricingRoot: "http://127.0.0.1:8800" });
      return candidate;
    },
    write: async (...args) => { written = args; },
  });
  assert.deepEqual(result, { isError: false, payload: candidate });
  assert.equal(written[0], "/tmp/result.json");
  assert.deepEqual(written[2], { flag: "wx", mode: 0o600 });
  assert.deepEqual(JSON.parse(written[1]), candidate);
});
