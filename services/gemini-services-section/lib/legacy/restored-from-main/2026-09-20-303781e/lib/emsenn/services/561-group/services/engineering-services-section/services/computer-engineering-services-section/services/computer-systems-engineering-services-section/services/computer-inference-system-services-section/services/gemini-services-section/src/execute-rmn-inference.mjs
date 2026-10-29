#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { loadSettlementAccount } from "@red-cup-engineering/settlement-account-binding-service";
import { executeTypedInferenceEffect, TYPED_INFERENCE_OPERATION_TYPE } from "@red-cup-engineering/computer-inference-system-services-section";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const ACTOR = "urn:ame:gemini-inference-team";
export const LAW = "ni:///sha-256;h2VIEZwYH__6vRnSgSWYRrFh1AHFcIBFboED8rlsGgo";
export const OPERATION_TYPE = TYPED_INFERENCE_OPERATION_TYPE;

export function settlementAccount() {
  return loadSettlementAccount(ROOT, { caip2: process.env.SETTLEMENT_CAIP2 }).settlement;
}

function geminiJsonSchema(value) {
  if (Array.isArray(value)) return value.map(geminiJsonSchema);
  if (!value || typeof value !== "object") return value;
  const projected = {};
  for (const [key, item] of Object.entries(value)) {
    if (["minLength", "maxLength"].includes(key)) continue;
    if (key === "enum" && Array.isArray(item) && (item.length > 16 || JSON.stringify(item).length > 4_000)) continue;
    if (key === "const") {
      projected.enum = [geminiJsonSchema(item)];
      continue;
    }
    projected[key] = geminiJsonSchema(item);
  }
  return projected;
}
export function providerRequest({ instruction, input, model }) {
  let demand;
  try { demand = JSON.parse(input); }
  catch { throw new Error("typed inference input must be one JSON value"); }
  const outputContract = demand?.outputContract;
  const maximumOutputTokens = demand?.executionBounds?.maximumOutputTokens;
  if (!outputContract?.schema || typeof outputContract.schema !== "object" || Array.isArray(outputContract.schema)) {
    throw new Error("Gemini inference requires one customer output schema");
  }
  const projected = outputContract.format === "projected"
    && ["single-file-create", "single-source-artifact"].includes(outputContract.projection?.type)
    && typeof outputContract.projection?.path === "string"
    && outputContract.projection.path.length > 0;
  const json = outputContract.format === "json";
  const jsonSchema = json && outputContract.mode === "json_schema";
  const naturalText = outputContract.format === "text";
  if (!projected && !json && !naturalText) {
    throw new Error("Gemini inference received an unsupported output carrier");
  }
  if (maximumOutputTokens !== undefined && (!Number.isSafeInteger(maximumOutputTokens) || maximumOutputTokens < 1)) {
    throw new Error("Gemini maximumOutputTokens, when purchased, must be a positive integer");
  }
  let supplied;
  try { supplied = JSON.parse(demand?.context?.suppliedContext); }
  catch { supplied = null; }
  const conversation = Array.isArray(supplied?.messages)
    ? supplied.messages.filter(({ role, content }) => ["system", "user", "assistant"].includes(role) && typeof content === "string" && content.length > 0)
    : [];
  const systemMaterial = conversation.filter(({ role }) => role === "system").map(({ content }) => content);
  const turns = conversation.filter(({ role }) => role !== "system")
    .map(({ role, content }) => ({ role: role === "assistant" ? "model" : "user", parts: [{ text: content }] }));
  return {
    model,
    contents: turns.length ? turns : input,
    config: {
      systemInstruction: [instruction, ...systemMaterial].join("\n\n"),
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(jsonSchema ? {
        responseJsonSchema: geminiJsonSchema(outputContract.schema),
      } : {}),
      ...(maximumOutputTokens === undefined ? {} : { maxOutputTokens: maximumOutputTokens }),
    },
  };
}
function measures(prior, performed) {
  const usage = performed.usage ?? {};
  const byDimension = new Map((prior ?? []).map((measure) => [measure.dimension, measure]));
  byDimension.set("provider-request", { dimension: "provider-request", quantity: "1", unit: "gemini-request" });
  if (Number.isInteger(usage.promptTokenCount)) byDimension.set("input-token", { dimension: "input-token", quantity: String(usage.promptTokenCount), unit: "token" });
  if (Number.isInteger(usage.candidatesTokenCount)) byDimension.set("output-token", { dimension: "output-token", quantity: String(usage.candidatesTokenCount), unit: "token" });
  return [...byDimension.values()];
}
async function perform({ instruction, input, model, mode }) {
  if (!["dry-run", "live"].includes(mode)) throw new Error("inference mode Mark must be dry-run or live");
  if (![instruction, input, model].every((part) => typeof part === "string" && part.length > 0)) throw new Error("instruction, input, and model Marks must be nonempty text");
  if (mode === "dry-run") return { disposition: "completion", text: "ready", usage: {}, finishReason: "dry-run" };
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.API_KEY_GOOGLE_GEMINI;
  if (!apiKey) throw new Error("Gemini credential is not present in the contracted executor process");
  const response = await new GoogleGenAI({ apiKey }).models.generateContent(providerRequest({ instruction, input, model }));
  const text = response.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("Gemini returned no text completion");
  return {
    disposition: "completion",
    text,
    usage: response.usageMetadata ?? {},
    finishReason: response.candidates?.[0]?.finishReason ?? "unknown",
  };
}

