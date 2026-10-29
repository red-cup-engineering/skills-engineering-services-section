#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { conformCanonicalBytes, conformEffectTransition, conformTerm } from "@emsenn/rmn-semantic-conformance/client";
import { recordLocalRwil, relationalRwilDocument } from "@emsenn/rwil-rdf-services/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const ACTOR = "urn:ame:gemini-inference-team";
export const ACCOUNT = JSON.parse(readFileSync(resolve(ROOT, "content/evm/accounts/eip155-31337.json"), "utf8")).account.caip10;
export const LAW = "ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo";
export const OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];

function rmnAgent() {
  if (!process.env.RMN_CONFORMANCE_AGENT) throw new Error("RMN_CONFORMANCE_AGENT must name the hired RMN provider's A2A 1.0 Agent Card");
  return process.env.RMN_CONFORMANCE_AGENT;
}
function rwilAgent() { if (!process.env.RWIL_RDF_AGENT) throw new Error("RWIL_RDF_AGENT must name the hired RWIL/RDF provider's A2A 1.0 Agent Card"); return process.env.RWIL_RDF_AGENT; }
function rawPart(message) {
  const parts = (message.parts ?? []).filter((part) => part?.mediaType === "application/rmn+cbor" && typeof part.raw === "string");
  if (parts.length !== 1) throw new Error("Gemini inference requires exactly one application/rmn+cbor A2A part");
  return parts[0];
}
function operationMarks(term) {
  if (term?.[0] !== "pair" || term?.[1]?.[0] !== "mark" || term?.[2]?.[0] !== "pair" || term?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[0] !== "pair" || term?.[2]?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[2]?.[0] !== "mark") throw new Error("inference operation is not instruction/input/model/mode Marks");
  return { instruction: term[1][1], input: term[2][1][1], model: term[2][2][1][1], mode: term[2][2][2][1] };
}
function measures(prior, usage = {}) {
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "gemini-request" });
  if (Number.isInteger(usage.promptTokenCount)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.promptTokenCount), unit: "token" });
  if (Number.isInteger(usage.candidatesTokenCount)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.candidatesTokenCount), unit: "token" });
  return [...byDimension.values()];
}
async function appendRwil({ proposal, completion, evidence, witness, disposition }) {
  const at = new Date().toISOString();
  const root = resolve(process.env.GEMINI_RWIL_ROOT ?? join(ROOT, "data"));
  const assertions = [
    ["urn:rmn:proposal", proposal], ["urn:rmn:completion", completion], ["urn:rmn:evidence", evidence],
    ["urn:rmn:witness", witness], ["urn:rmn:disposition", disposition], ["urn:prov:generatedAtTime", at]
  ].map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } }));
  return recordLocalRwil({ agentUrl: rwilAgent(), root, nodeId: "gemini-inference-team", batch: { settlement: ACCOUNT, graph: completion, recordedAt: at, document: relationalRwilDocument({ type: "InferenceExecutionWitness", proposal, completion, evidence, witness, disposition }), assertions } });
}
async function perform({ instruction, input, model, mode }) {
  if (!["dry-run", "live"].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (mode === "dry-run") return { disposition: "completion", text: "ready", usage: {} };
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.API_KEY_GOOGLE_GEMINI;
  if (!apiKey) throw new Error("Gemini credential is not present in the contracted executor process");
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({ model, contents: input, config: { systemInstruction: instruction } });
  const text = response.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("Gemini returned no text completion");
  return { disposition: "completion", text, usage: response.usageMetadata ?? {} };
}

export async function executeMessage(message) {
  if (message?.role !== "ROLE_USER") throw new Error("contracted Gemini executor requires an A2A ROLE_USER Message");
  const part = rawPart(message);
  const proposal = await conformCanonicalBytes({ agentUrl: rmnAgent(), bytes: Buffer.from(part.raw, "base64"), expectedType: ["product", ["effect"], OPERATION_TYPE], expectedNi: part.metadata?.ni });
  const cell = proposal.effectCell;
  if (cell.law !== LAW || cell.provider !== ACCOUNT || cell.scale !== "task") throw new Error("effect cell is not addressed to the Gemini team's law, account, and task scale");
  if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new Error("proposal effect must enter at FOUR-bottom");
  const operation = proposal.normalForm[2], marks = operationMarks(operation);
  let performed;
  try { performed = await perform(marks); }
  catch (error) { performed = { disposition: "refused", text: error.message, usage: {} }; }
  const evidenceTerm = ["mark", performed.text];
  const evidence = await conformTerm({ agentUrl: rmnAgent(), term: evidenceTerm, expectedType: ["mark"] });
  const completionCell = {
    ...cell, evidenceRoot: evidence.term,
    outcome: { positiveEvidence: performed.disposition === "completion", negativeEvidence: performed.disposition === "refused" },
    measures: measures(cell.measures, performed.usage)
  };
  const transition = await conformEffectTransition({ agentUrl: rmnAgent(), proposalCell: cell, completionCell, evidence: evidence.term });
  const completionTerm = ["pair", ["effect", completionCell], operation];
  const completion = await conformTerm({ agentUrl: rmnAgent(), term: completionTerm, expectedType: ["product", ["effect"], OPERATION_TYPE] });
  await appendRwil({ proposal: proposal.term, completion: completion.term, evidence: evidence.term, witness: transition.witness, disposition: performed.disposition });
  return {
    messageId: randomUUID(), role: "ROLE_AGENT",
    parts: [
      { raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.rmn.cbor", mediaType: "application/rmn+cbor" },
      { text: performed.text, metadata: { evidenceNi: evidence.term, disposition: performed.disposition }, mediaType: "text/plain" }
    ],
    metadata: { disposition: performed.disposition, proposalNi: proposal.term, completionNi: completion.term, witnessNi: transition.witness }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const message = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(await executeMessage(message))}\n`);
  } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
