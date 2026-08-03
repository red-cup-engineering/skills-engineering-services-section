import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { HIERARCHICAL_CIRCUIT_PROFILE, SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, SOVEREIGN_CIRCUIT_INTERFACE_PROFILE } from "../src/sovereign-provider-interface.mjs";
import { INFERENCE_MARKET_OFFER_EXTENSION, loadCustomerServiceAdmissions, loadProviderAdmissions, standingOfferFromAgentCard } from "../src/provider-admission.mjs";
import { DIRECT_WITNESS_ADAPTER } from "../src/consideration.mjs";

const actor = "urn:ame:local-inference";
const cardUrl = "http://127.0.0.1:8795/.well-known/agent-card.json";
const digest = (character) => `ni:///sha-256;${character.repeat(42)}A`;

function sovereignInterface() {
  return {
    profile: SOVEREIGN_CIRCUIT_INTERFACE_PROFILE,
    account: "eip155:31337:0x1111111111111111111111111111111111111111",
    authority: digest("A"), custody: digest("B"), territory: digest("C"),
    component: {
      profile: HIERARCHICAL_CIRCUIT_PROFILE, law: digest("D"), ports: [], instances: [], nets: [],
      behavior: { factors: [] },
    },
  };
}

test("customer RDF admission plate names exact sovereign provider ingress", () => {
  const root = mkdtempSync(join(tmpdir(), "provider-admission-"));
  const path = join(root, "providers.nq");
  writeFileSync(path, `<${actor}> <urn:inference-market:agent-card> <${cardUrl}> <urn:ame:inference-work-lot-service:provider-admissions> .\n`);
  assert.deepEqual(loadProviderAdmissions(path), [{ id: "local-inference", actor, agentCard: cardUrl }]);
});

test("a customer admission plate cannot be read under another settlement's graph", () => {
  const root = mkdtempSync(join(tmpdir(), "provider-admission-"));
  const path = join(root, "providers.nq");
  writeFileSync(path, `<${actor}> <urn:inference-market:agent-card> <${cardUrl}> <urn:ame:free-compute-dev:provider-admissions> .\n`);
  assert.deepEqual(loadProviderAdmissions(path, { admissionGraph: "urn:ame:free-compute-dev:provider-admissions" }), [{ id: "local-inference", actor, agentCard: cardUrl }]);
  assert.throws(() => loadProviderAdmissions(path), /customer admission profile/u);
});

test("a customer plate binds each required circuit role to exactly one standard Agent Card", () => {
  const root = mkdtempSync(join(tmpdir(), "service-admission-")), path = join(root, "services.nq"), graph = "urn:ame:customer:service-admissions";
  writeFileSync(path, [
    `<urn:ame:rmn> <urn:union:service-role:rmn-conformance> <http://127.0.0.1:8786/.well-known/agent-card.json> <${graph}> .`,
    `<urn:ame:witnessJournal> <urn:union:service-role:witness-journal-rdf> <http://127.0.0.1:19764/.well-known/agent-card.json> <${graph}> .`,
  ].join("\n") + "\n");
  assert.deepEqual(loadCustomerServiceAdmissions(path, { admissionGraph: graph }), {
    rmn: { actor: "urn:ame:rmn", agentCard: "http://127.0.0.1:8786/.well-known/agent-card.json" },
    witnessJournal: { actor: "urn:ame:witnessJournal", agentCard: "http://127.0.0.1:19764/.well-known/agent-card.json" },
  });
});

test("deployment bindings replace mutable service faces without changing admitted actors or roles", () => {
  const root = mkdtempSync(join(tmpdir(), "service-admission-")), path = join(root, "services.nq"), graph = "urn:ame:customer:service-admissions";
  writeFileSync(path, [
    `<urn:ame:rmn> <urn:union:service-role:rmn-conformance> <https://stale.example/rmn/.well-known/agent-card.json> <${graph}> .`,
    `<urn:ame:witnessJournal> <urn:union:service-role:witness-journal-rdf> <https://stale.example/witnessJournal/.well-known/agent-card.json> <${graph}> .`,
  ].join("\n") + "\n");
  assert.deepEqual(loadCustomerServiceAdmissions(path, {
    admissionGraph: graph,
    agentCardOverrides: {
      rmn: "https://runtime.example/rmn/.well-known/agent-card.json",
      witnessJournal: "https://runtime.example/witnessJournal/.well-known/agent-card.json",
    },
  }), {
    rmn: { actor: "urn:ame:rmn", agentCard: "https://runtime.example/rmn/.well-known/agent-card.json" },
    witnessJournal: { actor: "urn:ame:witnessJournal", agentCard: "https://runtime.example/witnessJournal/.well-known/agent-card.json" },
  });
});

