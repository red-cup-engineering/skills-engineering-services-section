#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lazySettlementAccount } from "@red-cup-engineering/ethereum-engineering-services-section/settlement-account-binding";
import { TYPED_INFERENCE_OPERATION_TYPE, executeTypedInferenceEffect } from "@red-cup-engineering/computer-inference-engine/fabric/execute-typed-inference-effect";
import { executeOllamaToolExchange } from "./ollama-tool-exchange.mjs";
import { withProviderCapacity } from "@red-cup-engineering/computer-inference-engine/openai/provider-runtime";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(HERE, "..");
export const ACTOR = "urn:ame:bare-cedar-fog-npu-inference-team";
const settlementAccount = lazySettlementAccount(ROOT);
export function settlement() { return settlementAccount().settlement; }
export const OPERATION_TYPE = TYPED_INFERENCE_OPERATION_TYPE;
// Hierarchical-circuit-v3 law for the FOUR-bottom circuit shape.
export const LAW = "ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo";
export const MODEL = "qwen3:1.7b";
export const NPU_BOUNDS = Object.freeze({ workTypes: Object.freeze(["classification", "extraction", "summarization", "inquiry", "software-engineering"]), maximumSourceWords: 1500, maximumSourceCharacters: 12000, maximumRequestCharacters: 30000, maximumOutputTokens: 700 });

function measures(prior, performed) {
  const usage = performed.usage ?? {};
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "bare-cedar-fog-npu-request" });
  if (Number.isInteger(usage.prompt_tokens)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.prompt_tokens), unit: "token" });
  if (Number.isInteger(usage.completion_tokens)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.completion_tokens), unit: "token" });
  return [...byDimension.values()];
}
async function performBounded({ instruction, input, model, mode }) {
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
  const completion = await executeOllamaToolExchange({
    baseUrl,
    model,
    messages: [{ role: "system", content: instruction }, { role: "user", content: input }],
    maximumOutputTokens,
    contextTokens: 2_048,
    ...(format ? { format } : {}),
  });
  if (completion.usage.outputTokens > maximumOutputTokens) throw new Error("local Ollama substrate exceeded the contracted output bound");
  return {
    disposition: "completion",
    text: completion.text,
    usage: { prompt_tokens: completion.usage.promptTokens, completion_tokens: completion.usage.outputTokens },
  };
}
// Fail-fast local-silicon admission uses the shared kernel lease. Process death
// releases capacity; stale sentinel files cannot strand the provider.
async function perform(marks) {
  const lock = process.env.NPU_CAPACITY_LOCK ?? join(tmpdir(), "emsenn-bare-cedar-fog-npu-inference.capacity");
  return withProviderCapacity(lock, () => performBounded(marks), { wait: false });
}

export async function executeMessage(message, options = {}) {
  return executeTypedInferenceEffect(message, { providerLabel: "NPU", settlement, performInference: perform, measures }, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await executeMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
