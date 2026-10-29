import assert from "node:assert/strict";
import test from "node:test";

import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorClient,
} from "@red-cup-engineering/x402-services-section/cdp-facilitator";

test("tollbooth resolves the shared CDP facilitator public contract", () => {
  assert.equal(CDP_FACILITATOR_URL, "https://api.cdp.coinbase.com/platform/v2/x402");
  assert.equal(typeof createCdpFacilitatorClient, "function");
});
