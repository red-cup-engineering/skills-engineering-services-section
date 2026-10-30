import assert from "node:assert/strict";
import test from "node:test";
import { datesBetween, deriveAdmittedFrictions, frictionEntryOfDispatchItem } from "../scripts/derive-set-of-admitted-frictions.mjs";
import { FRICTION_KINDS, taskFromFrictionReport } from "../src/session-frictions.mjs";

test("datesBetween walks inclusive UTC dates and rejects a reversed range", () => {
  assert.deepEqual(datesBetween("2026-09-03", "2026-09-05"), ["2026-09-03", "2026-09-04", "2026-09-05"]);
  assert.deepEqual(datesBetween("2026-09-05", "2026-09-05"), ["2026-09-05"]);
  assert.throws(() => datesBetween("2026-09-05", "2026-09-03"), /until must not precede since/u);
  assert.throws(() => datesBetween("not-a-date", "2026-09-05"), /since is not a valid ISO date/u);
});

function dispatchItemOf(report, intent, state = "ready") {
  const task = taskFromFrictionReport(report);
  return { scope: task.cell, text: task.text, intent, state, status: state === "done" ? "discharged" : "open" };
}

test("frictionEntryOfDispatchItem reads kind, carrier, observed, and expected back off the task text the admitters wrote", () => {
  const item = dispatchItemOf({ kind: FRICTION_KINDS.missingCapability, carrier: "some/app.mjs", observed: "no delete-file-service exists", expected: "a published delete-file-service" }, "friction-report-2026-09-05-some-app-mjs-abcdef12");
  const entry = frictionEntryOfDispatchItem(item, "2026-09-05");
  assert.equal(entry.kind, "missing-capability");
  assert.equal(entry.carrier, "some/app.mjs");
  assert.equal(entry.observed, "no delete-file-service exists");
  assert.equal(entry.expected, "a published delete-file-service");
  assert.equal(entry.sessionDigest, "structured-work-intent-friction-report-2026-09-05-some-app-mjs-abcdef12");
  assert.equal(entry.state, "ready");
  assert.equal(entry.date, "2026-09-05");
  assert.match(entry.cell, /^task:friction-missing-capability-some-app-mjs-[0-9a-f]{8}$/u);

  const falsehood = frictionEntryOfDispatchItem(dispatchItemOf({ kind: FRICTION_KINDS.carrierFalsehood, carrier: "some/app.mjs", observed: "doc says X", expected: "disk says Y" }, "i2"), "2026-09-05");
  assert.equal(falsehood.kind, "carrier-falsehood");
  assert.equal(falsehood.observed, "doc says X");
  assert.equal(falsehood.expected, "disk says Y");
});

test("deriveAdmittedFrictions groups the rail's friction duties on the same carrier by kind, once per scope, across the dates asked", async () => {
  const reads = [];
  const byDate = {
    "2026-09-05": {
      queue: [
        dispatchItemOf({ kind: FRICTION_KINDS.missingCapability, carrier: "some/app.mjs", observed: "no delete-file-service exists", expected: "a published delete-file-service" }, "i1"),
        dispatchItemOf({ kind: FRICTION_KINDS.missingCapability, carrier: "some/app.mjs", observed: "no delete-file-service exists", expected: "a published delete-file-service" }, "i1"),
        dispatchItemOf({ kind: FRICTION_KINDS.carrierFalsehood, carrier: "some/app.mjs", observed: "doc says X", expected: "disk says Y" }, "i1"),
        { scope: "task:exact-deps-pkg-a", text: "not a friction", intent: "health", state: "ready", status: "open" },
      ],
    },
    "2026-09-06": {
      queue: [dispatchItemOf({ kind: FRICTION_KINDS.missingCapability, carrier: "other/app.mjs", observed: "no widget-service exists", expected: "a published widget-service" }, "i3", "done")],
    },
  };
  const readDispatch = async (input) => { reads.push(input); return byDate[input.date] ?? { queue: [] }; };

  const readout = await deriveAdmittedFrictions({ since: "2026-09-05", until: "2026-09-06", readDispatch });
  assert.deepEqual(reads.map((r) => r.date), ["2026-09-05", "2026-09-06"]);
  assert.equal(readout.kind, "bare-cedar-fog-claude.admitted-frictions");
  assert.equal(readout.count, 3);
  assert.equal(readout.carriers.length, 2);

  const someApp = readout.carriers.find((carrier) => carrier.carrier === "some/app.mjs");
  assert.equal(someApp.count, 2);
  assert.equal(someApp.kinds.length, 2);
  const missing = someApp.kinds.find((k) => k.kind === "missing-capability");
  assert.equal(missing.count, 1);
  assert.equal(missing.entries[0].observed, "no delete-file-service exists");
  assert.equal(missing.entries[0].sessionDigest, "structured-work-intent-i1");

  const otherApp = readout.carriers.find((carrier) => carrier.carrier === "other/app.mjs");
  assert.equal(otherApp.count, 1);
  assert.equal(otherApp.kinds[0].entries[0].state, "done");
  assert.equal(otherApp.kinds[0].entries[0].date, "2026-09-06");
});
