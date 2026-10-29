#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettlementAccount } from "@red-cup-engineering/settlement-account-binding-service";
import { executeTypedInferenceEffect } from "@red-cup-engineering/computer-inference-system-services-section";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HARNESS = resolve(ROOT, "run-one-exchange.mjs");
export const ACTOR = "urn:ame:groq-inference-team";
export const ACCOUNT = loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
export const OPERATION_TYPE = ["prod", ["base"], ["prod", ["base"], ["prod", ["base"], ["base"]]]];
const MODEL = "llama-3.1-8b-instant";
const RATE_POLICY = JSON.parse(readFileSync(join(ROOT, "content", "policies", "typed-inference-rate-capacity.json"), "utf8"));

export function runWithCapacityAdmission(executable, args, {
  lockPath = resolve(process.env.GROQ_CAPACITY_LOCK ?? join(ROOT, "data", "groq-request-slot.lock")),
  ...spawnOptions
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  return spawnSync("flock", ["--exclusive", "--no-fork", lockPath, executable, ...args], spawnOptions);
}

function measures(prior, performed) {
  const usage = performed.usage ?? {};
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "groq-api-request" });
  if (Number.isInteger(usage.prompt_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.prompt_tokens), unit: "token" });
  if (Number.isInteger(usage.completion_tokens)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.completion_tokens), unit: "token" });
  return [...byDimension.values()];
}

function perform({ instruction, input, model, mode }) {
  if (!["dry-run", "live"].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (model !== MODEL) throw new Error(`Groq provider does not offer model ${model}`);
  const intervalMs = Number(process.env.GROQ_INFERENCE_MIN_INTERVAL_MS ?? RATE_POLICY.minimumLiveExchangeIntervalMilliseconds);
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 180_000) throw new Error("GROQ_INFERENCE_MIN_INTERVAL_MS must be 0..180000");
  const temp = mkdtempSync(join(tmpdir(), "groq-rmn-inference-")); const packet = join(temp, "packet.json");
  try {
    writeFileSync(packet, `${JSON.stringify({ model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }] })}\n`, "utf8");
    const result = runWithCapacityAdmission(process.execPath, [HARNESS, packet, ...(mode === "dry-run" ? ["--dry-run"] : [])], { cwd: ROOT, env: { ...process.env, GROQ_INFERENCE_MIN_INTERVAL_MS: String(intervalMs) }, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Groq harness or request-slot admission refused before settlement: ${(result.stderr || result.error?.message || "no detail").trim()}`);
    const exchange = JSON.parse(result.stdout);
    if (mode === "dry-run") return { disposition: "completion", text: "ready", usage: {} };
    if (exchange.outcome === "refusal") return { disposition: "refused", text: exchange.refusal?.grounds ?? "Groq refused the exchange", usage: {} };
    if (typeof exchange.completion?.text !== "string" || exchange.completion.text.length === 0) throw new Error("Groq harness returned no text completion");
    return { disposition: "completion", text: exchange.completion.text, usage: exchange.completion.raw?.usage ?? {} };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

// The FOUR-bottom A2A/RMN orchestration (parse, conform, assay, witness,
// respond) is the shared @red-cup-engineering/computer-inference-system-services-section
// primitive; this team supplies only its settlement identity, its own
// model call, and its own measurement units.
export async function executeMessage(message, options = {}) {
  return executeTypedInferenceEffect(message, { providerLabel: "Groq", settlement: ACCOUNT, performInference: perform, measures }, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; } }