test("missing and multiply-wired customer service roles are material defects", () => {
  const root = mkdtempSync(join(tmpdir(), "service-admission-")), path = join(root, "services.nq"), graph = "urn:ame:customer:service-admissions";
  writeFileSync(path, `<urn:ame:rmn> <urn:union:service-role:rmn-conformance> <http://127.0.0.1:8786/.well-known/agent-card.json> <${graph}> .\n`);
  assert.throws(() => loadCustomerServiceAdmissions(path, { admissionGraph: graph }), /lacks the witnessJournal role/u);
  writeFileSync(path, [
    `<urn:ame:rmn-a> <urn:union:service-role:rmn-conformance> <http://127.0.0.1:8786/.well-known/agent-card.json> <${graph}> .`,
    `<urn:ame:rmn-b> <urn:union:service-role:rmn-conformance> <http://127.0.0.1:8787/.well-known/agent-card.json> <${graph}> .`,
    `<urn:ame:witnessJournal> <urn:union:service-role:witness-journal-rdf> <http://127.0.0.1:19764/.well-known/agent-card.json> <${graph}> .`,
  ].join("\n") + "\n");
  assert.throws(() => loadCustomerServiceAdmissions(path, { admissionGraph: graph }), /repeats the rmn role/u);
});

test("signed Agent Card terms instantiate a demand-bound standing offer", () => {
  const provider = { actor, agentCard: cardUrl };
  const card = { capabilities: { extensions: [
    { uri: SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, params: sovereignInterface() },
    { uri: INFERENCE_MARKET_OFFER_EXTENSION, params: { profile: "org.emsenn.inference.market-offer.v2", model: "local", workTypes: "classification", capabilities: "classification", maximumDifficulty: "0.5", maximumSourceWords: "100", maximumSourceCharacters: "1000", maximumRequestCharacters: "2000", maximumOutputTokens: "512", maximumConcurrentLots: "1", considerationAlternatives: [{ id: "test-credit", obligations: [{ id: "test-credit", kind: "credit", asset: "urn:union:credit:test", amount: 1, unit: "test", settlementAdapter: DIRECT_WITNESS_ADAPTER }] }] } },
  ] } };
  const source = { id: "urn:solicitation:1", actor: "urn:customer" };
  const demand = { mode: "dry-run" };
  const offer = standingOfferFromAgentCard(provider, card, source, demand, (value) => `ni:${JSON.stringify(value)}`);
  assert.equal(offer.actor, actor);
  assert.equal(offer.inReplyTo, source.id);
  assert.equal(offer.object.providerAccount, "eip155:31337:0x1111111111111111111111111111111111111111");
  assert.equal(offer.object.requestCommitment, `ni:${JSON.stringify(demand)}`);
  assert.equal(offer.object.advertisement, INFERENCE_MARKET_OFFER_EXTENSION);
  assert.equal(offer.object.considerationAlternatives[0].obligations[0].kind, "credit");
});

test("market discovery rejects an advertised offer whose sovereign circuit interface is malformed", () => {
  const provider = { actor, agentCard: cardUrl };
  const card = { capabilities: { extensions: [
    { uri: SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, params: { ...sovereignInterface(), account: "not-a-caip-10-account" } },
    { uri: INFERENCE_MARKET_OFFER_EXTENSION, params: { profile: "org.emsenn.inference.market-offer.v2" } },
  ] } };
  assert.throws(() => standingOfferFromAgentCard(provider, card, { id: "urn:solicitation:1" }, { mode: "live" }, () => digest("E")), /CAIP-10/u);
});
