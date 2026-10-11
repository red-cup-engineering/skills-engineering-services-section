import assert from "node:assert/strict";
import test from "node:test";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { workInferenceCoordinate } from "../../src/dispatch/work-inference-coordinate.mjs";
import { appendDelivery, loadDeliveries, loadObservations } from "../../src/dispatch/expected-resolution-pricing.mjs";
import { executionConfigurationIdentity } from "../../src/dispatch/sen-carrier.mjs";
import { METROPLAT_INFERENCE_MARKET_CUSTOMER, officeWorkInferenceTaskClass } from "../../src/dispatch/inference-work-lot-source.mjs";

// Every file under ROOT with its bytes: the pricing book is a journal (the one log, 8cf10144), so the
// lookup writing nothing is shown on the whole data root, whatever the journal's own layout. A read
// may extend the journal's derived read indexes (`index/`), which hold no record.
const filesUnder = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).map(String).sort()
  .filter((file) => lstatSync(path.join(root, file)).isFile()).map((file) => [file, readFileSync(path.join(root, file), "base64")]));
const recordsUnder = (root) => Object.fromEntries(Object.entries(filesUnder(root)).filter(([file]) => !file.split(path.sep).includes("index")));
const BOOK = "pricing-book.journal";

// Synthetic delivery/proposal inputs to the genuine lookup and pricing APIs.
// These tests do not claim office authority, native receiving or customer acceptance.
const WORK_PROVIDER = "urn:synthetic:host-work-provider";
const WORK = "coordinate-fixture";

function fixture(run, { configured = true, registered = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "work-inference-coordinate-"));
  try {
    const configuration = { provider: "urn:synthetic:inference-provider", model: "synthetic-model" };
    const reference = {
      workLot: "urn:synthetic:work-lot",
      provider: configuration.provider,
      taskClass: officeWorkInferenceTaskClass(WORK),
      selectedOffer: "urn:synthetic:offer",
      receipt: "urn:synthetic:inference-receipt",
      receiver: METROPLAT_INFERENCE_MARKET_CUSTOMER,
      ...(configured ? { configurationIdentity: executionConfigurationIdentity(configuration) } : {}),
    };
    if (registered) appendDelivery({ ...reference, ...(configured ? { configuration } : {}) }, { dataRoot: root });
    const proposal = {
      work: WORK, producer: { id: WORK_PROVIDER }, execution: "urn:synthetic:original-execution",
      providerEvidence: ["urn:synthetic:original-execution", reference.receipt],
      result: { kind: "skill-result", value: { inferenceDelivery: reference } },
    };
    return run({ root, reference, proposal, lookup: (changes = {}) => workInferenceCoordinate({
      proposal, pricingRoot: root, workProvider: WORK_PROVIDER, ...changes,
    }) });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("exact registered custody returns a frozen market coordinate without writing acceptance", () => fixture(({ root, reference, lookup }) => {
  const before = recordsUnder(root);
  const expected = { provider: reference.provider, offer: reference.selectedOffer, taskClass: reference.taskClass,
    receipt: reference.receipt, configuration: reference.configurationIdentity };
  const coordinate = lookup();
  assert.deepEqual(coordinate, expected);
  assert.equal(Object.isFrozen(coordinate), true);
  assert.deepEqual(lookup(), coordinate);
  assert.deepEqual(recordsUnder(root), before);
  assert.equal(loadDeliveries({ dataRoot: root }).length, 1);
  assert.deepEqual(loadObservations({ dataRoot: root }), []);
}));

test("an exact unconfigured delivery preserves omission of configuration", () => fixture(({ reference, lookup }) => {
  assert.deepEqual(lookup(), { provider: reference.provider, offer: reference.selectedOffer,
    taskClass: reference.taskClass, receipt: reference.receipt });
  assert.equal(Object.hasOwn(lookup(), "configuration"), false);
}, { configured: false }));

test("provider, result and original evidence gates refuse unrelated coordinates", () => fixture(({ proposal, lookup }) => {
  for (const changes of [{ pricingRoot: undefined }, { workProvider: undefined }, { workProvider: "urn:synthetic:other-worker" },
    { proposal: undefined }, { proposal: { ...proposal, result: { kind: "skill-error", error: "synthetic failure" } } },
    { proposal: { ...proposal, result: { kind: "skill-result", value: {} } } },
    { proposal: { ...proposal, providerEvidence: [] } },
    { proposal: { ...proposal, providerEvidence: [proposal.execution] } },
    { proposal: { ...proposal, providerEvidence: [proposal.result.value.inferenceDelivery.receipt] } }]) {
    assert.equal(lookup(changes), undefined);
  }
}));

test("each registered delivery coordinate must match exactly", () => fixture(({ proposal, reference, lookup }) => {
  for (const field of ["workLot", "provider", "taskClass", "selectedOffer", "receipt", "receiver", "configurationIdentity"]) {
    const altered = { ...reference, [field]: `urn:synthetic:wrong-${field}` };
    const changed = { ...proposal, providerEvidence: [proposal.execution, altered.receipt],
      result: { kind: "skill-result", value: { inferenceDelivery: altered } } };
    assert.equal(lookup({ proposal: changed }), undefined, field);
  }
  const absentConfiguration = { ...reference };
  delete absentConfiguration.configurationIdentity;
  assert.equal(lookup({ proposal: { ...proposal,
    result: { kind: "skill-result", value: { inferenceDelivery: absentConfiguration } } } }), undefined);
  assert.equal(lookup({ proposal: { ...proposal, work: "another-canonical-work" } }), undefined);
}));

test("missing delivery storage supplies no coordinate", () => fixture(({ root, lookup }) => {
  assert.equal(lookup(), undefined);
  assert.deepEqual(loadDeliveries({ dataRoot: root }), []);
  assert.deepEqual(loadObservations({ dataRoot: root }), []);
}, { registered: false }));

test("malformed or unreadable delivery storage throws for the host's optional-lookup boundary", () => fixture(({ root, lookup }) => {
  // Corrupt what the book reads: every file of its journal.
  const journal = Object.keys(filesUnder(path.join(root, BOOK))).filter((file) => !file.startsWith(".lock"));
  assert.notEqual(journal.length, 0);
  for (const file of journal) writeFileSync(path.join(root, BOOK, file), "{not valid JSON}\n");
  assert.throws(() => lookup());
  // A journal root that is not a directory is unreadable storage.
  rmSync(path.join(root, BOOK), { recursive: true });
  writeFileSync(path.join(root, BOOK), "not a journal\n");
  assert.throws(() => lookup());
  // This characterizes the helper only. The host's continued native recording after this failure is
  // feltos-enterprise-host agency-work.mjs's optional-lookup catch.
}));
