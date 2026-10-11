import assert from "node:assert/strict";
import test from "node:test";
import {textSet} from "../../src/dispatch/work-placement/work-values.mjs";
import {admitTypedWorkDemand, decideWorkPlacement, decideAttentionWorkPlacement} from "../../src/dispatch/decide-work-placement.mjs";
const q = (n) => ({ numerator: String(n), denominator: "1" });
const budget = (amount = 2) => ({ amount, unit: "review-slot", evidence: "urn:capacity:review-window" });
function demand(id) {
  return {
    type: "TypedWorkDemand", id, taskClass: "reconcile", principal: "urn:actor:receiver",
    requiredCapabilities: ["reconcile"], requiredQualityTiers: [], requiredEffects: ["read-only"],
    requiredExecutionClasses: ["local"], idempotence: "idempotent",
    context: { identity: "urn:context:" + id, authorityScope: "urn:scope:review",
      freshnessIdentity: "urn:revision:current", dataConstraints: [], custodyConstraints: [] },
    outputContract: { identity: "urn:contract:reconciliation" },
    routePolicy: { preferenceOrder: [["consideration-per-acceptance"], ["resources"], ["acceptance-probability"]],
      considerationPreference: [], considerationCeilings: [], resourceCeilings: [], reuse: "forbid" },
  };
}
function offer(id = "urn:offer:a", asset = "urn:credit:review") {
  return {
    type: "NormalizedWorkOffer", id, provider: "urn:provider:" + id, executionClass: "local",
    operation: "reconcile", implementationIdentity: "urn:implementation:" + id,
    capabilities: ["reconcile"], qualityTiers: [], authorityScopes: ["urn:scope:review"],
    effects: ["read-only"], idempotence: ["idempotent"], dataConstraints: [], custodyConstraints: [],
    outputContractIdentities: ["urn:contract:reconciliation"], availability: "available",
    availableCapacity: 1, consideration: [{ kind: "credit", asset, unit: "credit", amount: q(1) }],
    declaredResources: [], semantics: { reuse: "none" },
  };
}
function candidate(id, cost = 1, benefit = 1) {
  return {
    demand: demand(id), offers: [offer()], observations: [],
    attention: {
      cost: { amount: cost, unit: "review-slot", evidence: "urn:cost-reading:" + id },
      held: { atoms: Array.from({ length: benefit }, (_, i) => id + ":obstruction:" + i),
        evidence: "urn:held-reading:" + id },
    },
  };
}
const read = (candidates, amount = 2, extra = {}) => decideAttentionWorkPlacement({ budget: budget(amount), candidates, ...extra });
const attempt = (offerId, outcome, receipt = "urn:receipt:" + offerId) => ({
  type: "WorkPlacementObservation", kind: "attempt", receipt, offerId, taskClass: "reconcile",
  outcome, resources: [],
});


test("text sets reject every unfilled array position", () => {
  for (const value of [Array(1), ["named", , "later"], [undefined], [null], [" "]]) {
    assert.throws(() => textSet(value, "test"), /array of nonempty text/);
  }
});
test("text sets retain valid ordering, identity and duplicate refusal", () => {
  for (const value of [[], ["a"], [" b ", "a"]]) assert.equal(textSet(value, "test"), value);
  assert.throws(() => textSet(["a", "a"], "test"), /duplicates/);
});
for (const field of ["requiredCapabilities", "requiredQualityTiers", "requiredEffects", "requiredExecutionClasses"]) {
  test("typed demand rejects sparse " + field, () => {
    const d=demand("bad");d[field]=Array(1);
    assert.throws(() => admitTypedWorkDemand(d), /array of nonempty text/);
  });
}
test("undefined cannot make a demand and offer appear capability compatible", () => {
  const d=demand("bad"), o=offer();d.requiredCapabilities=Array(1);o.capabilities=Array(1);
  assert.throws(() => decideWorkPlacement({demand:d,offers:[o]}), /array of nonempty text/);
});
for (const field of ["capabilities", "qualityTiers", "authorityScopes", "effects", "idempotence", "dataConstraints", "custodyConstraints", "outputContractIdentities"]) {
  test("placement refuses sparse offer " + field, () => {
    const o=offer();o[field]=Array(1);
    const out=decideWorkPlacement({demand:demand("good"),offers:[o]});
    assert.equal(out.disposition,"refused");
    assert.deepEqual(out.refusals,[{offerId:o.id,reasons:["invalid-offer:offer."+field+" must be an array of nonempty text"]}]);
  });
}

