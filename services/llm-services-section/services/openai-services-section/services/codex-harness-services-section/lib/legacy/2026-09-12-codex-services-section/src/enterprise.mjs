import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semantic-record-journal-service";
import { dataCustodyDirectory } from "@red-cup-engineering/data-custody-directory-service";
import { semanticFileKey, semanticIdentity } from "./semiotic-circuit.mjs";

const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const ACTOR = "urn:ame:bare-cedar-fog-codex";
export const CUSTOMER = "urn:leader:emsenn";
export const DEFAULT_STATE_ROOT = dataCustodyDirectory(SECTION_ROOT, "state");

export function identity(value) { return semanticIdentity(value).id; }
function exact(value) { return value?.id === identity(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"))); }
function nonempty(value, label) { if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`); return value; }
function rational(value, label) {
  if (!value || !/^-?[0-9]+$/u.test(value.numerator ?? "") || !/^[1-9][0-9]*$/u.test(value.denominator ?? "")) throw new TypeError(`${label} must be one canonical rational`);
  return { numerator: String(BigInt(value.numerator)), denominator: String(BigInt(value.denominator)) };
}
function consideration(value, label) {
  if (!value || typeof value !== "object") throw new TypeError(`${label} is required`);
  return { denomination: nonempty(value.denomination, `${label} denomination`), amount: rational(value.amount, `${label} amount`), source: nonempty(value.source ?? value.rateSource, `${label} source`) };
}
const RESOURCE_KINDS = new Set(['tokens', 'money', 'wall-time', 'rate-limit-pressure', 'provider-work']);
function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must contain at least one item`);
  return value.map((item, index) => nonempty(item, `${label}[${index}]`));
}
function stateRoot(options = {}) { return resolve(options.stateRoot ?? process.env.CODEX_ENTERPRISE_STATE_ROOT ?? DEFAULT_STATE_ROOT); }
function hookDeliveryClaimsRoot(options = {}) { return resolve(stateRoot(options), "hook-delivery-claims"); }
export function readTrajectory(options = {}) {
  const journal = createSemanticRecordJournal({ root: stateRoot(options), objectKind: "bare-cedar-fog-codex.material" });
  return journal.query({ category: "bare-cedar-fog-codex.trajectory" }).map(({ id, record }) => Object.freeze({ id, ...record }));
}
export function appendObservation(body, options = {}) {
  const journal = createSemanticRecordJournal({ root: stateRoot(options), objectKind: "bare-cedar-fog-codex.material" });
  const receipt = journal.record({
    category: "bare-cedar-fog-codex.trajectory",
    record: body,
    recordedAt: body.observedAt ?? new Date().toISOString(),
    charge: { support: false, refutation: false },
  });
  return Object.freeze({ record: Object.freeze({ id: receipt.id, ...body }), duplicate: receipt.appended === false });
}

/**
 * Claim one exact provider-native hook delivery before it causes lifecycle or
 * accounting effects. User- and project-level hook projections receive the
 * same native event, so their content-addressed delivery identities converge
 * on one atomic `wx` claim. No elapsed-time window participates, and callers
 * must give distinct native events distinct identities.
 */
export function claimHookDelivery(eventIdentity, options = {}) {
  const selected = nonempty(eventIdentity, "hook delivery identity");
  semanticFileKey(selected);
  const claimsRoot = hookDeliveryClaimsRoot(options);
  mkdirSync(claimsRoot, { recursive: true, mode: 0o700 });
  const path = join(claimsRoot, `${semanticFileKey(selected)}.json`);
  try {
    writeFileSync(path, `${JSON.stringify({ type: "CodexHookDeliveryClaim", eventIdentity: selected })}\n`, { flag: "wx", mode: 0o600 });
    return Object.freeze({ claimed: true, eventIdentity: selected });
  } catch (error) {
    if (error?.code === "EEXIST") return Object.freeze({ claimed: false, eventIdentity: selected });
    throw error;
  }
}
function requireObservation(options, predicate, message) { const row = readTrajectory(options).find(predicate); if (!row) throw new TypeError(message); return row; }
function leaderGrant(options, id, { active = false } = {}) {
  const grant = requireObservation(options, (row) => row.type === "LeaderAuthorityGrantObserved" && row.id === id, "known Leader authority grant is required");
  if (active && readTrajectory(options).some((row) => row.type === "LeaderAuthorityGrantRevoked" && row.grant === id)) throw new TypeError("Leader authority grant is revoked");
  return grant;
}
function compareFractions(left, right) { return BigInt(left.numerator) * BigInt(right.denominator) < BigInt(right.numerator) * BigInt(left.denominator) ? -1 : BigInt(left.numerator) * BigInt(right.denominator) > BigInt(right.numerator) * BigInt(left.denominator) ? 1 : 0; }
function addFractions(left, right) { const n = BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator); const d = BigInt(left.denominator) * BigInt(right.denominator); return { numerator: String(n), denominator: String(d) }; }
function supplierPositions(rows) {
  const exchanges = rows.filter((row) => row.type === "SupplierExchangeObserved");
  const considerationRows = rows.filter((row) => row.type === "SupplierConsiderationObserved");
  const outcomes = rows.filter((row) => row.type === "CustomerOutcomeObserved");
  const positions = new Map();
  for (const exchange of exchanges) {
    const key = `${exchange.capability}\u0000${exchange.provider}`;
    const current = positions.get(key) ?? { capability: exchange.capability, provider: exchange.provider, attempts: 0, accepted: 0, rejected: 0, quoted: {}, authorized: {}, incurred: {}, settled: {} };
    current.attempts += 1;
    // The pre-v0.2 `consideration` field was populated from advertised offers.
    // Preserve it as a quote; it is not evidence that a cost was incurred.
    const quote = exchange.quotedConsideration ?? exchange.consideration;
    if (quote) {
      const prior = current.quoted[quote.denomination] ?? { numerator: "0", denominator: "1" };
      current.quoted[quote.denomination] = addFractions(prior, quote.amount);
    }
    positions.set(key, current);
  }
  for (const observed of considerationRows) {
    const exchange = exchanges.find((item) => item.receipt === observed.exchange || item.id === observed.exchange); if (!exchange) continue;
    const current = positions.get(`${exchange.capability}\u0000${exchange.provider}`); if (!current) continue;
    const prior = current[observed.phase][observed.consideration.denomination] ?? { numerator: "0", denominator: "1" };
    current[observed.phase][observed.consideration.denomination] = addFractions(prior, observed.consideration.amount);
  }
  for (const outcome of outcomes) {
    const exchange = exchanges.find((item) => item.receipt === outcome.exchange || item.id === outcome.exchange); if (!exchange) continue;
    const current = positions.get(`${exchange.capability}\u0000${exchange.provider}`); if (!current) continue;
    if (outcome.disposition === "accepted") current.accepted += 1; else current.rejected += 1;
  }
  return [...positions.values()].map((item) => ({ ...item, acceptanceYield: item.attempts ? { numerator: String(item.accepted), denominator: String(item.attempts) } : null,
    observedCostPerAcceptedOutcome: item.accepted === 0 ? null : Object.fromEntries(Object.entries(item.incurred).map(([unit, amount]) => [unit, { numerator: amount.numerator, denominator: String(BigInt(amount.denominator) * BigInt(item.accepted)) }]))
  })).sort((left, right) => {
    const yieldOrder = compareFractions(right.acceptanceYield, left.acceptanceYield); if (yieldOrder) return yieldOrder;
    const shared = Object.keys(left.observedCostPerAcceptedOutcome ?? {}).find((unit) => right.observedCostPerAcceptedOutcome?.[unit]);
    return shared ? compareFractions(left.observedCostPerAcceptedOutcome[shared], right.observedCostPerAcceptedOutcome[shared]) : left.provider.localeCompare(right.provider);
  });
}
function demandPositions(rows) {
  const demands = rows.filter((row) => row.type === "CodexDemandOpened");
  const offers = rows.filter((row) => row.type === "SupplierOfferObserved");
  const exchanges = rows.filter((row) => row.type === "SupplierExchangeObserved");
  const outcomes = rows.filter((row) => row.type === "CustomerOutcomeObserved");
  const closures = rows.filter((row) => row.type === "CodexDemandClosed"), completions = rows.filter((row) => row.type === "DemandCompletionConditionObserved");
  const obstructions = rows.filter((row) => row.type === "CodexDemandObstructionObserved");
  return demands.map((demand) => {
    const demandOffers = offers.filter((row) => row.demand === demand.id);
    const demandExchanges = exchanges.filter((row) => row.demand === demand.id);
    const accepted = outcomes.filter((outcome) => outcome.disposition === "accepted" && demandExchanges.some((exchange) => exchange.receipt === outcome.exchange || exchange.id === outcome.exchange));
    const closure = closures.findLast((row) => row.demand === demand.id);
    const demandObstructions = obstructions.filter((row) => row.demand === demand.id);
    const completedConditions = completions.filter((row) => row.demand === demand.id).map((row) => row.condition);
    const completionPending = demand.completionConditions.some((condition) => !completedConditions.includes(condition));
    return { ...demand, state: closure?.disposition ?? (!completionPending ? "completion-observed-awaiting-closure" : demandExchanges.length ? "in-exchange" : demandOffers.length ? "offered" : demandObstructions.length ? "obstructed" : "open"), offers: demandOffers.map((row) => row.id), exchanges: demandExchanges.map((row) => row.receipt), acceptedOutcomes: accepted.map((row) => row.id), completedConditions, obstructions: demandObstructions, closure: closure?.id ?? null };
  });
}
export function position(options = {}) {
  const rows = readTrajectory(options), direct = rows.filter((row) => row.type === "DirectCodexExecutionObserved");
  const resource = rows.filter((row) => row.type === "CodexResourceObserved");
  const money = resource.filter((row) => row.quantityKind === "money"), revenue = rows.filter((row) => row.type === "CustomerRevenueObserved");
  const burden = new Map(); for (const item of direct) burden.set(item.toolClass, (burden.get(item.toolClass) ?? 0) + 1);
  const demands = demandPositions(rows);
  return Object.freeze({ type: "CodexEnterprisePosition", actor: ACTOR, customer: CUSTOMER, observations: rows.length,
    demands, openDemands: demands.filter((demand) => !["fulfilled", "withdrawn"].includes(demand.state)),
    supplierPressure: supplierPositions(rows),
    capabilityDemand: [...burden].sort((a, b) => b[1] - a[1]).map(([toolClass, observedActs]) => ({ toolClass, observedActs, disposition: "seek-reusable-supplier-or-extract-capability" })),
    profitLoss: money.length && revenue.length ? "requires-attribution-assay" : "unknown",
    profitLossMissing: [...(money.length ? [] : ["attributable-monetary-cost"]), ...(revenue.length ? [] : ["independently-observed-customer-revenue"])],
    artificialExecutionLimits: false });
}
export function recordSupplierExchange(input, options = {}) {
  nonempty(input.provider, "provider"); nonempty(input.capability, "capability"); nonempty(input.receipt, "provider receipt");
  if (input.demand) requireObservation(options, (row) => row.type === "CodexDemandOpened" && row.id === input.demand, "known Codex demand is required");
  if (input.offer) requireObservation(options, (row) => row.type === "SupplierOfferObserved" && row.id === input.offer && (!input.demand || row.demand === input.demand), "known offer for the demand is required");
  const body = { type: "SupplierExchangeObserved", actor: ACTOR, provider: input.provider, capability: input.capability, receipt: input.receipt,
    protocol: nonempty(input.protocol, "protocol"), observedAt: nonempty(input.observedAt, "observedAt"),
    ...(input.demand ? { demand: nonempty(input.demand, "demand") } : {}), ...(input.offer ? { offer: nonempty(input.offer, "offer") } : {}),
    ...(input.quotedConsideration ? { quotedConsideration: consideration(input.quotedConsideration, "quoted consideration") } : {}) };
  return appendObservation(body, options);
}
export function recordSupplierConsideration(input, options = {}) {
  if (!["quoted", "authorized", "incurred", "settled"].includes(input.phase)) throw new TypeError("consideration phase must be quoted, authorized, incurred, or settled");
  requireObservation(options, (row) => row.type === "SupplierExchangeObserved" && (row.id === input.exchange || row.receipt === input.exchange), "known supplier exchange is required");
  const body = { type: "SupplierConsiderationObserved", actor: ACTOR, issuer: nonempty(input.issuer, "consideration issuer"), exchange: nonempty(input.exchange, "exchange"), phase: input.phase,
    consideration: consideration(input.consideration, "consideration"), evidence: nonempty(input.evidence, "consideration evidence"), observedAt: nonempty(input.observedAt, "observedAt") };
  return appendObservation(body, options);
}
/** A qualitative, revocable Leader grant. It contains no quota, price, or resource quantity. */
export function recordLeaderAuthorityGrant(input, options = {}) {
  if (nonempty(input.issuer, "authority issuer") !== CUSTOMER) throw new TypeError("only the named Leader may issue authority grants");
  const body = { type: "LeaderAuthorityGrantObserved", actor: ACTOR, issuer: CUSTOMER, recipient: nonempty(input.recipient ?? ACTOR, "authority recipient"),
    scope: stringList(input.scope, "authority scope"), revocable: input.revocable === true, evidence: nonempty(input.evidence, "authority evidence"), observedAt: nonempty(input.observedAt, "observedAt") };
  if (body.recipient !== ACTOR) throw new TypeError("Leader authority grant recipient must be Codex enterprise");
  return appendObservation(body, options);
}
export function revokeLeaderAuthorityGrant(input, options = {}) {
  const grant = leaderGrant(options, nonempty(input.grant, "authority grant"));
  if (!grant.revocable) throw new TypeError("Leader authority grant is not revocable");
  if (nonempty(input.issuer, "revocation issuer") !== grant.issuer) throw new TypeError("only the grant issuer may revoke authority");
  return appendObservation({ type: "LeaderAuthorityGrantRevoked", actor: ACTOR, grant: grant.id, issuer: grant.issuer, evidence: nonempty(input.evidence, "revocation evidence"), observedAt: nonempty(input.observedAt, "observedAt") }, options);
}
/** A provider/API capability grant. `quantity: { kind: "unknown" }` is explicit ignorance, never zero. */
export function recordProviderResourceGrant(input, options = {}) {
  const quantity = input.quantity;
  if (!quantity || typeof quantity !== "object") throw new TypeError("resource grant quantity is required");
  const quantityKind = nonempty(input.quantityKind, "resource quantity kind"); if (!RESOURCE_KINDS.has(quantityKind)) throw new TypeError("resource quantity kind is not admitted");
  const normalized = quantity.kind === "exact" ? { kind: "exact", amount: rational(quantity.amount, "resource grant quantity"), unit: nonempty(quantity.unit, "resource grant unit") } :
    quantity.kind === "unknown" ? { kind: "unknown", unit: nonempty(quantity.unit, "resource grant unit"), reason: nonempty(quantity.reason, "unknown resource grant reason") } : null;
  if (!normalized) throw new TypeError("resource grant quantity must be exact or explicitly unknown");
  return appendObservation({ type: "ProviderResourceGrantObserved", actor: ACTOR, provider: nonempty(input.provider, "resource provider"), surface: nonempty(input.surface, "resource surface"), credentialReference: nonempty(input.credentialReference, "credential reference"), resource: nonempty(input.resource, "resource"), quantityKind, quantity: normalized, scope: stringList(input.scope, "resource scope"), revocable: input.revocable === true, evidence: nonempty(input.evidence, "resource grant evidence"), observedAt: nonempty(input.observedAt, "observedAt") }, options);
}
/** Native per-operation consumption; it records use and does not debit an inferred quota or price. */
export function recordResourceConsumption(input, options = {}) {
  const grant = requireObservation(options, (row) => row.type === "ProviderResourceGrantObserved" && row.id === input.grant, "known provider resource grant is required");
  if (grant.quantityKind !== input.quantityKind) throw new TypeError("resource consumption kind must match its grant");
  return appendObservation({ type: "ResourceConsumptionObserved", actor: ACTOR, grant: grant.id, operation: nonempty(input.operation, "operation"), provider: grant.provider, surface: grant.surface, quantityKind: grant.quantityKind, amount: rational(input.amount, "consumed native quantity"), unit: nonempty(input.unit, "consumed native unit"), source: nonempty(input.source, "consumption source"), observedAt: nonempty(input.observedAt, "observedAt") }, options);
}
export function openDemand(input, options = {}) {
  const authorityGrant = leaderGrant(options, nonempty(input.authorityGrant, "authority grant"), { active: true });
  const body = { type: "CodexDemandOpened", actor: ACTOR, customer: ACTOR, desiredOutcome: nonempty(input.desiredOutcome, "desired outcome"), authorityGrant: authorityGrant.id, authorityIssuer: authorityGrant.issuer,
    completionConditions: stringList(input.completionConditions, "completion conditions"), source: nonempty(input.source, "demand source"), observedAt: nonempty(input.observedAt, "observedAt"),
    ...(input.reactionLaw ? { reactionLaw: nonempty(input.reactionLaw, "reaction law") } : {}) };
  return appendObservation(body, options);
}
export function recordSupplierOffer(input, options = {}) {
  requireObservation(options, (row) => row.type === "CodexDemandOpened" && row.id === input.demand, "known Codex demand is required");
  const body = { type: "SupplierOfferObserved", actor: ACTOR, demand: nonempty(input.demand, "demand"), provider: nonempty(input.provider, "provider"), capability: nonempty(input.capability, "capability"),
    offer: nonempty(input.offer, "provider offer receipt"), protocol: nonempty(input.protocol, "protocol"), observedAt: nonempty(input.observedAt, "observedAt"),
    ...(input.quotedConsideration ? { quotedConsideration: consideration(input.quotedConsideration, "quoted consideration") } : {}) };
  return appendObservation(body, options);
}
export function recordDemandObstruction(input, options = {}) {
  requireObservation(options, (row) => row.type === "CodexDemandOpened" && row.id === input.demand, "known Codex demand is required");
  return appendObservation({ type: "CodexDemandObstructionObserved", actor: ACTOR, demand: input.demand, issuer: nonempty(input.issuer, "obstruction issuer"),
    missingCapability: nonempty(input.missingCapability, "missing capability"), reason: nonempty(input.reason, "obstruction reason"), evidence: nonempty(input.evidence, "obstruction evidence"), observedAt: nonempty(input.observedAt, "observedAt") }, options);
}
export function recordDemandCompletionCondition(input, options = {}) {
  const demand = requireObservation(options, (row) => row.type === "CodexDemandOpened" && row.id === input.demand, "known Codex demand is required");
  const condition = nonempty(input.condition, "completion condition"); if (!demand.completionConditions.includes(condition)) throw new TypeError("completion condition is not named by the demand");
  return appendObservation({ type: "DemandCompletionConditionObserved", actor: ACTOR, demand: demand.id, condition, issuer: nonempty(input.issuer, "completion observer"), evidence: nonempty(input.evidence, "completion evidence"), observedAt: nonempty(input.observedAt, "observedAt") }, options);
}
export function closeDemand(input, options = {}) {
  if (!["fulfilled", "withdrawn"].includes(input.disposition)) throw new TypeError("demand closure disposition must be fulfilled or withdrawn");
  const issuer = nonempty(input.issuer, "closure issuer"), demandId = nonempty(input.demand, "demand"), rows = readTrajectory(options), demand = requireObservation(options, (row) => row.type === "CodexDemandOpened" && row.id === demandId, "known Codex demand is required");
  if (input.disposition === "fulfilled") {
    const authority = leaderGrant(options, demand.authorityGrant, { active: true });
    if (issuer !== authority.issuer) throw new TypeError("only the named Leader authority may declare fulfillment");
    const completed = new Set(rows.filter((row) => row.type === "DemandCompletionConditionObserved" && row.demand === demandId).map((row) => row.condition));
    if (demand.completionConditions.some((condition) => !completed.has(condition))) throw new TypeError("fulfilled demand requires every named completion condition to be observed");
  } else if (issuer !== ACTOR && issuer !== demand.authorityIssuer) throw new TypeError("only Codex or the named Leader authority may withdraw a demand");
  return appendObservation({ type: "CodexDemandClosed", actor: ACTOR, demand: demandId, issuer, disposition: input.disposition, evidence: nonempty(input.evidence, "closure evidence"), observedAt: nonempty(input.observedAt, "observedAt") }, options);
}
export function recordCustomerOutcome(input, options = {}) {
  if (nonempty(input.issuer, "outcome issuer") !== CUSTOMER) throw new TypeError("customer outcome must be issued by the named customer endpoint");
  if (!['accepted', 'rejected'].includes(input.disposition)) throw new TypeError("customer outcome disposition must be accepted or rejected");
  const body = { type: "CustomerOutcomeObserved", actor: ACTOR, customer: CUSTOMER, issuer: input.issuer, exchange: nonempty(input.exchange, "exchange"), disposition: input.disposition,
    evidence: nonempty(input.evidence, "outcome evidence"), observedAt: nonempty(input.observedAt, "observedAt") };
  return appendObservation(body, options);
}
export function recordResource(input, options = {}) {
  if (!RESOURCE_KINDS.has(input.quantityKind)) throw new TypeError("resource quantity kind is not admitted");
  const body = { type: "CodexResourceObserved", actor: ACTOR, provider: nonempty(input.provider, "resource provider"), surface: nonempty(input.surface, "surface"),
    quantityKind: input.quantityKind, amount: rational(input.amount, "resource amount"), unit: nonempty(input.unit, "resource unit"), source: nonempty(input.source, "resource source"), observedAt: nonempty(input.observedAt, "observedAt") };
  return appendObservation(body, options);
}
export function admitExactObservation(input, options = {}) { if (!exact(input)) throw new TypeError("exact content-addressed observation required"); return appendObservation(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "id")), options); }
