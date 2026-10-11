import assert from "node:assert/strict";
import test from "node:test";

import { creditsRow } from "@red-cup-engineering/google-flow-services-section/google-flow-client";
import { flowCreditReport, loadFlowAllowanceConfig } from "@red-cup-engineering/google-flow-services-section/flow-credits";

test("Flow's credits answer gives the balance and the monthly renewal", () => {
  const row = creditsRow([1050, 1, 2, 2, null, 1050, [1791478285, 667000000]]);
  assert.equal(row.balance, 1050);
  assert.equal(row.renewsAt, "2026-10-08T16:51:25.667Z");
});

test("a balance is split daily-first and paced to spend the month by renewal", () => {
  const report = flowCreditReport({
    config: loadFlowAllowanceConfig(),
    readings: [{ at: "2026-10-03T01:27:40Z", balance: 1050, renewsAt: "2026-10-08T16:51:25.667Z" }],
    now: "2026-10-03T01:30:00Z",
  });
  assert.deepEqual(report.meters.map(({ remaining }) => [remaining.lo, remaining.hi]), [[50, 50], [1000, 1000]]);
  assert.deepEqual(report.slack.map(({ meter, lapsesAt }) => [meter, lapsesAt]), [["daily", "2026-10-03T07:00:00.000Z"], ["monthly", "2026-10-08T16:51:25.667Z"]]);
  assert.equal(report.counts.veo_3_1_t2v_fast.lo, 52);
  assert.equal(report.pace.creditsPerDay.lo, 217);
});

test("credit readings are kept in the one log; a JSONL left by an earlier release is admitted once and left unchanged", async () => {
  const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { appendCreditReading, readCreditJournal, creditJournalRoot } = await import("@red-cup-engineering/google-flow-services-section/flow-credits");
  const dir = mkdtempSync(join(tmpdir(), "flow-credits-"));
  try {
    const path = join(dir, "credit-readings.jsonl");
    const earlier = { at: "2026-10-03T01:27:40Z", balance: 1050, renewsAt: "2026-10-08T16:51:25.667Z" };
    const legacy = `${JSON.stringify(earlier)}\n`;
    writeFileSync(path, legacy);
    const next = { at: "2026-10-04T01:27:40Z", balance: 990, renewsAt: "2026-10-08T16:51:25.667Z" };
    appendCreditReading(next, path);
    assert.deepEqual(readCreditJournal(path), [earlier, next]);
    assert.equal(readFileSync(path, "utf8"), legacy);
    assert.ok(existsSync(join(creditJournalRoot(path), "jsonl-admission.json")));
    assert.deepEqual(readCreditJournal(path), [earlier, next]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
