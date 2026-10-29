#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { sendRmnTask } from "@emsenn/a2a-services-section/client";
import { conformCanonicalBytes, conformEffectTransition, conformTerm } from "@emsenn/rmn-semantic-conformance/client";
import { recordLocalRwil, relationalRwilDocument } from "@emsenn/rwil-rdf-services/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const ACTOR = "urn:ame:logical-inference-service-section";
export const LAW = "ni:///sha-256;dPKjAceg6De7UofMmCvs-nIEt9oszzMKBawJJn3YMr8";
export const CHILD_OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
export const CHILD_BUNDLE_TYPE = ["product", ["effect"], CHILD_OPERATION_TYPE];
export const OUTER_OPERATION_TYPE = ["product", CHILD_BUNDLE_TYPE, ["mark"]];
const OUTER_BUNDLE_TYPE = ["product", ["effect"], OUTER_OPERATION_TYPE];
const ACCOUNT_BINDING = JSON.parse(readFileSync(resolve(ROOT, "content/evm/accounts/eip155-31337.json"), "utf8"));
export const ACCOUNT = ACCOUNT_BINDING.account.caip10;

function rmnAgent() {
  const agentUrl = process.env.RMN_CONFORMANCE_AGENT;
  if (!agentUrl) throw new Error("RMN_CONFORMANCE_AGENT must name the hired RMN provider's A2A 1.0 Agent Card");
  return agentUrl;
}
function rwilAgent() {
  const agentUrl = process.env.RWIL_RDF_AGENT;
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name the hired RWIL/RDF provider's A2A 1.0 Agent Card");
  return agentUrl;
}

function rawPart(message) {
  const parts = (message?.parts ?? []).filter((part) => part?.mediaType === "application/rmn+cbor" && typeof part.raw === "string" && typeof part.metadata?.ni === "string");
  if (message?.role !== "ROLE_USER" || parts.length !== 1) throw new Error("LISS requires one A2A ROLE_USER Message carrying exactly one canonical RMN part");
  return parts[0];
}

async function conformBundle(bytesBase64, operationType, expectedNi) {
  return conformCanonicalBytes({ agentUrl: rmnAgent(), bytes: Buffer.from(bytesBase64, "base64"), expectedType: ["product", ["effect"], operationType], expectedNi });
}

function sameField(proposal, completion, field) {
  if (proposal[field] !== completion[field]) throw new Error(`child completion changed ${field}`);
}

function resultParts(result) {
  if (Array.isArray(result?.parts)) return result.parts;
  if (Array.isArray(result?.artifacts)) return result.artifacts.flatMap((artifact) => artifact.parts ?? []);
  return [];
}

function completionPart(result) {
  const parts = resultParts(result).filter((part) => part?.mediaType === "application/rmn+cbor" && part?.content?.$case === "raw" && typeof part.metadata?.ni === "string");
  if (parts.length !== 1) throw new Error("A2A child result must carry exactly one canonical RMN completion part");
  return { id: parts[0].metadata.ni, content: Buffer.from(parts[0].content.value ?? []).toString("base64") };
}

function resultText(result) {
  return resultParts(result).find((part) => part?.content?.$case === "text")?.content?.value ?? "";
}

function appendMeasure(measures, measure) {
  return [...(measures ?? []).filter(({ dimension }) => dimension !== measure.dimension), measure];
}

async function appendRwil({ proposal, completion, childProposal, childCompletion, witness, disposition }) {
  const at = new Date().toISOString(), day = at.slice(0, 10), [year, month, date] = day.split("-");
  const root = resolve(process.env.LISS_RWIL_ROOT ?? join(ROOT, "data"));
  const assertions = [
    ["urn:rmn:proposal", proposal], ["urn:rmn:completion", completion], ["urn:rmn:childProposal", childProposal],
    ["urn:rmn:childCompletion", childCompletion], ["urn:rmn:witness", witness], ["urn:rmn:disposition", disposition],
    ["urn:prov:generatedAtTime", at],
  ].map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } }));
  return recordLocalRwil({ agentUrl: rwilAgent(), root, nodeId: "logical-inference-service-section", batch: { settlement: ACCOUNT, graph: completion, recordedAt: at, document: relationalRwilDocument({ type: "InferenceSeamWitness", proposal, completion, childProposal, childCompletion, witness, disposition }), assertions } });
}

