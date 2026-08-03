import { randomUUID } from "node:crypto";
import { Message, Role } from "@a2a-js/sdk";
import { a2aResultMetadata, a2aResultParts, resumeRmnTask, sendRmnTask, submitRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import {
  SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION,
  circuitInterfaceFromAgentCard,
} from "./sovereign-provider-interface.mjs";
import { decodeJsonValue, identifyJsonValue, jsonValueId } from "./modern-rmn-carrier.mjs";
import { admitInferenceWorkOutput, admitInferenceWorkRequest } from "./inference-work-carriers.mjs";

const resultParts = a2aResultParts;

function requestBytes(value) {
  return identifyJsonValue(admitInferenceWorkRequest(value)).bytes;
}

function requestMessage(request) {
  const bytes = requestBytes(request);
  return {
    bytes,
    message: Message.toJSON({
      messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER,
      parts: [rmnPart(bytes, "inference-work-lot.rmn.cbor")],
      metadata: {}, extensions: [], referenceTaskIds: [],
    }),
  };
}

function settleInferenceExchange(exchange) {
  const output = extractRmnPart(resultParts(exchange.result));
  const decoded = decodeJsonValue(output.bytes);
  const result = admitInferenceWorkOutput(decoded.value);
  const provider = circuitInterfaceFromAgentCard(exchange.agentCard);
  const metadata = a2aResultMetadata(exchange.result);
  if (metadata.requestNi !== exchange.inputNi || metadata.resultNi !== exchange.outputNi) throw new Error("inference-work market did not bind the exact request and result");
  if (typeof result?.outcome !== "string" || result.integrationAccepted !== false) throw new Error("inference-work result must remain a bounded product or explicit residue without receiver integration authority");
  return Object.freeze({ result, resultNi: decoded.token, provider, exchange });
}

export async function submitInferenceWorkLot({ agentUrl, request, signal, submit = submitRmnTask }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("one absolute inference-work market Agent Card URL is required");
  const { message } = requestMessage(request);
  const submission = await submit({
    agentUrl,
    extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION],
    requireSignature: true,
    message,
    ...(signal ? { signal } : {}),
  });
  const provider = circuitInterfaceFromAgentCard(submission.agentCard);
  return Object.freeze({ agentUrl, taskId: submission.taskId, inputNi: submission.inputNi, provider, task: submission.task });
}

export async function resumeInferenceWorkLot({ agentUrl, taskId, inputNi, signal, resume = resumeRmnTask }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("one absolute inference-work market Agent Card URL is required");
  const exchange = await resume({
    agentUrl, taskId, inputNi,
    extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION],
    requireSignature: true,
    ...(signal ? { signal } : {}),
  });
  return settleInferenceExchange(exchange);
}

export async function requestInferenceWorkLot({ agentUrl, request, signal, send = sendRmnTask }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("one absolute inference-work market Agent Card URL is required");
  const { message } = requestMessage(request);
  const exchange = await send({
    agentUrl,
    extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION],
    requireSignature: true,
    message,
    ...(signal ? { signal } : {}),
  });
  return settleInferenceExchange(exchange);
}

function aborted(reason = "inference procurement aborted") {
  const error = new Error(typeof reason === "string" ? reason : "inference procurement aborted");
  error.name = "AbortError";
  return error;
}

function objectiveFor(job) {
  if (typeof job.objective === "string" && job.objective.trim().length > 0) return job.objective.trim();
  const user = [...(job.messages ?? [])].reverse().find(({ role, content }) => role === "user" && typeof content === "string")?.content?.trim();
  return user && user.length > 0 ? user : `Complete inference work lot ${job.id}`;
}

function stableLotId(prefix, value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("inference job requires one stable id");
  if (value.startsWith("urn:")) return value;
  return `urn:work-lot:${prefix}:${jsonValueId(value).split(";")[1]}`;
}

export function inferenceBatchRequest(job, { customer, purpose, desiredUse, workLotPrefix }) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new Error("one bounded inference job is required");
  const projection = job.customerProjection ?? job.outputContract?.projection;
  const schema = projection?.schema ?? job.outputContract?.schema;
  if (schema !== undefined && (typeof schema !== "object" || Array.isArray(schema))) throw new Error("inference job output schema must be an object when supplied");
  if (typeof customer !== "string" || !customer.startsWith("urn:")) throw new Error("inference batch requires one customer URN");
  const hasContextPacket = job.contextPacket !== undefined;
  if (hasContextPacket && (job.messages !== undefined || job.context !== undefined)) throw new Error("inference job must supply its context packet or loose context, never both");
  return {
    objective: objectiveFor(job),
    ...(hasContextPacket ? { contextPacket: job.contextPacket } : { context: JSON.stringify({ messages: job.messages ?? [], context: job.context, purpose }) }),
    desiredUse,
    workType: job.workType ?? "inquiry",
    taskClass: job.taskClass ?? job.workType ?? "inquiry",
    requiredCapabilities: job.requiredCapabilities ?? [],
    ...(Number.isFinite(job.difficulty) ? { difficulty: job.difficulty } : {}),
    ...(schema ? { outputSchema: schema } : {}),
    enforceProviderSchema: job.outputContract?.mode === "json_schema",
    ...(projection ? { outputProjection: projection } : {}),
    excludeProviders: job.excludeProviders ?? [],
    customer,
    workLotId: stableLotId(workLotPrefix, job.id),
    mode: job.mode ?? "live",
    ...(job.routingProfile ? { routingProfile: job.routingProfile } : {}),
    ...(job.extendedRoutingRationale ? { extendedRoutingRationale: job.extendedRoutingRationale } : {}),
    ...(job.considerationPolicy ? { considerationPolicy: job.considerationPolicy } : {}),
  };
}

