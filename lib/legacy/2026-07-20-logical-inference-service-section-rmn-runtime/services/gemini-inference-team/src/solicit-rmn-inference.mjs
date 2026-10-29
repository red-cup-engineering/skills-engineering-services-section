#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT, ACTOR, LAW, OPERATION_TYPE } from "./execute-rmn-inference.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const OFFER_UNIT = "relative-resolution-milliquanta-v1";
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const ni = (value) => `ni:///sha-256;${createHash("sha256").update(canonical(value)).digest("base64url")}`;
function response(type, source, object) { const core = { type, actor: ACTOR, target: source.actor, inReplyTo: source.id, object }; return { "@context": CONTEXT, id: ni(core), ...core }; }

export function solicit(source) {
  const demand = source?.object;
  if (source?.["@context"] !== CONTEXT || source.type !== "Offer" || source.target !== ACTOR || demand?.type !== "TypedRmnInferenceDemand") return response("Reject", source ?? {}, { type: "Refusal", reason: "exact ActivityStreams TypedRmnInferenceDemand solicitation required" });
  const required = demand.requiredCapabilities;
  if (!Array.isArray(required) || required.some((value) => typeof value !== "string")) return response("Reject", source, { type: "Refusal", reason: "requiredCapabilities must be an array of strings" });
  const capabilities = ["chat", "classification", "extraction", "summarization", "inquiry", "multimodal", "software-engineering", "code-review", "json-output", "json-schema-output"];
  const workTypes = ["chat", "classification", "extraction", "summarization", "inquiry", "software-engineering", "code-review"];
  const unsupported = required.filter((value) => !capabilities.includes(value));
  if (unsupported.length || !workTypes.includes(demand.workType)) return response("Reject", source, { type: "Refusal", reason: `unsupported Gemini demand: ${unsupported.join(",") || demand.workType}` });
  const agentCard = demand.agentCards?.[ACTOR];
  if (typeof agentCard !== "string" || !/^https?:\/\//u.test(agentCard)) return response("Reject", source, { type: "Refusal", reason: "customer must name this provider's exact A2A Agent Card URL" });
  const object = {
    type: "TypedRmnInferenceServiceOffer", contract: LAW, providerAccount: ACCOUNT, agentCard,
    operationType: OPERATION_TYPE, model: "gemini-3.1-flash-lite", mode: demand.mode ?? "live",
    workTypes, capabilities, maximumDifficulty: 0.85, maximumOutputTokens: 8192,
    consideration: { amount: 35, unit: OFFER_UNIT, monetaryClaim: false },
    requestCommitment: ni(demand), availability: "accepted-task-must-still-settle", customerAcceptanceRequired: true,
  };
  return response("Offer", source, object);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(solicit(JSON.parse(readFileSync(0, "utf8"))))}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
