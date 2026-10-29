#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettlementAccount } from "@red-cup-engineering/settlement-account-binding-service";
import { executeTypedInferenceEffect } from "@red-cup-engineering/computer-inference-system-services-section";
import { providerPacket } from "./provider-packet.mjs";

export { providerPacket } from "./provider-packet.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = resolve(ROOT, "run-one-exchange.mjs");
const LOCK = join(ROOT, "data", "openrouter-free-admission.lock");
const MODEL = "poolside/laguna-xs-2.1:free";
export const ACTOR = "urn:ame:openrouter-inference-team";
export const ACCOUNT = loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
export const OPERATION_TYPE = ["prod", ["base"], ["prod", ["base"], ["prod", ["base"], ["base"]]]];

function measures(prior, performed) {
  const usage = performed.usage ?? {};
  const values = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  values.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "openrouter-free-api-request" });
  if (Number.isInteger(usage.prompt_tokens)) values.set("input-token", { dimension: "input-token", quantity: String(usage.prompt_tokens), unit: "token" });
  if (Number.isInteger(usage.completion_tokens)) values.set("output-token", { dimension: "output-token", quantity: String(usage.completion_tokens), unit: "token" });
  values.set("cash-expense", { dimension: "cash-expense", quantity: "0", unit: "USD" });
  return [...values.values()];
}
function perform({ instruction, input, model, mode }) {
  if (!["dry-run", "live"].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (model !== MODEL) throw new Error(`OpenRouter free provider does not offer model ${model}`);
  const temp = mkdtempSync(join(tmpdir(), "openrouter-rmn-inference-")); const packet = join(temp, "packet.json");
  try {
    writeFileSync(packet, `${JSON.stringify(providerPacket({ instruction, input, model }))}\n`, { encoding: "utf8", mode: 0o600 });
    mkdirSync(dirname(LOCK), { recursive: true });
    const command = mode === "dry-run"
      ? [process.execPath, HARNESS, packet, "--dry-run"]
      : ["flock", "--exclusive", "--no-fork", LOCK, process.execPath, HARNESS, packet];
    const result = spawnSync(command[0], command.slice(1), { cwd: ROOT, env: process.env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`OpenRouter free harness refused before settlement: ${(result.stderr || result.error?.message || "no detail").trim()}`);
    const exchange = JSON.parse(result.stdout);
    if (mode === "dry-run") return { disposition: "completion", text: "ready", usage: {} };
    if (exchange.outcome === "refusal") return { disposition: "refused", text: exchange.refusal?.grounds ?? "OpenRouter refused the exchange", usage: {} };
    if (typeof exchange.completion?.text !== "string" || exchange.completion.text.length === 0) throw new Error("OpenRouter harness returned no text completion");
    return { disposition: "completion", text: exchange.completion.text, usage: exchange.completion.raw?.usage ?? {} };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
// The FOUR-bottom A2A/RMN orchestration is the shared
// @red-cup-engineering/computer-inference-system-services-section primitive;
// this team supplies only its settlement identity, its own model call, and
// its own measurement units (including the zero-cash-expense guard proof
// carried into the witness-journal document).
export async function executeMessage(message, options = {}) {
  return executeTypedInferenceEffect(message, {
    providerLabel: "OpenRouter", settlement: ACCOUNT, performInference: perform, measures,
    documentExtra: { zeroCashGuard: "free-key-and-zero-price-preflight" },
  }, options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; } }
