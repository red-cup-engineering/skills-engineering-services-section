#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettlementAccount } from "@red-cup-engineering/settlement-account-binding-service";
import { executeTypedInferenceEffect } from "@red-cup-engineering/computer-inference-system-services-section";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, ".."), HARNESS = resolve(ROOT, "run-one-exchange.mjs");
export const ACTOR = "urn:ame:nvidia-inference-team";
export const ACCOUNT = loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
export const OPERATION_TYPE = ["prod", ["base"], ["prod", ["base"], ["prod", ["base"], ["base"]]]];
const MODEL = "meta/llama-3.1-8b-instruct";
export function runWithCapacityAdmission(executable, args, {
  lockPath = resolve(process.env.NVIDIA_CAPACITY_LOCK ?? join(ROOT, "data", "nvidia-request-slot.lock")),
  ...spawnOptions
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  return spawnSync("flock", ["--exclusive", "--no-fork", lockPath, executable, ...args], spawnOptions);
}
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
function measures(prior, performed) {
  const usage = performed.usage ?? {};
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "nvidia-nim-api-request" });
  if (Number.isInteger(usage.prompt_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.prompt_tokens), unit: "token" });
  if (Number.isInteger(usage.completion_tokens)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.completion_tokens), unit: "token" });
  return [...byDimension.values()];
}
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
// The FOUR-bottom A2A/RMN orchestration is the shared
// @red-cup-engineering/computer-inference-system-services-section primitive;
// this team supplies only its settlement identity, its own model call, and
// its own measurement units.
export async function executeMessage(message, options = {}) {
  return executeTypedInferenceEffect(message, { providerLabel: "NVIDIA", settlement: ACCOUNT, performInference: perform, measures }, options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; } }
