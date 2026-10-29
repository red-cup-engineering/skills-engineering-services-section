#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { conformCanonicalBytes, conformEffectTransition, conformTerm } from "@emsenn/rmn-semantic-conformance/client";
import { recordLocalRwil, relationalRwilDocument } from "@emsenn/rwil-rdf-services/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HARNESS = resolve(ROOT, "run-one-exchange.mjs");
export const ACTOR = "urn:ame:claude-code-inference-team";
export const ACCOUNT = "eip155:31337:0x415bf4251c62b88ea8b004803ed1aded929660bd";
export const LAW = "ni:///sha-256;J5aoBVzHy53ojBrb0v3rcG51POl0F0JLXBu_yOn4JUM";
export const OPERATION_TYPE = ["product", ["mark"], ["product", ["mark"], ["product", ["mark"], ["mark"]]]];

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
function measures(prior, cost = {}) {
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "claude-code-cli-invocation" });
  if (Number.isFinite(cost["wall-time-seconds"])) byDimension.set("wall-time", { dimension: "wall-time", quantity: String(cost["wall-time-seconds"]), unit: "second" });
  return [...byDimension.values()];
}
async function appendRwil({ proposal, completion, evidence, witness, disposition }) {
  const at = new Date().toISOString();
  const root = resolve(process.env.CLAUDE_CODE_RWIL_ROOT ?? join(ROOT, "data"));
  const assertions = [
    ["urn:rmn:proposal", proposal], ["urn:rmn:completion", completion], ["urn:rmn:evidence", evidence],
    ["urn:rmn:witness", witness], ["urn:rmn:disposition", disposition], ["urn:prov:generatedAtTime", at],
  ].map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } }));
  return recordLocalRwil({ agentUrl: required("RWIL_RDF_AGENT"), root, nodeId: "claude-code-inference-team", batch: { settlement: ACCOUNT, graph: completion, recordedAt: at, document: relationalRwilDocument({ type: "InferenceExecutionWitness", proposal, completion, evidence, witness, disposition }), assertions } });
}
function perform({ instruction, input, model, mode }) {
  if (!['dry-run', 'live'].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  const temp = mkdtempSync(join(tmpdir(), "claude-rmn-inference-"));
  const packetPath = join(temp, "packet.json");
  const outputPath = join(temp, "result.json");
  const packet = { model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }], "max-tokens": 4000, ...(outputSchema(instruction) === undefined ? {} : { params: { outputSchema: outputSchema(instruction) } }) };
  try {
    writeFileSync(packetPath, `${JSON.stringify(packet)}\n`, "utf8");
    const execution = spawnSync(process.execPath, [HARNESS, packetPath, "--output-file", outputPath, ...(mode === "dry-run" ? ["--dry-run"] : [])], { cwd: ROOT, encoding: "utf8", timeout: mode === "dry-run" ? 60_000 : 920_000, env: process.env });
    if (execution.status !== 0) throw new Error((execution.stderr || execution.stdout || `Claude harness exited ${execution.status}`).slice(0, 1000));
    const result = JSON.parse(readFileSync(outputPath, "utf8"));
    if (mode === "dry-run") return { disposition: "completion", text: "ready", cost: {} };
    if (result.outcome !== "completion" || typeof result.recordPath !== "string") return { disposition: "refused", text: String(result.refusal?.grounds ?? "Claude provider refused the exchange"), cost: result.cost ?? {} };
    const exchange = JSON.parse(readFileSync(resolve(result.recordPath), "utf8"));
    if (exchange.outcome !== "completion" || typeof exchange.completion?.text !== "string" || exchange.completion.text.length === 0) return { disposition: "refused", text: "Claude exchange carried no completion text", cost: exchange.cost ?? result.cost ?? {} };
    return { disposition: "completion", text: exchange.completion.text, cost: exchange.cost ?? result.cost ?? {} };
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
  catch (error) { performed = { disposition: "refused", text: error instanceof Error ? error.message : String(error), cost: {} }; }
  const evidence = await conformTerm({ agentUrl: required("RMN_CONFORMANCE_AGENT"), term: ["mark", performed.text], expectedType: ["mark"] });
  const completionCell = { ...cell, evidenceRoot: evidence.term, outcome: { positiveEvidence: performed.disposition === "completion", negativeEvidence: performed.disposition === "refused" }, measures: measures(cell.measures, performed.cost) };
  const transition = await conformEffectTransition({ agentUrl: required("RMN_CONFORMANCE_AGENT"), proposalCell: cell, completionCell, evidence: evidence.term });
  const completion = await conformTerm({ agentUrl: required("RMN_CONFORMANCE_AGENT"), term: ["pair", ["effect", completionCell], operation], expectedType: ["product", ["effect"], OPERATION_TYPE] });
  await appendRwil({ proposal: proposal.term, completion: completion.term, evidence: evidence.term, witness: transition.witness, disposition: performed.disposition });
  return { messageId: randomUUID(), role: "ROLE_AGENT", parts: [
    { raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.rmn.cbor", mediaType: "application/rmn+cbor" },
    { text: performed.text, metadata: { evidenceNi: evidence.term, disposition: performed.disposition }, mediaType: "text/plain" },
  ], metadata: { disposition: performed.disposition, proposalNi: proposal.term, completionNi: completion.term, witnessNi: transition.witness } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
