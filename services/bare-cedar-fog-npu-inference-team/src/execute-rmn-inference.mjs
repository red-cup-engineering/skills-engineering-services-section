#!/usr/bin/env node

import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { conformCanonicalBytes, conformTerm } from "@red-cup-engineering/relation-model-notation-conformance/client";
import { assayWitTransition } from "@lenticule-science/wit-transition-assay/client";
import { loadSettlementAccount, recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const ACTOR = "urn:ame:bare-cedar-fog-npu-inference-team";
export const ACCOUNT = loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
export const OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
export const MODEL = "qwen3:1.7b";
export const NPU_BOUNDS = Object.freeze({ workTypes: Object.freeze(["classification", "extraction", "summarization", "inquiry", "software-engineering"]), maximumSourceWords: 1500, maximumSourceCharacters: 12000, maximumRequestCharacters: 30000, maximumOutputTokens: 700 });

function capacityPath() { return process.env.NPU_CAPACITY_LOCK ?? join(tmpdir(), "emsenn-bare-cedar-fog-npu-inference.capacity"); }
export function acquireNpuCapacity() {
  const path = capacityPath();
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    return Object.freeze({ descriptor, path });
  } catch (error) {
    if (descriptor !== undefined) { try { closeSync(descriptor); } finally { rmSync(path, { force: true }); } }
    if (error?.code === "EEXIST") throw new Error("NPU provider-local concurrency bound is occupied");
    throw error;
  }
}
export function releaseNpuCapacity(lease) {
  if (!lease || typeof lease.descriptor !== "number" || typeof lease.path !== "string") throw new Error("one NPU capacity lease is required");
  try { closeSync(lease.descriptor); } finally { rmSync(lease.path, { force: true }); }
}

function rmnAgent() {
  if (!process.env.RMN_CONFORMANCE_AGENT) throw new Error("RMN_CONFORMANCE_AGENT must name the hired RMN provider's A2A 1.0 Agent Card");
  return process.env.RMN_CONFORMANCE_AGENT;
}
function witAgent() { if (!process.env.WIT_TRANSITION_ASSAY_AGENT) throw new Error("WIT_TRANSITION_ASSAY_AGENT must name the hired WIT transition provider's signed A2A 1.0 Agent Card"); return process.env.WIT_TRANSITION_ASSAY_AGENT; }
function witnessJournalAgent() { if (!process.env.WITNESS_JOURNAL_RDF_AGENT) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the hired witness-journal RDF provider's A2A 1.0 Agent Card"); return process.env.WITNESS_JOURNAL_RDF_AGENT; }
function rawPart(message) {
  const parts = (message.parts ?? []).filter((part) => part?.mediaType === "application/rmn+cbor" && typeof part.raw === "string");
  if (parts.length !== 1) throw new Error("NPU inference requires exactly one application/rmn+cbor A2A part");
  return parts[0];
}
function operationMarks(term) {
  if (term?.[0] !== "pair" || term?.[1]?.[0] !== "mark" || term?.[2]?.[0] !== "pair" || term?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[0] !== "pair" || term?.[2]?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[2]?.[0] !== "mark") throw new Error("inference operation is not instruction/input/model/mode Marks");
  return { instruction: term[1][1], input: term[2][1][1], model: term[2][2][1][1], mode: term[2][2][2][1] };
}
function measures(prior, usage = {}) {
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "bare-cedar-fog-npu-request" });
  if (Number.isInteger(usage.prompt_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.prompt_tokens), unit: "token" });
  if (Number.isInteger(usage.completion_tokens)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.completion_tokens), unit: "token" });
  return [...byDimension.values()];
}
async function appendWitnessJournal({ proposal, completion, evidence, witness, disposition }) {
  const at = new Date().toISOString();
  const root = resolve(process.env.NPU_WITNESS_JOURNAL_ROOT ?? join(ROOT, "data"));
  const assertions = [["urn:rmn:proposal", proposal], ["urn:rmn:completion", completion], ["urn:rmn:evidence", evidence], ["urn:rmn:witness", witness], ["urn:rmn:disposition", disposition], ["urn:prov:generatedAtTime", at]]
    .map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } }));
  return recordWitnessJournalBatch({ agentUrl: witnessJournalAgent(), batch: { settlement: ACCOUNT, graph: completion, recordedAt: at, document: relationalWitnessJournalDocument({ type: "InferenceExecutionWitness", proposal, completion, evidence, witness, disposition }), assertions } });
}
async function perform({ instruction, input, model, mode }) {
  if (!["dry-run", "live"].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (model !== MODEL) throw new Error(`NPU provider does not offer model ${model}`);
  let payload;
  try { payload = JSON.parse(input); } catch { throw new Error("NPU provider requires one bounded typed inference payload"); }
  if (!NPU_BOUNDS.workTypes.includes(payload?.workType)) throw new Error(`NPU provider does not offer work type ${payload?.workType ?? "missing"}`);
  if (instruction.length + input.length > NPU_BOUNDS.maximumRequestCharacters) throw new Error("NPU provider request exceeds its 30000-character envelope");
  const source = payload?.context?.suppliedContext;
  if (typeof source !== "string") throw new Error("NPU provider requires one exact suppliedContext string");
  const sourceWords = source.trim() === "" ? 0 : source.trim().split(/\s+/u).length;
  if (sourceWords < 1 || sourceWords > NPU_BOUNDS.maximumSourceWords || source.length > NPU_BOUNDS.maximumSourceCharacters) throw new Error("NPU provider source exceeds its nonempty 1500-word/12000-character bound");
  const maximumOutputTokens = payload?.executionBounds?.maximumOutputTokens;
  if (!Number.isInteger(maximumOutputTokens) || maximumOutputTokens < 1 || maximumOutputTokens > NPU_BOUNDS.maximumOutputTokens) throw new Error("NPU provider output request exceeds its 700-token bound");
  if (mode === "dry-run") return { disposition: "completion", text: "ready", usage: {} };
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/u, "");
  const outputContract = payload.outputContract;
  const format = outputContract?.mode === "json_schema" && outputContract.schema && typeof outputContract.schema === "object" ? outputContract.schema : undefined;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }], stream: false, think: false, options: { num_predict: maximumOutputTokens }, ...(format ? { format } : {}) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`local Ollama substrate refused with HTTP ${response.status}: ${body?.error ?? "no detail"}`);
  const text = body?.message?.content;
  if (typeof text !== "string" || text.length === 0) throw new Error("local Ollama substrate returned no text completion");
  if (Number.isInteger(body.eval_count) && body.eval_count > maximumOutputTokens) throw new Error("local Ollama substrate exceeded the contracted output bound");
  return { disposition: "completion", text, usage: { prompt_tokens: body.prompt_eval_count, completion_tokens: body.eval_count } };
}

