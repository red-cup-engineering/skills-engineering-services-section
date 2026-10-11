import { TYPED_INFERENCE_OPERATION_TYPE } from "@red-cup-engineering/computer-inference-engine/fabric/execute-typed-inference-effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { circuitInterfaceFromAgentCard } from "@red-cup-engineering/a2a-services-section/circuit-interface";
import { migrateConsiderationAlternative, validateConsiderationAlternative } from "./consideration.mjs";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";

export const INFERENCE_MARKET_OFFER_EXTENSION = "ni:///sha-256;hLCUM4R4uZnPEVaY9Cb6sDwruIVBtw2bjleYGbeATaQ";
const AGENT_CARD = "urn:inference-market:agent-card";
const SERVICE_ROLES = Object.freeze({
  witnessJournal: "urn:union:service-role:semantic-record-journal",
});
const LEGACY_SERVICE_ROLES = Object.freeze({ "urn:union:service-role:witness-journal-rdf": "witnessJournal" });
const serviceRole = (iri) => Object.entries(SERVICE_ROLES).find(([, value]) => value === iri)?.[0] ?? LEGACY_SERVICE_ROLES[iri];
export const DEFAULT_PROVIDER_ADMISSION_GRAPH = "urn:ame:inference-work-lot-service:provider-admissions";
const QUAD = /^<([^>]+)> <([^>]+)> <([^>]+)> <([^>]+)> \.$/u;
/** Any scheme-prefixed identifier (urn:, actor:, ...), not one fixed scheme. */
export const CUSTOMER_ACTOR_URI = /^[a-z][a-z0-9+.-]*:/iu;
const words = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`signed inference market offer has no ${label}`);
  return value.trim().split(/\s+/u);
};
const boundedNumber = (value, label, { integer = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isSafeInteger(number))) throw new Error(`signed inference market offer has invalid ${label}`);
  return number;
};

function jsonPlate(path, kind) {
  if (!String(path).endsWith(".json")) return null;
  const plate = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (plate?.kind !== kind || plate.version !== 1 || !Array.isArray(plate.admissions)) throw new Error(`${kind} must be one versioned admission carrier`);
  identifyJsonSemanticContent({ objectKind: kind, value: plate, witnessRoot: EMPTY_WITNESS_ROOT });
  return plate;
}

function providerAgentCardUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${label} uses non-HTTPS remote ingress`);
  }
  if (!url.pathname.endsWith("/.well-known/agent-card.json") || url.search !== "" || url.hash !== "") {
    throw new Error(`${label} does not name one standard Agent Card`);
  }
  return url;
}

export function loadProviderAdmissions(path, { admissionGraph = DEFAULT_PROVIDER_ADMISSION_GRAPH, agentCardOverrides = {} } = {}) {
  if (typeof admissionGraph !== "string" || !admissionGraph.startsWith("urn:")) throw new Error("provider admission graph must be one exact URN");
  const plate = jsonPlate(path, "inference-work-lot.provider-admissions");
  const admitted = [];
  if (plate) {
    if (plate.market !== admissionGraph) throw new Error("provider admission carrier belongs to another market graph");
    for (const [index, item] of plate.admissions.entries()) {
      if (typeof item?.actor !== "string" || !item.actor.startsWith("urn:")) throw new Error(`provider admission ${index + 1} lacks an actor`);
      const url = providerAgentCardUrl(agentCardOverrides[item.actor] || item.agentCard, `provider admission ${index + 1}`);
      admitted.push(Object.freeze({ id: item.actor.slice(item.actor.lastIndexOf(":") + 1), actor: item.actor, agentCard: url.href }));
    }
  } else
  for (const [index, line] of readFileSync(resolve(path), "utf8").split(/\r?\n/u).entries()) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = line.match(QUAD);
    if (!match) throw new Error(`provider admission line ${index + 1} is not one exact RDF quad`);
    const [, actor, predicate, agentCard, graph] = match;
    if (!actor.startsWith("urn:") || predicate !== AGENT_CARD || graph !== admissionGraph) throw new Error(`provider admission line ${index + 1} violates the customer admission profile`);
    const url = providerAgentCardUrl(agentCardOverrides[actor] || agentCard, `provider admission line ${index + 1}`);
    admitted.push(Object.freeze({ id: actor.slice(actor.lastIndexOf(":") + 1), actor, agentCard: url.href }));
  }
  if (admitted.length === 0) throw new Error("customer provider admission plate is empty");
  const actors = new Set(admitted.map(({ actor }) => actor));
  if (actors.size !== admitted.length) throw new Error("customer provider admission plate repeats an actor");
  return Object.freeze(admitted.sort((left, right) => left.actor.localeCompare(right.actor)));
}

const ADMITTED_CUSTOMER = "urn:inference-market:admitted-customer";
export const DEFAULT_CUSTOMER_ADMISSION_GRAPH = "urn:ame:inference-work-lot-service:customer-admissions";

export function loadCustomerAdmissions(path, { admissionGraph = DEFAULT_CUSTOMER_ADMISSION_GRAPH, market } = {}) {
  if (typeof admissionGraph !== "string" || !admissionGraph.startsWith("urn:")) throw new Error("customer admission graph must be one exact URN");
  if (typeof market !== "string" || !market.startsWith("urn:")) throw new Error("customer admissions must name the admitting market actor as one exact URN");
  const plate = jsonPlate(path, "inference-work-lot.customer-admissions");
  const admitted = [];
  if (plate) {
    if (plate.market !== market || plate.admissionGraph !== admissionGraph) throw new Error("customer admission carrier belongs to another market graph");
    for (const [index, item] of plate.admissions.entries()) {
      if (typeof item?.actor !== "string" || !CUSTOMER_ACTOR_URI.test(item.actor)) throw new Error(`customer admission ${index + 1} lacks an actor`);
      admitted.push(item.actor);
    }
  } else
  for (const [index, line] of readFileSync(resolve(path), "utf8").split(/\r?\n/u).entries()) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = line.match(QUAD);
    if (!match) throw new Error(`customer admission line ${index + 1} is not one exact RDF quad`);
    const [, actor, predicate, object, graph] = match;
    if (!CUSTOMER_ACTOR_URI.test(actor) || predicate !== ADMITTED_CUSTOMER || object !== market || graph !== admissionGraph) throw new Error(`customer admission line ${index + 1} violates the customer admission profile`);
    admitted.push(actor);
  }
  if (admitted.length === 0) throw new Error("customer admission plate is empty");
  const actors = new Set(admitted);
  if (actors.size !== admitted.length) throw new Error("customer admission plate repeats an actor");
  return Object.freeze(actors);
}

/**
 * Data-declared display tokens (e.g. "codex") for admitted customer actors,
 * read from each admission's own optional `token` field -- opaque actor
 * addresses carry no parseable suffix, so this label can only come from data.
 * @param {string} path
 * @param {{ admissionGraph?: string, market: string }} [options]
 * @returns {Map<string, string>} admitted actor -> its token
 */
export function loadCustomerActorTokens(path, { admissionGraph = DEFAULT_CUSTOMER_ADMISSION_GRAPH, market } = {}) {
  const plate = jsonPlate(path, "inference-work-lot.customer-admissions");
  const tokens = new Map();
  if (plate?.market === market && plate?.admissionGraph === admissionGraph) {
    for (const item of plate.admissions) {
      if (typeof item?.actor === "string" && typeof item?.token === "string" && item.token.trim() !== "") tokens.set(item.actor, item.token);
    }
  }
  return tokens;
}

export function loadCustomerServiceAdmissions(path, {
  admissionGraph,
  requiredRoles = Object.keys(SERVICE_ROLES),
  agentCardOverrides = {},
} = {}) {
  if (typeof admissionGraph !== "string" || !admissionGraph.startsWith("urn:")) throw new Error("service admission graph must be one exact URN");
  if (!Array.isArray(requiredRoles) || requiredRoles.length === 0 || requiredRoles.some((role) => !Object.hasOwn(SERVICE_ROLES, role))) throw new Error("required service roles must name known exact roles");
  const plate = jsonPlate(path, "inference-work-lot.service-admissions");
  const admitted = new Map();
  if (plate) {
    if (plate.admissionGraph !== admissionGraph) throw new Error("service admission carrier belongs to another admission graph");
    for (const [index, item] of plate.admissions.entries()) {
      const role = serviceRole(item?.role);
      if (typeof item?.actor !== "string" || !item.actor.startsWith("urn:") || !role || admitted.has(role)) throw new Error(`service admission ${index + 1} is malformed or repeated`);
      admitted.set(role, Object.freeze({ actor: item.actor, substrate: item.substrate ?? "local-semantic-record-journal" }));
    }
  } else
  for (const [index, line] of readFileSync(resolve(path), "utf8").split(/\r?\n/u).entries()) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = line.match(QUAD);
    if (!match) throw new Error(`service admission line ${index + 1} is not one exact RDF quad`);
    const [, actor, predicate, agentCard, graph] = match;
    const role = serviceRole(predicate);
    if (!actor.startsWith("urn:") || !role || graph !== admissionGraph) throw new Error(`service admission line ${index + 1} violates the customer service profile`);
    if (admitted.has(role)) throw new Error(`service admission plate repeats the ${role} role`);
    const url = new URL(agentCardOverrides[role] || agentCard);
    if (!url.pathname.endsWith("/.well-known/agent-card.json")) throw new Error(`service admission line ${index + 1} does not name a standard Agent Card`);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`service admission line ${index + 1} uses non-HTTPS remote ingress`);
    admitted.set(role, Object.freeze({ actor, agentCard: url.href }));
  }
  for (const role of requiredRoles) if (!admitted.has(role)) throw new Error(`customer service admission plate lacks the ${role} role`);
  return Object.freeze(Object.fromEntries([...admitted].sort(([left], [right]) => left.localeCompare(right))));
}

export function standingOfferFromAgentCard(provider, card, source, demand, commitment) {
  const extensions = card?.capabilities?.extensions ?? [];
  const sovereign = circuitInterfaceFromAgentCard(card);
  const advertised = extensions.find(({ uri }) => uri === INFERENCE_MARKET_OFFER_EXTENSION)?.params;
  if (!advertised || advertised.profile !== "org.emsenn.inference.market-offer.v2") throw new Error("signed Agent Card carries no v2 inference market offer");
  if (!Array.isArray(advertised.considerationAlternatives) || advertised.considerationAlternatives.length === 0) throw new Error("signed inference market offer has no consideration alternatives");
  const considerationAlternatives = advertised.considerationAlternatives.map(migrateConsiderationAlternative);
  considerationAlternatives.forEach(validateConsiderationAlternative);
  const object = {
    type: "TypedSenInferenceServiceOffer",
    contract: sovereign.component.law,
    providerAccount: sovereign.account,
    agentCard: provider.agentCard,
    operationType: TYPED_INFERENCE_OPERATION_TYPE,
    model: advertised.model,
    mode: demand.mode,
    workTypes: words(advertised.workTypes, "workTypes"),
    capabilities: words(advertised.capabilities, "capabilities"),
    maximumDifficulty: boundedNumber(advertised.maximumDifficulty, "maximumDifficulty"),
    maximumSourceWords: boundedNumber(advertised.maximumSourceWords, "maximumSourceWords", { integer: true }),
    maximumSourceCharacters: boundedNumber(advertised.maximumSourceCharacters, "maximumSourceCharacters", { integer: true }),
    maximumRequestCharacters: boundedNumber(advertised.maximumRequestCharacters, "maximumRequestCharacters", { integer: true }),
    maximumOutputTokens: boundedNumber(advertised.maximumOutputTokens, "maximumOutputTokens", { integer: true }),
    maximumConcurrentLots: boundedNumber(advertised.maximumConcurrentLots, "maximumConcurrentLots", { integer: true }),
    considerationAlternatives,
    requestCommitment: commitment(demand),
    availability: "accepted-task-must-still-settle",
    customerAcceptanceRequired: true,
    advertisement: INFERENCE_MARKET_OFFER_EXTENSION,
  };
  return Object.freeze({ "@context": "https://www.w3.org/ns/activitystreams", id: commitment({ actor: provider.actor, source: source.id, object }), type: "Offer", actor: provider.actor, target: source.actor, inReplyTo: source.id, object });
}

const INFERENCE_WORK_CUSTOMER_ENV = "INFERENCE_WORK_CUSTOMER";

/**
 * Resolve the one admitted customer actor this process transacts as.
 * @param {Set<string>} admittedCustomers
 * @param {{ env?: Record<string, string|undefined>, fallback?: string }} [options]
 * @returns {string} the resolved, admitted customer actor address
 */
export function resolveConfiguredCustomer(admittedCustomers, { env = process.env, fallback } = {}) {
  const requested = env[INFERENCE_WORK_CUSTOMER_ENV];
  if (requested === undefined || requested === "") {
    if (typeof fallback !== "string" || fallback.trim() === "") throw new Error(`${INFERENCE_WORK_CUSTOMER_ENV} is unset and no fallback customer actor was supplied`);
    return fallback;
  }
  if (!admittedCustomers.has(requested)) throw new Error(`${INFERENCE_WORK_CUSTOMER_ENV} names an actor not admitted to this market: ${requested}`);
  return requested;
}

/**
 * @param {string} customerActor
 * @param {Map<string, string>} actorTokens from loadCustomerActorTokens
 * @returns {string|null} the actor's data-declared token (e.g. "codex"), or null if undeclared
 */
export function configuredCustomerToken(customerActor, actorTokens) {
  return actorTokens?.get(customerActor) ?? null;
}

/**
 * @param {string} customerActor
 * @param {Map<string, string>} actorTokens from loadCustomerActorTokens
 * @returns {string} the outcome sentinel this actor's dispatch produces
 */
export function outcomeSentinelForCustomer(customerActor, actorTokens) {
  return `candidate-pending-${configuredCustomerToken(customerActor, actorTokens) ?? "customer"}-acceptance`;
}
