#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { a2aResultMetadata, a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { conformCanonicalBytes, conformTerm } from "@red-cup-engineering/relation-model-notation-conformance/client";
import { circuitInterfaceFromAgentCard, SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION } from "@red-cup-engineering/relation-model-notation-runtime/hierarchical-circuit";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { assayWitTransition } from "@lenticule-science/wit-transition-assay/client";
import { recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
import {
  CDP_FACILITATOR_URL,
  createCdpFacilitatorContract,
  createExactEvmPaymentBoundary,
  declareDiscoveryExtension,
} from "@red-cup-engineering/x402-services-section/server";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const ACTOR = "urn:ame:metered-inference-tollbooth";
const ACCOUNT = JSON.parse(readFileSync(resolve(ROOT, "content/evm/accounts/eip155-31337.json"), "utf8")).account.caip10;
const INFERENCE_MARKET_OFFER_EXTENSION = "ni:///sha-256;hLCUM4R4uZnPEVaY9Cb6sDwruIVBtw2bjleYGbeATaQ";
const PROVIDER_OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
const PROVIDER_BUNDLE_TYPE = ["product", ["effect"], PROVIDER_OPERATION_TYPE];
const OPERATION_TYPE = PROVIDER_BUNDLE_TYPE;
const DISCOVERY = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: {
    "@context": CONTEXT, id: "urn:example:metered-inference-contract", type: "Accept", actor: "urn:example:customer", target: ACTOR,
    object: { type: "ServiceContract", callerAccount: "eip155:8453:0x0000000000000000000000000000000000000001", providerAgentCard: "https://provider.example/.well-known/agent-card.json", proposal: { type: "Document", id: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", mediaType: "application/rmn+cbor", content: "oA==" } },
  },
  inputSchema: {
    type: "object",
    required: ["@context", "id", "type", "actor", "target", "object"],
    properties: {
      "@context": { const: CONTEXT }, id: { type: "string" }, type: { const: "Accept" }, actor: { type: "string" }, target: { const: ACTOR },
      object: { type: "object", required: ["type", "callerAccount", "providerAgentCard", "proposal"], properties: {
        type: { const: "ServiceContract" }, callerAccount: { type: "string" },
        providerAgentCard: { type: "string", description: "Customer-selected signed A2A 1.0 provider Agent Card URL." },
        proposal: { type: "object", description: "Canonical application/rmn+cbor effect bundle encoded as an ActivityStreams Document." },
      } },
    },
  },
  output: {
    example: { "@context": CONTEXT, id: "urn:example:metered-inference-settlement", type: "Accept", actor: ACTOR, target: "urn:example:customer", inReplyTo: "urn:example:metered-inference-contract", object: { type: "RmnMeteredInferenceSettlement", disposition: "completion" } },
    schema: { type: "object", required: ["@context", "id", "type", "actor", "target", "inReplyTo", "object"], properties: { type: { enum: ["Accept", "Reject"] }, object: { type: "object" } } },
  },
});
function rmnAgent() {
  if (!process.env.RMN_CONFORMANCE_AGENT) throw new Error("RMN_CONFORMANCE_AGENT must name the hired RMN provider's A2A 1.0 Agent Card");
  return process.env.RMN_CONFORMANCE_AGENT;
}
function witAgent() { if (!process.env.WIT_TRANSITION_ASSAY_AGENT) throw new Error("WIT_TRANSITION_ASSAY_AGENT must name the hired WIT transition provider's signed A2A 1.0 Agent Card"); return process.env.WIT_TRANSITION_ASSAY_AGENT; }

function document(value, name) {
  if (value?.type !== "Document" || value.mediaType !== "application/rmn+cbor" || typeof value.id !== "string" || typeof value.content !== "string") {
    throw new Error(`${name} must be an ActivityStreams Document carrying application/rmn+cbor bytes`);
  }
  return value;
}

async function conformBundle(value) {
  const doc = document(value, "proposal");
  return conformCanonicalBytes({ agentUrl: rmnAgent(), bytes: Buffer.from(doc.content, "base64"), expectedType: ["product", ["effect"], OPERATION_TYPE], expectedNi: doc.id });
}

function response(type, source, object) {
  return { "@context": CONTEXT, id: `urn:uuid:${randomUUID()}`, type, actor: ACTOR, target: source.actor, inReplyTo: source.id, object };
}

function sameField(proposal, completion, field) {
  if (proposal[field] !== completion[field]) throw new Error(`completion changed ${field}`);
}

function validateEnvelope(source) {
  if (source?.["@context"] !== CONTEXT || source.type !== "Accept" || source.target !== ACTOR || source.object?.type !== "ServiceContract") {
    throw new Error("metered inference requires an ActivityStreams Accept<ServiceContract> addressed to the tollbooth");
  }
  if (typeof source.object.providerAgentCard !== "string" || !/^https?:\/\//u.test(source.object.providerAgentCard)) throw new Error("service contract must name the selected provider's signed A2A Agent Card");
  document(source.object.proposal, "proposal");
  return source;
}

const resultParts = a2aResultParts;

export async function executeSettledContract(source) {
  validateEnvelope(source);
  const proposal = await conformBundle(source.object.proposal);
  const cell = proposal.effectCell;
  if (cell.provider !== ACCOUNT) throw new Error("proposal is not addressed to the tollbooth account and service scale");
  if (source.object.callerAccount !== cell.caller) throw new Error("ActivityStreams callerAccount does not match the RMN caller");
  if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new Error("proposal must enter at FOUR-bottom");
  const operation = proposal.normalForm[2];
  const providerProposal = await conformTerm({ agentUrl: rmnAgent(), term: operation, expectedType: PROVIDER_BUNDLE_TYPE });
  const providerCell = providerProposal.normalForm?.[1]?.[1];
  if (!providerCell || providerCell.caller !== ACCOUNT) throw new Error("embedded provider effect must name the tollbooth smart account as caller");
  const exchange = await sendRmnTask({ agentUrl: source.object.providerAgentCard, extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, INFERENCE_MARKET_OFFER_EXTENSION], requireSignature: true, message: {
    messageId: randomUUID(), role: "ROLE_USER",
    parts: [{ raw: providerProposal.canonicalBytesBase64, metadata: { ni: providerProposal.term }, filename: "proposal.rmn.cbor", mediaType: "application/rmn+cbor" }],
    metadata: { parentNi: proposal.term },
  } });
  const providerInterface = circuitInterfaceFromAgentCard(exchange.agentCard);
  if (providerInterface.account !== providerCell.provider || providerInterface.component.law !== providerCell.law) throw new Error("selected provider Agent Card does not inhabit the embedded RMN effect");
  const providerSettlement = { protocol: "A2A", protocolVersion: "1.0", provider: providerInterface.account, law: providerInterface.component.law, proposal: exchange.inputNi, completion: exchange.outputNi,
    disposition: a2aResultMetadata(exchange.result).disposition ?? "refused", candidate: resultParts(exchange.result).find((part) => part?.content?.$case === "text")?.content?.value ?? "" };
  const accepted = providerSettlement.disposition === "completion";
  const completionCell = {
    ...cell,
    evidenceRoot: providerSettlement.completion,
    outcome: { positiveEvidence: accepted, negativeEvidence: !accepted },
    measures: [...cell.measures.filter(({ dimension }) => dimension !== "provider-settlement-attempt"), { dimension: "provider-settlement-attempt", quantity: "1", unit: "direct-a2a-contract" }],
  };
  for (const field of ["caller", "law", "operation", "parent", "postcondition", "precondition", "provider", "refusal" ]) sameField(cell, completionCell, field);
  const transition = await assayWitTransition({ agentUrl: witAgent(), proposalCell: cell, completionCell, evidence: providerSettlement.completion });
  const completionTerm = ["pair", ["effect", completionCell], operation];
  const completion = await conformTerm({ agentUrl: rmnAgent(), term: completionTerm, expectedType: ["product", ["effect"], OPERATION_TYPE] });
  return response(accepted ? "Accept" : "Reject", source, {
    type: "RmnMeteredInferenceSettlement",
    disposition: accepted ? "completion" : "refused",
    proposal: proposal.term, completion: completion.term, witness: transition.witness,
    inference: providerSettlement,
    attachment: [{ type: "Document", id: completion.term, mediaType: "application/rmn+cbor", content: completion.canonicalBytesBase64 }],
  });
}

async function appendSettlementWitnessJournal(context, agentUrl) {
  const body = context.transportContext?.responseBody;
  if (!body) return;
  let activityResult;
  try { activityResult = JSON.parse(Buffer.from(body).toString("utf8")); } catch { return; }
  if (activityResult?.object?.type !== "RmnMeteredInferenceSettlement") return;
  const at = new Date().toISOString();
  const transaction = context.result.transaction;
  const graph = identifyJsonSemanticContent({
    objectKind: "metered-inference-tollbooth.x402-settlement-transaction",
    value: { network: context.result.network, transaction },
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).token;
  const assertions = [
    ["urn:rmn:proposal", activityResult.object.proposal],
    ["urn:rmn:completion", activityResult.object.completion],
    ["urn:rmn:witness", activityResult.object.witness],
    ["urn:x402:network", context.result.network],
    ["urn:x402:transaction", transaction],
    ["urn:x402:payer", context.result.payer ?? "undisclosed"],
    ["urn:x402:amount", context.result.amount ?? context.requirements.amount],
    ["urn:prov:generatedAtTime", at],
  ].map(([predicate, value]) => ({ subject: graph, predicate, object: { kind: "literal", value: String(value) } }));
  await recordWitnessJournalBatch({ agentUrl, batch: { settlement: ACCOUNT, graph, recordedAt: at, document: relationalWitnessJournalDocument({ type: "X402InferenceSettlementWitness", settlement: activityResult.object, payment: { network: context.result.network, transaction, payer: context.result.payer ?? null, amount: context.result.amount ?? context.requirements.amount } }), assertions } });
}

function envConfiguration(env) {
  const network = env.X402_NETWORK;
  const payTo = env.X402_PAY_TO;
  const facilitatorUrl = env.X402_FACILITATOR;
  const price = env.X402_PRICE;
  if (!/^eip155:[0-9]+$/u.test(network ?? "")) throw new Error("X402_NETWORK must be an explicit EVM CAIP-2 identifier");
  if (!/^0x[0-9a-fA-F]{40}$/u.test(payTo ?? "")) throw new Error("X402_PAY_TO must be the address of a smart account on X402_NETWORK");
  if (!facilitatorUrl) throw new Error("X402_FACILITATOR is required; payment verification and settlement may not be simulated");
  if (!/^\$[0-9]+(?:\.[0-9]+)?$/u.test(price ?? "")) throw new Error("X402_PRICE must be an explicit x402 dollar price such as $0.001");
  const facilitatorProvider = env.X402_FACILITATOR_PROVIDER;
  if (network === "eip155:8453" && facilitatorProvider !== "cdp") throw new Error("Base mainnet requires the explicit CDP facilitator contract");
  if (facilitatorProvider === "cdp" && (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET)) throw new Error("CDP facilitator contract requires runtime CDP credentials");
  return { network, payTo, facilitatorUrl, facilitatorProvider, price, port: Number(env.PORT ?? 4022) };
}

function selectedFacilitator(env, config, injected) {
  if (injected !== undefined) return injected;
  if (config.facilitatorProvider !== "cdp") return undefined;
  return createCdpFacilitatorContract({ apiKeyId: env.CDP_API_KEY_ID, apiKeySecret: env.CDP_API_KEY_SECRET, baseUrl: config.facilitatorUrl || CDP_FACILITATOR_URL });
}

export function createServer(env = process.env, { facilitatorClient } = {}) {
  const config = envConfiguration(env);
  if (!env.WITNESS_JOURNAL_RDF_AGENT) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the hired witness-journal RDF provider's A2A 1.0 Agent Card");
  const payment = createExactEvmPaymentBoundary({
    network: config.network,
    facilitatorUrl: config.facilitatorUrl,
    facilitatorClient: selectedFacilitator(env, config, facilitatorClient),
    routes: {
      "POST /inference": {
        accepts: [{ scheme: "exact", price: config.price, network: config.network, payTo: config.payTo }],
        description: "One exact canonical RMN inference contract, executed through the standard A2A provider after x402 settlement authorization.",
        mimeType: "application/activity+json", serviceName: "metered-inference-tollbooth",
        tags: ["rmn", "inference", "a2a", "x402"],
        extensions: DISCOVERY,
      },
    },
    afterSettle: async (context) => appendSettlementWitnessJournal(context, env.WITNESS_JOURNAL_RDF_AGENT),
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ type: ["application/activity+json", "application/ld+json", "application/json"], limit: "4mb" }));
  app.get("/status", (_request, res) => res.json({ status: "ok", service: "metered-inference-tollbooth", network: config.network, price: config.price }));
  app.post("/inference", (req, res, next) => {
    try { validateEnvelope(req.body); next(); }
    catch (error) { res.status(422).type("application/activity+json").send(response("Reject", req.body ?? {}, { type: "Refusal", reason: "malformed-contract", message: error.message })); }
  });
  app.use(payment.middleware);
  app.post("/inference", async (req, res) => {
    try { res.status(200).type("application/activity+json").send(await executeSettledContract(req.body)); }
    catch (error) { res.status(422).type("application/activity+json").send(response("Reject", req.body, { type: "Refusal", reason: "contract-refused", message: error.message })); }
  });
  return { app, resourceServer: payment.resourceServer, ...config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, port, network, payTo, facilitatorUrl, price } = createServer();
  app.listen(port, () => process.stdout.write(`${JSON.stringify({ service: ACTOR, route: `http://127.0.0.1:${port}/inference`, network, payTo, facilitator: facilitatorUrl, price })}\n`));
}

export { ACCOUNT, ACTOR, OPERATION_TYPE };