export async function executeMessage(message) {
  if (message?.role !== "ROLE_USER") throw new Error("contracted NPU executor requires an A2A ROLE_USER Message");
  const part = rawPart(message);
  const proposal = await conformCanonicalBytes({ agentUrl: rmnAgent(), bytes: Buffer.from(part.raw, "base64"), expectedType: ["product", ["effect"], OPERATION_TYPE], expectedNi: part.metadata?.ni });
  const cell = proposal.effectCell;
  if (cell.provider !== ACCOUNT) throw new Error("effect cell is not addressed to the NPU team's account and task scale");
  if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new Error("proposal effect must enter at FOUR-bottom");
  const operation = proposal.normalForm[2], marks = operationMarks(operation);
  let performed, lease;
  try { lease = acquireNpuCapacity(); performed = await perform(marks); }
  catch (error) { performed = { disposition: "refused", text: error.message, usage: {} }; }
  finally { if (lease) releaseNpuCapacity(lease); }
  const evidenceTerm = ["mark", performed.text];
  const evidence = await conformTerm({ agentUrl: rmnAgent(), term: evidenceTerm, expectedType: ["mark"] });
  const completionCell = { ...cell, evidenceRoot: evidence.term, outcome: { positiveEvidence: performed.disposition === "completion", negativeEvidence: performed.disposition === "refused" }, measures: measures(cell.measures, performed.usage) };
  const transition = await assayWitTransition({ agentUrl: witAgent(), proposalCell: cell, completionCell, evidence: evidence.term });
  const completionTerm = ["pair", ["effect", completionCell], operation];
  const completion = await conformTerm({ agentUrl: rmnAgent(), term: completionTerm, expectedType: ["product", ["effect"], OPERATION_TYPE] });
  await appendWitnessJournal({ proposal: proposal.term, completion: completion.term, evidence: evidence.term, witness: transition.witness, disposition: performed.disposition });
  return { messageId: randomUUID(), role: "ROLE_AGENT", parts: [{ raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.rmn.cbor", mediaType: "application/rmn+cbor" }, { text: performed.text, metadata: { evidenceNi: evidence.term, disposition: performed.disposition }, mediaType: "text/plain" }], metadata: { disposition: performed.disposition, proposalNi: proposal.term, completionNi: completion.term, witnessNi: transition.witness } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
