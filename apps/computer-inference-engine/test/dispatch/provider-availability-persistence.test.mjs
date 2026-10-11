import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const imports = `
import assert from "node:assert/strict";
import { loadDirectEndpointProviderDescriptors, dispatchDirectEndpointOffer, directEndpointAdmissionReasons } from ${JSON.stringify(new URL("../../src/dispatch/direct-endpoint-provider.mjs", import.meta.url).href)};
import { latestProviderAvailability } from ${JSON.stringify(new URL("../../src/dispatch/expected-resolution-pricing.mjs", import.meta.url).href)};
import { currentProviderAvailability } from ${JSON.stringify(new URL("../../src/dispatch/provider-availability.mjs", import.meta.url).href)};
const pricingRoot = process.argv[1];
const entry = { provider: "urn:provider:availability-fixture", endpoint: "http://127.0.0.1:11434/v1/chat/completions",
  model: "fixture-model", auth: { mode: "none" }, zeroCashPolicy: { local: true } };
const load = (extra = {}) => loadDirectEndpointProviderDescriptors(
  { DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ ...entry, ...extra }]) }, { pricingRoot })[0];
const demand = (fetchImpl) => ({ messages: [{ role: "user", content: "fixture" }],
  execution: { pricingRoot, fetchImpl } });
`;

function processRun(root, body) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", imports + body, root], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

function withJournal(body) {
  const root = mkdtempSync(join(tmpdir(), "provider-availability-"));
  try { body(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("credentialless transport obstruction survives process exit and blocks admission until backoff expires", () => withJournal((root) => {
  const first = processRun(root, `
    let requests = 0;
    await assert.rejects(dispatchDirectEndpointOffer(load(), demand(async () => {
      requests++; throw new Error("fixture transport unavailable");
    }), { invoke: async ({ fetchImpl, endpoint }) => fetchImpl(endpoint) }), /fixture transport unavailable/);
    const record = latestProviderAvailability(entry.provider, null, { dataRoot: pricingRoot });
    assert.equal(record.credentialSha256, null);
    assert.equal(Object.hasOwn(record, "status"), false);
    assert.equal(record.reason, "provider-transport-failed");
    console.log(JSON.stringify({ requests, observedAt: record.observedAt, backoffUntil: record.backoffUntil }));
  `);
  assert.equal(first.requests, 1);
  const fresh = processRun(root, `
    const descriptor = load();
    const reasons = directEndpointAdmissionReasons(descriptor, { zeroCashOnly: true });
    assert.equal(descriptor.availableCapacity, 0);
    assert.ok(reasons.includes("no-available-capacity"));
    const restored = currentProviderAvailability(entry.provider);
    assert.equal(restored.quota.remaining, null);
    const retryable = currentProviderAvailability(entry.provider, { now: () => Date.parse(restored.backoffUntil) + 1 });
    assert.equal(retryable.state, "alive");
    assert.equal(retryable.backoffUntil, null);
    assert.equal(retryable.quota.remaining, null);
    assert.equal(load().availableCapacity, 1);
    console.log(JSON.stringify({ reasons, restoredBackoffUntil: restored.backoffUntil, retryable: retryable.state }));
  `);
  assert.equal(fresh.restoredBackoffUntil, first.backoffUntil);
}));

test("HTTP quota and hiring evidence survive process exit without crossing credential bindings", () => withJournal((root) => {
  processRun(root, `
    const descriptor = load({ apiKey: "fixture-original-key" });
    const response = new Response("fixture", { status: 200, headers: { "x-ratelimit-remaining-requests": "2" } });
    const result = await dispatchDirectEndpointOffer(descriptor, demand(async () => response), {
      invoke: async ({ fetchImpl, endpoint }) => {
        await fetchImpl(endpoint);
        return { type: "ReceiverOwnedToolAgentCompletion", text: "fixture completion" };
      },
    });
    assert.equal(result.disposition, "delivered");
    console.log(JSON.stringify({ delivered: true }));
  `);
  processRun(root, `
    const descriptor = load({ apiKey: "fixture-original-key" });
    const restored = descriptor.providerReading;
    assert.equal(restored.status, 200);
    assert.equal(restored.quota.remaining, 2);
    assert.ok(restored.lastHiredAt);
    const rotated = load({ apiKey: "fixture-replacement-key" });
    assert.equal(rotated.providerReading, undefined);
    assert.equal(load().providerReading, undefined);
    console.log(JSON.stringify({ remaining: restored.quota.remaining, lastHiredAt: restored.lastHiredAt }));
  `);
}));

