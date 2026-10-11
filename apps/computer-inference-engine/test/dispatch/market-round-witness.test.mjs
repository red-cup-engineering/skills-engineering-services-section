import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inferenceMarketRoundTrace, inferenceMarketWitness } from "../../src/dispatch/market-round-witness.mjs";
import { recordTypedInferenceProcurement } from "../../src/dispatch/typed-inference-procurement.mjs";
import { createInferenceMarketWitnessStore, createInferenceSettlementStore } from "../../src/dispatch/witness-journal-settlement-store.mjs";

const demand = `ni:///sha-256;${"A".repeat(43)}`;
const at = "2026-08-28T20:00:00.000Z";

test("market round witnesses form one deterministic append-only causal chain", () => {
  const trace = inferenceMarketRoundTrace({ workLot: "urn:lot:witness", round: 0, demand, recordedAt: at });
  const opened = trace.append("round-opened", { policy: "direct-one-provider-contract", providers: ["urn:ame:a"] });
  const solicited = trace.append("offer-solicited", { provider: "urn:ame:a", solicitation: "urn:solicitation:a" });
  const refused = trace.append("offer-refused", { provider: "urn:ame:a", solicitation: "urn:solicitation:a", reason: "solicitation-transport-obstructed" });
  const exhausted = trace.append("round-exhausted", { reason: "no-admissible-offer", witnesses: [opened.id, solicited.id, refused.id] });
  assert.equal(solicited.prior, opened.id);
  assert.equal(refused.prior, solicited.id);
  assert.equal(exhausted.prior, refused.id);
  assert.deepEqual(trace.read().map(({ ordinal }) => ordinal), [0, 1, 2, 3]);
  assert.equal(trace.read()[0].id, inferenceMarketWitness({ ...opened, id: undefined }).id);
});

test("provider transport obstruction cannot impersonate provider or receiver refusal", () => {
  const base = { workLot: "urn:lot:witness", round: 0, ordinal: 0, recordedAt: at, demand };
  const obstruction = inferenceMarketWitness({
    ...base,
    kind: "provider-transport-obstructed",
    evidence: { provider: "urn:ame:a", offer: "urn:offer:a", reason: "connection-reset" },
  });
  assert.equal(obstruction.kind, "provider-transport-obstructed");
  assert.equal(Object.hasOwn(obstruction.evidence, "outcome"), false);
  assert.throws(() => inferenceMarketWitness({
    ...base,
    kind: "provider-transport-obstructed",
    evidence: { provider: "urn:ame:a", offer: "urn:offer:a", reason: "connection-reset", receiverOutcome: "refused" },
  }), /cannot assert a receiver outcome/u);
});

test("capacity and receiver outcomes require evidence specific to their owners", () => {
  const base = { workLot: "urn:lot:witness", round: 0, ordinal: 0, recordedAt: at, demand };
  assert.throws(() => inferenceMarketWitness({
    ...base, kind: "provider-capacity-observed",
    evidence: { provider: "urn:ame:a", source: "inferred", capacity: 0, meaning: "concurrent lots" },
  }), /source must be declared or observed/u);
  assert.throws(() => inferenceMarketWitness({
    ...base, kind: "receiver-outcome-recorded",
    evidence: { receiver: "urn:ame:customer", deliveryReceipt: "urn:receipt:a", outcome: "maybe" },
  }), /accepted or refused/u);
});

test("a real journal persists the complete related witness chain before its v1 summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "inference-market-witness-"));
  const actor = "urn:ame:customer";
  const settlement = "eip155:31337:0x3333333333333333333333333333333333333333";
  try {
    const trace = inferenceMarketRoundTrace({ workLot: "urn:lot:persisted", round: 0, demand, recordedAt: at });
    const opened = trace.append("round-opened", { policy: "direct-one-provider-contract", providers: [] });
    trace.append("round-exhausted", { reason: "no-admissible-offer", witnesses: [opened.id] });
    const store = await createInferenceSettlementStore({ settlementRoot: root, actor, settlement, caip2: "eip155:31337" });
    const witnessStore = await createInferenceMarketWitnessStore({ settlementRoot: root, actor, settlement, caip2: "eip155:31337" });
    const projection = await recordTypedInferenceProcurement({
      type: "TypedSenInferenceProcurement", disposition: "no-admissible-provider-offer",
      demand: { type: "TypedSenInferenceDemand" }, marketRound: 0,
      marketWitnesses: trace.read(), providerSettlementAttempts: 0, frontierInferenceCalls: 0,
    }, {
      caller: { actor, account: settlement },
      customerServices: { sen: { actor: "urn:ame:sen" }, witnessJournal: { actor: "urn:ame:witness-journal", agentCard: "urn:agent-card:witness" } },
      settlementRoot: root, at, store, witnessStore,
    });
    assert.equal(projection.marketWitnesses.length, 2);
    assert.equal((await witnessStore.records("inference-market.witness.v2")).length, 2);
    assert.equal((await store.records("typed-inference.procurement")).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
