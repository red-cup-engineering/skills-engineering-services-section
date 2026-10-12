import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordInferencePurchase, readInferencePurchases } from "../../src/dispatch/inference-purchase.mjs";

test("Koios purchases are read back oldest first, and re-recording an exchange adds nothing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "inference-purchases-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const price = { denomination: { kind: "fiat", asset: "usd", unit: "micro-usd" }, amount: { numerator: "0", denominator: "1" } };
  const actor = "urn:ame:koios-news-service-section";
  const newer = recordInferencePurchase({ root, actor, turnId: "news-pulse",
    provider: "new-provider", model: "new-model", outcome: "completion", latencySeconds: 2,
    exchangeId: "new-exchange", price, recordedAt: "2026-09-02T00:00:00Z" });
  recordInferencePurchase({ root, actor, turnId: "old-turn",
    provider: "old-provider", model: "old-model", outcome: "completion", latencySeconds: 1,
    exchangeId: "old-exchange", price, recordedAt: "2026-09-01T00:00:00Z" });
  assert.equal(newer.appended, true);
  assert.equal(recordInferencePurchase({ root, actor, turnId: "news-pulse",
    provider: "new-provider", model: "new-model", outcome: "completion", latencySeconds: 2,
    exchangeId: "new-exchange", price, recordedAt: "2026-09-02T00:00:00Z" }).appended, false);
  const rows = readInferencePurchases({ root });
  assert.deepEqual(rows.map(({ record, recordedAt }) => [record.actor, record.exchangeId, recordedAt]), [
    [actor, "old-exchange", "2026-09-01T00:00:00Z"], [actor, "new-exchange", "2026-09-02T00:00:00Z"],
  ]);
});
