import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";
import { recordInferencePurchase, readInferencePurchases } from "../../src/dispatch/inference-purchase.mjs";

test("Koios purchases and historical harness purchases remain one inference accounting stream", (t) => {
  const root = mkdtempSync(join(tmpdir(), "inference-purchases-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const price = { denomination: { kind: "fiat", asset: "usd", unit: "micro-usd" }, amount: { numerator: "0", denominator: "1" } };
  const old = {
    type: "bare-cedar-fog.harness/inference-purchased", version: 1,
    actor: "actor:bZH6KBOlPVWbYpqp04izN_Xtwykn0XgsMBStm_FkPPw", turn: "old-turn",
    provider: "old-provider", model: "old-model", outcome: "completion",
    latencySeconds: 1, exchangeId: "old-exchange", price,
  };
  createSemanticRecordJournal({ root, objectKind: "bare-cedar-fog.harness-lifecycle-event.v1" }).record({
    category: "inference-purchased", record: old, recordedAt: "2026-09-01T00:00:00Z",
    told: { for: true, against: false }, relation: { subject: old.actor, predicate: "inference-purchased", object: old.provider },
  });
  recordInferencePurchase({ root, actor: "urn:ame:koios-news-service-section", turnId: "news-pulse",
    provider: "new-provider", model: "new-model", outcome: "completion", latencySeconds: 2,
    exchangeId: "new-exchange", price, recordedAt: "2026-09-02T00:00:00Z" });
  const rows = readInferencePurchases({ root });
  assert.deepEqual(rows.map(({ record }) => [record.actor, record.exchangeId]), [
    [old.actor, "old-exchange"], ["urn:ame:koios-news-service-section", "new-exchange"],
  ]);
});