// The indexed contents, not an overridable iterator, define text-set admission.
const disguisedTextSets = [
  ["undefined", () => [undefined], /array of nonempty text/],
  ["null", () => [null], /array of nonempty text/],
  ["empty text", () => [""], /array of nonempty text/],
  ["hole", () => Array(1), /array of nonempty text/],
  ["duplicate", () => ["reconcile", "reconcile"], /duplicates/],
];
function disguise(value) {
  return Object.defineProperty(value, Symbol.iterator, {
    value: function* () {
      yield "reconcile";
      if (value.length === 2) yield "other";
    },
  });
}
for (const [name, make, error] of disguisedTextSets) {
  test("text sets reject indexed " + name + " hidden by an iterator", () => {
    assert.throws(() => textSet(disguise(make()), "test"), error);
  });
  test("placement rejects demand " + name + " hidden by an iterator", () => {
    const d = demand("bad");
    d.requiredCapabilities = disguise(make());
    assert.throws(() => admitTypedWorkDemand(d), error);
    assert.throws(() => decideWorkPlacement({ demand: d, offers: [offer()] }), error);
  });
  test("placement refuses offer " + name + " hidden by an iterator", () => {
    const invalid = offer("urn:offer:invalid");
    invalid.capabilities = disguise(make());
    const refused = decideWorkPlacement({ demand: demand("good"), offers: [invalid] });
    assert.equal(refused.disposition, "refused");
    assert.equal(refused.refusals.length, 1);
    assert.equal(refused.refusals[0].offerId, invalid.id);
    assert.match(refused.refusals[0].reasons[0], /^invalid-offer:offer\.capabilities /);
    assert.match(refused.refusals[0].reasons[0], error);
    const mixed = decideWorkPlacement({ demand: demand("good"), offers: [invalid, offer()] });
    assert.equal(mixed.disposition, "selected");
    assert.deepEqual(mixed.refusals, refused.refusals);
  });
  test("attention rejects held " + name + " hidden by an iterator", () => {
    const c = candidate("bad");
    c.attention.held.atoms = disguise(make());
    assert.throws(() => read([c]), error);
  });
}
test("text sets retain frozen array identity and validation error precedence", () => {
  for (const value of [[], ["a"], [" b ", "a"]]) {
    Object.freeze(value);
    assert.equal(textSet(value, "test"), value);
  }
  const values = disguise(["a", "a", undefined]);
  assert.throws(() => textSet(values, "test"), /array of nonempty text/);
});

for (const [name, indexed, yielded] of [
  ["empty iterator", ["unsupported"], []],
  ["duplicate iterator", ["unsupported", "reconcile"], ["reconcile", "reconcile"]],
]) {
  function value() {
    return Object.defineProperty(indexed.slice(), Symbol.iterator, {
      value: function* () { yield* yielded; },
    });
  }
  test("text sets preserve original refusal for " + name, () => {
    assert.throws(() => textSet(value(), "test"), /duplicates/);
  });
  test("placement preserves original demand refusal for " + name, () => {
    const d = demand("bad");
    d.requiredCapabilities = value();
    assert.throws(() => admitTypedWorkDemand(d), /duplicates/);
    assert.throws(() => decideWorkPlacement({ demand: d, offers: [offer()] }), /duplicates/);
  });
  test("placement preserves original offer refusal for " + name, () => {
    const o = offer();
    o.capabilities = value();
    const result = decideWorkPlacement({ demand: demand("good"), offers: [o] });
    assert.equal(result.disposition, "refused");
    assert.deepEqual(result.refusals, [{ offerId: o.id,
      reasons: ["invalid-offer:offer.capabilities must not contain duplicates"] }]);
  });
}
