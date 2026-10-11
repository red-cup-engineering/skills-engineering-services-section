import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cachedProviderCardProbe, providerCardLivenessCachePath, readProviderCardLiveness } from "../../src/dispatch/provider-card-liveness-cache.mjs";

function scratchRoot() {
  return mkdtempSync(join(tmpdir(), "provider-card-liveness-"));
}

test("a fresh probe failure is cached and re-thrown", async () => {
  const root = scratchRoot();
  try {
    await assert.rejects(
      () => cachedProviderCardProbe(root, "http://127.0.0.1:9/.well-known/agent-card.json", () => { throw new Error("connect refused"); }),
      /connect refused/,
    );
    const cache = readProviderCardLiveness(root);
    assert.equal(cache["http://127.0.0.1:9/.well-known/agent-card.json"].status, "offline");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cached offline entry within the TTL skips the real probe", async () => {
  const root = scratchRoot();
  try {
    let calls = 0;
    const probe = () => { calls += 1; throw new Error("still down"); };
    let now = 1_000_000;
    await assert.rejects(() => cachedProviderCardProbe(root, "http://127.0.0.1:9/card.json", probe, { now: () => now }));
    assert.equal(calls, 1);
    now += 60_000;
    await assert.rejects(
      () => cachedProviderCardProbe(root, "http://127.0.0.1:9/card.json", probe, { now: () => now }),
      (error) => error.code === "provider-card-cached-offline",
    );
    assert.equal(calls, 1, "the cached window must skip a second real probe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cached offline entry past the TTL re-probes", async () => {
  const root = scratchRoot();
  try {
    let calls = 0;
    const probe = () => { calls += 1; if (calls === 1) throw new Error("still down"); return "ok"; };
    let now = 1_000_000;
    await assert.rejects(() => cachedProviderCardProbe(root, "http://127.0.0.1:9/card.json", probe, { now: () => now, ttlMs: 300_000 }));
    now += 300_001;
    const result = await cachedProviderCardProbe(root, "http://127.0.0.1:9/card.json", probe, { now: () => now, ttlMs: 300_000 });
    assert.equal(result, "ok");
    assert.equal(calls, 2, "a probe past the TTL window must re-check liveness");
    const cache = readProviderCardLiveness(root);
    assert.equal(cache["http://127.0.0.1:9/card.json"], undefined, "a recovered card clears its offline entry");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the cache file lands under data/state exactly", () => {
  const root = "/example/root";
  assert.equal(providerCardLivenessCachePath(root), "/example/root/data/state/provider-card-liveness.json");
});
