import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ACTOR, closeDemand, openDemand, position, recordCustomerOutcome, recordDemandCompletionCondition, recordDemandObstruction, recordLeaderAuthorityGrant, recordProviderResourceGrant, recordResource, recordResourceConsumption, recordSupplierConsideration, recordSupplierExchange, recordSupplierOffer, revokeLeaderAuthorityGrant } from "../src/enterprise.mjs";

const at = "2026-07-26T21:00:00.000Z";
const fixture = () => ({ stateRoot: mkdtempSync(join(tmpdir(), "codex-enterprise-")) });
test("supplier pressure comes from receipts and customer-endpoint outcomes, never a hard ceiling", () => {
  const options = fixture();
  const exchange = recordSupplierExchange({ provider: "urn:ame:supplier", capability: "urn:capability:test", receipt: "ni:///sha-256;supplier", protocol: "A2A", observedAt: at, quotedConsideration: { denomination: "HBD", amount: { numerator: "1", denominator: "10" }, source: "signed offer" } }, options).record;
  recordCustomerOutcome({ issuer: "urn:leader:emsenn", exchange: exchange.receipt, disposition: "accepted", evidence: "urn:evidence:leader-acceptance", observedAt: at }, options);
  const current = position(options);
  assert.equal(current.supplierPressure[0].accepted, 1);
  assert.deepEqual(current.supplierPressure[0].quoted.HBD, { numerator: "1", denominator: "10" });
  assert.deepEqual(current.supplierPressure[0].incurred, {});
  assert.deepEqual(current.supplierPressure[0].observedCostPerAcceptedOutcome, {});
  assert.equal(current.artificialExecutionLimits, false);
  assert.equal(current.profitLoss, "unknown");
});
test("only separately witnessed incurred consideration enters accepted-outcome cost", () => {
  const options = fixture();
  const exchange = recordSupplierExchange({ provider: "urn:ame:supplier", capability: "urn:capability:test", receipt: "ni:///sha-256;supplier", protocol: "A2A", observedAt: at }, options).record;
  recordSupplierConsideration({ issuer: "urn:ame:supplier", exchange: exchange.receipt, phase: "quoted", consideration: { denomination: "HBD", amount: { numerator: "1", denominator: "10" }, source: "offer" }, evidence: "urn:evidence:offer", observedAt: at }, options);
  recordSupplierConsideration({ issuer: "urn:ame:settlement-observer", exchange: exchange.receipt, phase: "incurred", consideration: { denomination: "HBD", amount: { numerator: "1", denominator: "20" }, source: "settlement receipt" }, evidence: "urn:evidence:settlement", observedAt: at }, options);
  recordCustomerOutcome({ issuer: "urn:leader:emsenn", exchange: exchange.receipt, disposition: "accepted", evidence: "urn:evidence:accepted", observedAt: at }, options);
  assert.deepEqual(position(options).supplierPressure[0].observedCostPerAcceptedOutcome.HBD, { numerator: "1", denominator: "20" });
});
test("demand closure requires its named active Leader authority and observed completion conditions", () => {
  const options = fixture();
  const authority = recordLeaderAuthorityGrant({ issuer: "urn:leader:emsenn", scope: ["repair"], revocable: true, evidence: "urn:evidence:leader-request", observedAt: at }, options).record;
  const demand = openDemand({ desiredOutcome: "one completed result", authorityGrant: authority.id, completionConditions: ["public result", "tests pass"], source: "Leader approval", observedAt: at }, options).record;
  const offer = recordSupplierOffer({ demand: demand.id, provider: "urn:ame:supplier", capability: "urn:capability:test", offer: "urn:offer:1", protocol: "A2A", observedAt: at }, options).record;
  const exchange = recordSupplierExchange({ demand: demand.id, offer: offer.id, provider: "urn:ame:supplier", capability: "urn:capability:test", receipt: "urn:receipt:1", protocol: "A2A", observedAt: at }, options).record;
  assert.equal(position(options).openDemands[0].state, "in-exchange");
  assert.throws(() => closeDemand({ demand: demand.id, issuer: "urn:leader:emsenn", disposition: "fulfilled", evidence: "urn:evidence:no", observedAt: at }, options), /every named completion condition/u);
  recordDemandCompletionCondition({ demand: demand.id, condition: "public result", issuer: ACTOR, evidence: "urn:evidence:result", observedAt: at }, options);
  recordDemandCompletionCondition({ demand: demand.id, condition: "tests pass", issuer: ACTOR, evidence: "urn:evidence:test", observedAt: at }, options);
  assert.equal(position(options).openDemands[0].state, "completion-observed-awaiting-closure");
  closeDemand({ demand: demand.id, issuer: "urn:leader:emsenn", disposition: "fulfilled", evidence: "urn:evidence:yes", observedAt: at }, options);
  assert.equal(position(options).openDemands.length, 0);
  assert.equal(position(options).demands[0].state, "fulfilled");
});
test("a witnessed missing capability makes the present demand obstruction explicit", () => {
  const options = fixture();
  const authority = recordLeaderAuthorityGrant({ issuer: "urn:leader:emsenn", scope: ["purchase"], revocable: true, evidence: "urn:evidence:leader-request", observedAt: at }, options).record;
  const demand = openDemand({ desiredOutcome: "one purchased result", authorityGrant: authority.id, completionConditions: ["supplier result"], source: "Leader approval", observedAt: at }, options).record;
  recordDemandObstruction({ demand: demand.id, issuer: ACTOR, missingCapability: "urn:capability:codex-provider-solicitation", reason: "no Codex-owned solicitation operation is callable", evidence: "urn:evidence:operation-catalog", observedAt: at }, options);
  assert.equal(position(options).openDemands[0].state, "obstructed");
  assert.equal(position(options).openDemands[0].obstructions[0].missingCapability, "urn:capability:codex-provider-solicitation");
});
test("authority is qualitative and revocable; resource grants preserve exact and unknown native quantities", () => {
  const options = fixture();
  const authority = recordLeaderAuthorityGrant({ issuer: "urn:leader:emsenn", scope: ["repair"], revocable: true, evidence: "urn:evidence:request", observedAt: at }, options).record;
  assert.equal(Object.hasOwn(authority, "amount"), false);
  const exactGrant = recordProviderResourceGrant({ provider: "openai", surface: "codex", credentialReference: "env:OPENAI_API_KEY", resource: "inference", quantityKind: "tokens", quantity: { kind: "exact", amount: { numerator: "100", denominator: "1" }, unit: "tokens" }, scope: ["inference"], revocable: true, evidence: "urn:evidence:provider", observedAt: at }, options).record;
  const unknownGrant = recordProviderResourceGrant({ provider: "openai", surface: "codex", credentialReference: "env:OPENAI_API_KEY", resource: "inference", quantityKind: "rate-limit-pressure", quantity: { kind: "unknown", unit: "provider-rate-limit", reason: "provider does not expose a quota" }, scope: ["inference"], revocable: true, evidence: "urn:evidence:provider", observedAt: at }, options).record;
  assert.equal(unknownGrant.quantity.kind, "unknown");
  const use = recordResourceConsumption({ grant: exactGrant.id, operation: "urn:operation:repair", quantityKind: "tokens", amount: { numerator: "7", denominator: "1" }, unit: "tokens", source: "provider-native-receipt", observedAt: at }, options).record;
  assert.equal(use.amount.numerator, "7");
  revokeLeaderAuthorityGrant({ grant: authority.id, issuer: "urn:leader:emsenn", evidence: "urn:evidence:revoked", observedAt: at }, options);
  assert.throws(() => openDemand({ desiredOutcome: "later work", authorityGrant: authority.id, completionConditions: ["done"], source: "Leader", observedAt: at }, options), /revoked/u);
});
test("Codex cannot possess the customer's acceptance authority", () => {
  const options = fixture();
  assert.throws(() => recordCustomerOutcome({ issuer: ACTOR, exchange: "x", disposition: "accepted", evidence: "e", observedAt: at }, options), /named customer endpoint/u);
});
test("tokens and subscription money remain separate observations", () => {
  const options = fixture();
  recordResource({ provider: "openai", surface: "codex-pro", quantityKind: "tokens", amount: { numerator: "10", denominator: "1" }, unit: "tokens", source: "provider-native-receipt", observedAt: at }, options);
  recordResource({ provider: "openai", surface: "codex-pro", quantityKind: "money", amount: { numerator: "200", denominator: "1" }, unit: "USD-per-month", source: "Leader subscription statement", observedAt: at }, options);
  const current = position(options);
  assert.equal(current.profitLoss, "unknown");
  assert.deepEqual(current.profitLossMissing, ["independently-observed-customer-revenue"]);
});