export async function executeMessage(message, { send = sendRmnTask } = {}) {
  const part = rawPart(message);
  const outer = await conformBundle(part.raw, OUTER_OPERATION_TYPE, part.metadata.ni);
  const outerCell = outer.effectCell, operation = outer.normalForm[2];
  if (outerCell.law !== LAW || outerCell.provider !== ACCOUNT) {
    throw new Error(`outer effect targets law ${String(outerCell.law)} and provider ${String(outerCell.provider)}; LISS currently offers law ${LAW} at ${ACCOUNT}`);
  }
  if (outerCell.outcome?.positiveEvidence !== false || outerCell.outcome?.negativeEvidence !== false) throw new Error("outer proposal must enter at FOUR-bottom");
  if (operation?.[0] !== "pair" || operation?.[2]?.[0] !== "mark" || typeof operation[2][1] !== "string") throw new Error("outer operation must contain one embedded child effect bundle and one Agent Card URL");

  const child = await conformTerm({ agentUrl: rmnAgent(), term: operation[1], expectedType: CHILD_BUNDLE_TYPE }), childCell = child.normalForm?.[1]?.[1];
  if (!childCell || child.normalForm?.[0] !== "pair" || child.normalForm?.[1]?.[0] !== "effect") throw new Error("embedded child is not an RMN effect bundle");
  if (childCell.caller !== ACCOUNT) throw new Error("child caller must be LISS's current smart account");
  if (childCell.outcome?.positiveEvidence !== false || childCell.outcome?.negativeEvidence !== false) throw new Error("child proposal must enter at FOUR-bottom");

  const childMessage = {
    messageId: randomUUID(), role: "ROLE_USER",
    parts: [{ raw: child.canonicalBytesBase64, metadata: { ni: child.term }, filename: "proposal.rmn.cbor", mediaType: "application/rmn+cbor" }],
    metadata: { parentNi: outer.term },
  };
  const childExchange = await send({ agentUrl: operation[2][1], message: childMessage });
  const childCompletionDoc = completionPart(childExchange.result);
  const childCompletion = await conformBundle(childCompletionDoc.content, CHILD_OPERATION_TYPE, childCompletionDoc.id), childCompletedCell = childCompletion.effectCell;
  for (const field of ["caller", "law", "operation", "parent", "postcondition", "precondition", "provider", "refusal" ]) sameField(childCell, childCompletedCell, field);
  const childTransition = await conformEffectTransition({ agentUrl: rmnAgent(), proposalCell: childCell, completionCell: childCompletedCell, evidence: childCompletedCell.evidenceRoot });
  const disposition = childCompletedCell.outcome.positiveEvidence ? "completion" : "refused";
  const outerCompletionCell = { ...outerCell, evidenceRoot: childCompletion.term, outcome: childCompletedCell.outcome,
    measures: appendMeasure(outerCell.measures, { dimension: "child-inference", quantity: "1", unit: "a2a-task" }) };
  const outerTransition = await conformEffectTransition({ agentUrl: rmnAgent(), proposalCell: outerCell, completionCell: outerCompletionCell, evidence: childCompletion.term });
  const completion = await conformTerm({ agentUrl: rmnAgent(), term: ["pair", ["effect", outerCompletionCell], operation], expectedType: OUTER_BUNDLE_TYPE });
  await appendRwil({ proposal: outer.term, completion: completion.term, childProposal: child.term, childCompletion: childCompletion.term, witness: outerTransition.witness, disposition });
  return {
    messageId: randomUUID(), role: "ROLE_AGENT",
    parts: [
      { raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.rmn.cbor", mediaType: "application/rmn+cbor" },
      { text: resultText(childExchange.result), metadata: { evidenceNi: childCompletion.term, disposition }, mediaType: "text/plain" },
    ],
    metadata: { disposition, proposalNi: outer.term, completionNi: completion.term, childProposalNi: child.term,
      childCompletionNi: childCompletion.term, childWitnessNi: childTransition.witness, witnessNi: outerTransition.witness },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
