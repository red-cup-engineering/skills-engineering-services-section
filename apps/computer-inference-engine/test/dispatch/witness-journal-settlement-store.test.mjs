import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLocalSettlementAccount } from "../../src/dispatch/witness-journal-settlement-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("resolves public settlement attribution without a private keystore", () => {
  assert.deepEqual(resolveLocalSettlementAccount(root, {
    actor: "urn:ame:inference-work-lot-service",
    caip2: "eip155:5615610",
  }), {
    actor: "urn:ame:inference-work-lot-service",
    settlement: "eip155:5615610:0x3ffa8ce2459902f2d07cd046359c69dff7841f23",
  });
});

test("an explicit account must remain on the requested chain", () => {
  assert.throws(() => resolveLocalSettlementAccount(root, {
    caip2: "eip155:5615610",
    settlement: "eip155:1:0x3ffa8ce2459902f2d07cd046359c69dff7841f23",
  }), /requested chain|selected chain|on the selected chain/u);
});
