#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { conformCanonicalBytes, conformTerm } from "@red-cup-engineering/relation-model-notation-conformance/client";
import { assayWitTransition } from "@lenticule-science/wit-transition-assay/client";
import { loadSettlementAccount, recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-rdf-projection-service/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HARNESS = resolve(ROOT, "run-one-exchange.mjs");
export const ACTOR = "urn:ame:claude-code-inference-team";
export const ACCOUNT = loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
export const LAW = "ni:///sha-256;J5aoBVzHy53ojBrb0v3rcG51POl0F0JLXBu_yOn4JUM";
export const OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];
const MODEL = "claude-sonnet-4-6";

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} must name the hired provider`); return value; }
function rawPart(message) {
  const parts = (message.parts ?? []).filter((part) => part?.mediaType === "application/rmn+cbor" && typeof part.raw === "string");
  if (parts.length !== 1) throw new Error("Claude inference requires exactly one application/rmn+cbor A2A part");
  return parts[0];
}
function operationMarks(term) {
  if (term?.[0] !== "pair" || term?.[1]?.[0] !== "mark" || term?.[2]?.[0] !== "pair" || term?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[0] !== "pair" || term?.[2]?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[2]?.[0] !== "mark") throw new Error("inference operation is not instruction/input/model/mode Marks");
  return { instruction: term[1][1], input: term[2][1][1], model: term[2][2][1][1], mode: term[2][2][2][1] };
}
function outputSchema(instruction) {
  const marker = "\n\nOUTPUT SCHEMA:\n";
  const at = instruction.lastIndexOf(marker);
  if (at < 0) return undefined;
  try { return JSON.parse(instruction.slice(at + marker.length)); }
  catch { throw new Error("declared output schema is not valid JSON"); }
}
function measures(prior, cost = {}, usage = {}) {
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "claude-code-cli-invocation" });
  if (Number.isFinite(cost["wall-time-seconds"])) byDimension.set("wall-time", { dimension: "wall-time", quantity: String(cost["wall-time-seconds"]), unit: "second" });
  if (Number.isInteger(usage.input_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.input_tokens), unit: "token" });
  if (Number.isInteger(usage.output_tokens)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.output_tokens), unit: "token" });
  return [...byDimension.values()];
}
async function appendWitnessJournal({ proposal, completion, evidence, witness, disposition }) {
  const at = new Date().toISOString();
  const root = resolve(process.env.CLAUDE_CODE_WITNESS_JOURNAL_ROOT ?? join(ROOT, "data"));
  const assertions = [
    ["urn:rmn:proposal", proposal], ["urn:rmn:completion", completion], ["urn:rmn:evidence", evidence],
    ["urn:rmn:witness", witness], ["urn:rmn:disposition", disposition], ["urn:prov:generatedAtTime", at],
  ].map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } }));
  return recordWitnessJournalBatch({ agentUrl: required("WITNESS_JOURNAL_RDF_AGENT"), batch: { settlement: ACCOUNT, graph: completion, recordedAt: at, document: relationalWitnessJournalDocument({ type: "InferenceExecutionWitness", proposal, completion, evidence, witness, disposition }), assertions } });
}
function perform({ instruction, input, model, mode }) {
  if (!['dry-run', 'live'].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (model !== MODEL) throw new Error(`Claude provider does not offer model ${model}`);
  const temp = mkdtempSync(join(tmpdir(), "claude-rmn-inference-"));
  const packetPath = join(temp, "packet.json");
  const packet = { model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }], ...(outputSchema(instruction) === undefined ? {} : { params: { outputSchema: outputSchema(instruction) } }) };
  try {
    writeFileSync(packetPath, `${JSON.stringify(packet)}\n`, "utf8");
    const execution = spawnSync(process.execPath, [HARNESS, packetPath, ...(mode === "dry-run" ? ["--dry-run"] : [])], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    });
    if (execution.status !== 0) throw new Error(execution.stderr || execution.stdout || `Claude harness exited ${execution.status}`);
    const result = JSON.parse(execution.stdout);
    if (mode === "dry-run") return { disposition: "completion", text: "ready", cost: {}, usage: {} };
    if (result.outcome !== "completion") return { disposition: "refused", text: String(result.refusal?.grounds ?? "Claude provider refused the exchange"), cost: result.cost ?? {}, usage: {} };
    if (typeof result.completion?.text !== "string" || result.completion.text.length === 0) return { disposition: "refused", text: "Claude exchange carried no completion text", cost: result.cost ?? {}, usage: {} };
    // result.usage is the harness's own witnessed token usage (see
    // run-one-exchange.mjs's tokenUsage()) -- present only when the claude
    // CLI's own JSON output actually carried a usage object. It is
    // {input:{quantity,denomination},output:{quantity,denomination}} shaped,
    // not the raw CLI usage object, so unwrap the quantities for measures().
    const usage = {
      input_tokens: result.usage?.input?.quantity,
      output_tokens: result.usage?.output?.quantity,
    };
    return { disposition: "completion", text: result.completion.text, cost: result.cost ?? {}, usage };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export async function executeMessage(message) {
  if (message?.role !== "ROLE_USER") throw new Error("contracted Claude executor requires an A2A ROLE_USER Message");
  const part = rawPart(message);
  const proposal = await conformCanonicalBytes({ agentUrl: required("RMN_CONFORMANCE_AGENT"), bytes: Buffer.from(part.raw, "base64"), expectedType: ["product", ["effect"], OPERATION_TYPE], expectedNi: part.metadata?.ni });
  const cell = proposal.effectCell;
  if (cell.law !== LAW || cell.provider !== ACCOUNT) {
    throw new Error(`effect cell targets law ${String(cell.law)} and provider ${String(cell.provider)}; the Claude team currently offers law ${LAW} at ${ACCOUNT}`);
  }
  if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new Error("proposal effect must enter at FOUR-bottom");
  const operation = proposal.normalForm[2];
  let performed;
  try { performed = perform(operationMarks(operation)); }
  catch (error) { performed = { disposition: "refused", text: error instanceof Error ? error.message : String(error), cost: {}, usage: {} }; }
  const evidence = await conformTerm({ agentUrl: required("RMN_CONFORMANCE_AGENT"), term: ["mark", performed.text], expectedType: ["mark"] });
  const completionCell = { ...cell, evidenceRoot: evidence.term, outcome: { positiveEvidence: performed.disposition === "completion", negativeEvidence: performed.disposition === "refused" }, measures: measures(cell.measures, performed.cost, performed.usage) };
  const transition = await assayWitTransition({ agentUrl: required("WIT_TRANSITION_ASSAY_AGENT"), proposalCell: cell, completionCell, evidence: evidence.term });
  const completion = await conformTerm({ agentUrl: required("RMN_CONFORMANCE_AGENT"), term: ["pair", ["effect", completionCell], operation], expectedType: ["product", ["effect"], OPERATION_TYPE] });
  await appendWitnessJournal({ proposal: proposal.term, completion: completion.term, evidence: evidence.term, witness: transition.witness, disposition: performed.disposition });
  return { messageId: randomUUID(), role: "ROLE_AGENT", parts: [
    { raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.rmn.cbor", mediaType: "application/rmn+cbor" },
    { text: performed.text, metadata: { evidenceNi: evidence.term, disposition: performed.disposition }, mediaType: "text/plain" },
  ], metadata: { disposition: performed.disposition, proposalNi: proposal.term, completionNi: completion.term, witnessNi: transition.witness } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