// Witnessed token usage: present only when Gemini's own response actually
// carried a usageMetadata object (never estimated). Denominated for this
// provider specifically -- never converted or summed with another
// provider's token counts.
function tokenUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const result = {};
  if (Number.isInteger(usage.promptTokenCount)) result.input = { quantity: usage.promptTokenCount, denomination: "google-ai-studio-tokens-in" };
  if (Number.isInteger(usage.candidatesTokenCount)) result.output = { quantity: usage.candidatesTokenCount, denomination: "google-ai-studio-tokens-out" };
  return Object.keys(result).length ? result : undefined;
}

function generateExchangeId() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = randomBytes(3).toString("hex");
  return `exchange-${stamp}-${rand}`;
}

// The complete exchange is an invocation result, not package residence.
// A caller may inject a sink (for a temporary test harness or a separately
// contracted receipt carrier), but production has no filesystem fallback.
export function exchangeEvidence({ instruction, input, model, startedAt, performed, error }) {
  const wallTimeSeconds = (performance.now() - startedAt) / 1000;
  const id = generateExchangeId();
  const recordedAt = new Date().toISOString();
  const packet = { model, messages: [{ role: "system", content: instruction }, { role: "user", content: input }] };
  const cost = { "fuel-consumed": 1, "wall-time-seconds": wallTimeSeconds, denomination: "google-ai-studio-api-requests" };
  const record = performed?.disposition === "completion"
    ? {
        id, recordedAt, packet, outcome: "completion",
        completion: { model, text: performed.text, "finish-reason": performed.finishReason ?? "unknown" },
        cost,
        ...(tokenUsage(performed.usage) ? { usage: tokenUsage(performed.usage) } : {}),
      }
    : {
        id, recordedAt, packet, outcome: "refusal",
        refusal: { grounds: (error ?? performed)?.message ?? performed?.text ?? "Gemini refused the exchange", unmet: ["gemini-sdk-refusal"] },
        cost,
      };
  return Object.freeze(record);
}

// The FOUR-bottom A2A/RMN orchestration, the injectable performInference/
// evidenceSink/settlement testing seams, and the exchange-evidence part are
// all the shared @red-cup-engineering/computer-inference-system-services-section
// primitive's own tested contract; this team supplies only its settlement
// identity, its own model call, and its own exchange-evidence shape.
export async function executeMessage(message, options = {}) {
  return executeTypedInferenceEffect(message, {
    providerLabel: "Gemini", settlement: settlementAccount, performInference: perform, measures,
    buildExtraEvidence: ({ instruction, input, model, startedAt, performed, error }) => exchangeEvidence({ instruction, input, model, startedAt, performed, error }),
  }, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const message = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(await executeMessage(message))}\n`);
  } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
