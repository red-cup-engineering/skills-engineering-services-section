#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conformCanonicalBytes, conformTerm } from "@red-cup-engineering/relation-model-notation-conformance/client";
import { assayWitTransition } from "@lenticule-science/wit-transition-assay/client";
import { loadSettlementAccount, recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, ".."), HARNESS = resolve(ROOT, "run-one-exchange.mjs");
export const ACTOR = "urn:ame:nvidia-inference-team";
export const ACCOUNT = loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
export const OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
const MODEL = "meta/llama-3.1-8b-instruct";
export function runWithCapacityAdmission(executable, args, {
  lockPath = resolve(process.env.NVIDIA_CAPACITY_LOCK ?? join(ROOT, "data", "nvidia-request-slot.lock")),
  ...spawnOptions
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  return spawnSync("flock", ["--exclusive", "--no-fork", lockPath, executable, ...args], spawnOptions);
}
function requiredAgent(name) { const value = process.env[name]; if (!value) throw new Error(`${name} must name the hired provider's A2A 1.0 Agent Card`); return value; }
function rawPart(message) { const parts = (message.parts ?? []).filter((part) => part?.mediaType === "application/rmn+cbor" && typeof part.raw === "string"); if (parts.length !== 1) throw new Error("NVIDIA inference requires exactly one application/rmn+cbor A2A part"); return parts[0]; }
function operationMarks(term) { if (term?.[0] !== "pair" || term?.[1]?.[0] !== "mark" || term?.[2]?.[0] !== "pair" || term?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[0] !== "pair" || term?.[2]?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[2]?.[0] !== "mark") throw new Error("inference operation is not instruction/input/model/mode Marks"); return { instruction: term[1][1], input: term[2][1][1], model: term[2][2][1][1], mode: term[2][2][2][1] }; }
export function providerPacket({ instruction, input, model }) {
  let demand;
  try { demand = JSON.parse(input); }
  catch { throw new Error("typed inference input must be one JSON value"); }
  const outputContract = demand?.outputContract;
  const maximumOutputTokens = demand?.executionBounds?.maximumOutputTokens;
  if (!outputContract?.schema || typeof outputContract.schema !== "object" || Array.isArray(outputContract.schema)) {
    throw new Error("NVIDIA inference requires one customer output schema");
  }
  if (outputContract.format !== "json" && !(
    outputContract.format === "projected"
    && ["single-file-create", "single-source-artifact"].includes(outputContract.projection?.type)
    && typeof outputContract.projection?.path === "string"
    && outputContract.projection.path.length > 0
  )) {
    throw new Error("NVIDIA inference received an unsupported output carrier");
  }
  if (!Number.isInteger(maximumOutputTokens) || maximumOutputTokens < 1) {
    throw new Error("NVIDIA maximumOutputTokens must be a positive integer supplied by the consuming work lot");
  }
  let supplied;
  try { supplied = JSON.parse(demand?.context?.suppliedContext); }
  catch { supplied = null; }
  const conversation = Array.isArray(supplied?.messages)
    ? supplied.messages.filter(({ role, content }) => ["system", "user", "assistant"].includes(role) && typeof content === "string" && content.length > 0)
    : [];
  const systemMaterial = conversation.filter(({ role }) => role === "system").map(({ content }) => content);
  const turns = conversation.filter(({ role }) => role !== "system");
  const messages = turns.length
    ? [{ role: "system", content: [instruction, ...systemMaterial].join("\n\n") }, ...turns]
    : [{ role: "system", content: instruction }, { role: "user", content: input }];
  return {
    model,
    messages,
    "max-tokens": maximumOutputTokens,
    ...(outputContract.format === "json" ? { params: { guided_json: outputContract.schema } } : {}),
  };
}
function measures(prior, usage = {}) { const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure])); byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "nvidia-nim-api-request" }); if (Number.isInteger(usage.prompt_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.prompt_tokens), unit: "token" }); if (Number.isInteger(usage.completion_tokens)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.completion_tokens), unit: "token" }); return [...byDimension.values()]; }
async function appendWitnessJournal({ proposal, completion, evidence, witness, disposition }) { const at = new Date().toISOString(); const assertions = [["urn:rmn:proposal", proposal], ["urn:rmn:completion", completion], ["urn:rmn:evidence", evidence], ["urn:rmn:witness", witness], ["urn:rmn:disposition", disposition], ["urn:prov:generatedAtTime", at]].map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } })); return recordWitnessJournalBatch({ agentUrl: requiredAgent("WITNESS_JOURNAL_RDF_AGENT"), batch: { settlement: ACCOUNT, graph: completion, recordedAt: at, document: relationalWitnessJournalDocument({ type: "InferenceExecutionWitness", proposal, completion, evidence, witness, disposition }), assertions } }); }
function perform({ instruction, input, model, mode }) {
  if (!["dry-run", "live"].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (model !== MODEL) throw new Error(`NVIDIA provider does not offer model ${model}`);
  const temp = mkdtempSync(join(tmpdir(), "nvidia-rmn-inference-")), packet = join(temp, "packet.json");
  try {
    writeFileSync(packet, `${JSON.stringify(providerPacket({ instruction, input, model }))}\n`, "utf8");
    const result = runWithCapacityAdmission(process.execPath, [HARNESS, packet, ...(mode === "dry-run" ? ["--dry-run"] : [])], { cwd: ROOT, env: process.env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`NVIDIA harness or request-slot admission refused before settlement: ${(result.stderr || result.error?.message || "no detail").trim().slice(0, 500)}`);
    const exchange = JSON.parse(result.stdout);
    if (mode === "dry-run") return { disposition: "completion", text: "ready", usage: {} };
    if (exchange.outcome === "refusal") return { disposition: "refused", text: exchange.refusal?.grounds ?? "NVIDIA refused the exchange", usage: {} };
    if (typeof exchange.completion?.text !== "string" || exchange.completion.text.length === 0) throw new Error("NVIDIA harness returned no text completion");
    return { disposition: "completion", text: exchange.completion.text, usage: exchange.completion.raw?.usage ?? {} };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export async function executeMessage(message) {
  if (message?.role !== "ROLE_USER") throw new Error("contracted NVIDIA executor requires an A2A ROLE_USER Message"); const part = rawPart(message); const proposal = await conformCanonicalBytes({ agentUrl: requiredAgent("RMN_CONFORMANCE_AGENT"), bytes: Buffer.from(part.raw, "base64"), expectedType: ["product", ["effect"], OPERATION_TYPE], expectedNi: part.metadata?.ni }); const cell = proposal.effectCell; if (cell.provider !== ACCOUNT) throw new Error("effect cell is not addressed to the NVIDIA team's account and task scale"); if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new Error("proposal effect must enter at FOUR-bottom"); const operation = proposal.normalForm[2]; let performed; try { performed = perform(operationMarks(operation)); } catch (error) { performed = { disposition: "refused", text: error.message, usage: {} }; }
  const evidence = await conformTerm({ agentUrl: requiredAgent("RMN_CONFORMANCE_AGENT"), term: ["mark", performed.text], expectedType: ["mark"] }); const completionCell = { ...cell, evidenceRoot: evidence.term, outcome: { positiveEvidence: performed.disposition === "completion", negativeEvidence: performed.disposition === "refused" }, measures: measures(cell.measures, performed.usage) }; const transition = await assayWitTransition({ agentUrl: requiredAgent("WIT_TRANSITION_ASSAY_AGENT"), proposalCell: cell, completionCell, evidence: evidence.term }); const completion = await conformTerm({ agentUrl: requiredAgent("RMN_CONFORMANCE_AGENT"), term: ["pair", ["effect", completionCell], operation], expectedType: ["product", ["effect"], OPERATION_TYPE] }); await appendWitnessJournal({ proposal: proposal.term, completion: completion.term, evidence: evidence.term, witness: transition.witness, disposition: performed.disposition }); return { messageId: randomUUID(), role: "ROLE_AGENT", parts: [{ raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.rmn.cbor", mediaType: "application/rmn+cbor" }, { text: performed.text, metadata: { evidenceNi: evidence.term, disposition: performed.disposition }, mediaType: "text/plain" }], metadata: { disposition: performed.disposition, proposalNi: proposal.term, completionNi: completion.term, witnessNi: transition.witness } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; } }