async function requestBatchJob(job, options) {
  if (options.signal?.aborted) throw aborted(options.signal.reason);
  if (options.timeoutMs !== undefined) throw new Error("timeoutMs is retired; use an explicit customer cancellation signal or provider market refusal");
  const started = Date.now();
  const exchange = await (options.contract ?? requestInferenceWorkLot)({ agentUrl: options.agentUrl, request: inferenceBatchRequest(job, options), ...(options.signal ? { signal: options.signal } : {}), ...(options.send ? { send: options.send } : {}) });
  const result = exchange.result, latencyMs = Date.now() - started;
  if (!["candidate-pending-customer-acceptance", "candidate-pending-codex-acceptance"].includes(result.outcome)) {
    const refusedProvider = result.provider ?? result.settlementResidues?.[0]?.provider ?? null;
    return {
    id: job.id,
    provider: refusedProvider,
    attempts: (result.settlementResidues ?? []).map((residue) => ({ provider: residue.provider ?? null, outcome: "refusal", reason: residue.reason ?? residue.disposition, latencyMs })),
    refusal: {
      type: result.disposition ?? result.outcome,
      provider: result.provider ?? null,
      problems: Array.isArray(result.problems)
        ? result.problems.filter((problem) => typeof problem === "string")
        : [],
      schemaAssay: result.schemaAssay ?? result.evidence?.schemaAssay ?? null,
      considerationClose: result.considerationClose ?? null,
      considerationDisposition: result.considerationDisposition ?? null,
      market: result.refusedOffers ?? [],
      settlementResidues: result.settlementResidues ?? [],
    },
    latencyMs,
    procurement: {
      market: exchange.provider.account,
      result: exchange.resultNi,
      selectedOffer: result.selectedOffer ?? null,
      selectionRule: result.selectionRule ?? null,
      rankedFeasibleOffers: result.rankedFeasibleOffers ?? [],
      frontierInferenceCalls: result.settlementResidues?.length ? 1 : 0,
    },
  };
  }
  return {
    id: job.id, endpoint: result.provider, provider: result.provider, model: result.model,
    attempts: [{ provider: result.provider, outcome: "completion", consideration: result.consideration, latencyMs }],
    text: typeof result.candidate === "string" ? result.candidate : JSON.stringify(result.candidate), usage: null, cost: result.consideration,
    verification: { schemaAssay: result.evidence?.schemaAssay, schemaAccepted: true, customerUsefulnessAccepted: false, providerSelfAttestation: false },
    latencyMs, settlement: result.evidence?.settlement,
    procurement: { market: exchange.provider.account, request: exchange.exchange.inputNi, result: exchange.resultNi, selectedOffer: result.evidence?.selectedOffer, compact: result.evidence?.compact, providerProposal: result.evidence?.providerProposal, settlement: result.evidence?.settlement, receipt: result.evidence?.receipt, schemaAssay: result.evidence?.schemaAssay, considerationDisposition: result.considerationDisposition ?? null, selectionRule: result.selectionRule, rankedFeasibleOffers: result.rankedFeasibleOffers ?? [], taskClass: job.taskClass ?? job.workType ?? "inquiry", frontierInferenceCalls: 1 },
  };
}

export async function requestInferenceWorkBatch(jobs, options) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  if (options?.signal?.aborted) throw aborted(options.signal.reason);
  if (options?.concurrency !== undefined) throw new Error("concurrency is retired; provider-authored capacity and market refusal form execution pressure");
  const records = await Promise.all(jobs.map(async (job) => {
    try { return await requestBatchJob(job, options); }
    catch (error) { return { id: job?.id, attempts: [], refusal: { type: error.name === "AbortError" ? "aborted" : "market-transport-refusal", reason: error.message }, procurement: { frontierInferenceCalls: 0 } }; }
  }));
  if (options.signal?.aborted) throw aborted(options.signal.reason);
  return records;
}
