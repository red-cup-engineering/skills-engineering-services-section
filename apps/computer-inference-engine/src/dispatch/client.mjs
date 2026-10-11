import { randomUUID } from "node:crypto";
import { a2aResultMetadata, a2aResultParts, bearerHeaderFromFile, sendMessage, getTask, TASK_STATE, isTerminalTaskState } from "@red-cup-engineering/a2a-services-section/a2a-client";
import { discoverValidatedAgentCard, extractSenPart, resumeSenTask, senPart, sendSenTask } from "@red-cup-engineering/a2a-services-section/sen-part";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, circuitInterfaceFromAgentCard } from "@red-cup-engineering/a2a-services-section/circuit-interface";
import { decodeJsonValue, identifyJsonValue, jsonValueId } from "./sen-carrier.mjs";
import { admitInferenceWorkOutput, admitInferenceWorkRequest } from "./inference-work-carriers.mjs";
import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";

const resultParts = a2aResultParts;

/** The market's fire-and-forget submission: hires the provider and returns
 * whatever it answers with -- a completed Message or a still-nonterminal
 * Task -- without waiting for generation to finish.
 * a2a-services-section's sen-part.mjs deliberately carries no equivalent
 * (its own durable outbound-custody idempotency records were dropped with
 * it); this is that same connect-then-send step, kept local to the one
 * caller here that actually wants a task it can resume later. */
async function submitSenTask({ agentUrl, message, requireSignature = false, bearerTokenFile, signal }) {
  const input = extractSenPart(message.parts);
  const agentCard = await discoverValidatedAgentCard(agentUrl, { requireSignature, signal });
  const headers = bearerTokenFile ? bearerHeaderFromFile(bearerTokenFile) : {};
  const task = await sendMessage(agentUrl, message, { headers, signal, configuration: { returnImmediately: true } });
  return { agentCard, taskId: task?.id, inputNi: input.ni, task };
}

function requestBytes(value) {
  return identifyJsonValue(admitInferenceWorkRequest(value)).bytes;
}

function attemptMessageId(attemptKey) {
  if (attemptKey === undefined) return randomUUID();
  if (typeof attemptKey !== "string" || attemptKey.trim() === "") throw new InferenceWorkLotClientError("configuration", "inference work-lot attempt key must be nonempty", { retryable: false });
  const bytes = sha256(attemptKey).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requestMessage(request, attemptKey) {
  const bytes = requestBytes(request);
  return {
    bytes,
    message: {
      messageId: attemptMessageId(attemptKey), contextId: "", taskId: "", role: "ROLE_USER",
      parts: [senPart(bytes, "inference-work-lot.sen.cbor")],
      metadata: {}, extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION], referenceTaskIds: [],
    },
  };
}

export class InferenceWorkLotClientError extends Error {
  constructor(condition, message, { retryable = false, evidence = {}, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "InferenceWorkLotClientError";
    this.condition = condition;
    this.retryable = retryable;
    this.evidence = Object.freeze({ ...evidence });
  }
}

function clientFailure(error, signal) {
  if (error instanceof InferenceWorkLotClientError) return error;
  if (signal?.aborted || error?.name === "AbortError") {
    return new InferenceWorkLotClientError("cancelled", "inference work-lot request was cancelled", { retryable: false, cause: error });
  }
  if (error?.name === "A2aTaskPendingError") {
    return new InferenceWorkLotClientError("pending", "inference work-lot request has a durable pending dependency", {
      retryable: true,
      evidence: {
        ...(typeof error.agentUrl === "string" ? { agentUrl: error.agentUrl } : {}),
        ...(typeof error.taskId === "string" ? { taskId: error.taskId } : {}),
      },
      cause: error,
    });
  }
  return new InferenceWorkLotClientError("rejected", "inference work-lot market transport refused the request", { retryable: false, cause: error });
}

function settleInferenceExchange(exchange) {
  const output = extractSenPart(resultParts(exchange.result));
  const decoded = decodeJsonValue(output.bytes);
  const result = admitInferenceWorkOutput(decoded.value);
  const provider = circuitInterfaceFromAgentCard(exchange.agentCard);
  const metadata = a2aResultMetadata(exchange.result);
  if (metadata.requestNi !== exchange.inputNi || metadata.resultNi !== exchange.outputNi) throw new Error("inference-work market did not bind the exact request and result");
  if (typeof result?.outcome !== "string" || result.integrationAccepted !== false) throw new Error("inference-work result must remain a bounded product or explicit residue without receiver integration authority");
  return Object.freeze({ result, resultNi: decoded.token, provider, exchange });
}

export async function submitInferenceWorkLot({ agentUrl, request, attemptKey, signal, submit = submitSenTask }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("one absolute inference-work market Agent Card URL is required");
  const { message } = requestMessage(request, attemptKey);
  const submission = await submit({
    agentUrl,
    requireSignature: true,
    message,
    ...(signal ? { signal } : {}),
  });
  const provider = circuitInterfaceFromAgentCard(submission.agentCard);
  return Object.freeze({ agentUrl, taskId: submission.taskId, inputNi: submission.inputNi, provider, task: submission.task });
}

export async function resumeInferenceWorkLot({ agentUrl, taskId, inputNi, signal, resume = resumeSenTask }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("one absolute inference-work market Agent Card URL is required");
  const exchange = await resume({
    agentUrl, taskId,
    requireSignature: true,
    ...(signal ? { signal } : {}),
  });
  // resumeSenTask reads the task once by id and carries no memory of the
  // original request's input coordinate; the caller already holds it from
  // when it first submitted the task, so it is restored here for
  // settleInferenceExchange's request/result binding check.
  return settleInferenceExchange({ ...exchange, inputNi });
}

export async function requestInferenceWorkLot({ agentUrl, request, attemptKey, signal, send = sendSenTask }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl)) throw new Error("one absolute inference-work market Agent Card URL is required");
  const { message } = requestMessage(request, attemptKey);
  let exchange;
  try {
    exchange = await send({
      agentUrl,
      requireSignature: true,
      message,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw clientFailure(error, signal);
  }
  try {
    return settleInferenceExchange(exchange);
  } catch (error) {
    throw new InferenceWorkLotClientError("malformed", "inference work-lot market returned an invalid bound result", { retryable: false, cause: error });
  }
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
  const exchange = await (options.contract ?? requestInferenceWorkLot)({ agentUrl: options.agentUrl, request: inferenceBatchRequest(job, options), ...(options.attemptKey ? { attemptKey: `${options.attemptKey}:${job.id}` } : {}), ...(options.signal ? { signal: options.signal } : {}), ...(options.send ? { send: options.send } : {}) });
  const result = exchange.result, latencyMs = Date.now() - started;
  if (!["candidate-pending-customer-acceptance", "candidate-pending-codex-acceptance"].includes(result.outcome)) {
    const refusedProvider = result.provider ?? result.settlementResidues?.[0]?.provider ?? null;
    return {
    id: job.id,
    provider: refusedProvider,
    attempts: (result.settlementResidues ?? []).map((residue) => ({ provider: residue.provider ?? null, outcome: residue.disposition ?? "market-residue", reason: residue.reason ?? residue.disposition, latencyMs })),
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
      marketRound: result.marketRound ?? null,
      routeDecision: result.routeDecision ?? null,
      marketWitnesses: result.marketWitnesses ?? [],
      providerSettlementAttempts: result.providerSettlementAttempts ?? 0,
      frontierInferenceCalls: result.frontierInferenceCalls ?? 0,
    },
  };
  }
  return {
    id: job.id, endpoint: result.provider, provider: result.provider, model: result.model,
    attempts: [{ provider: result.provider, outcome: "completion", consideration: result.consideration, latencyMs }],
    text: typeof result.candidate === "string" ? result.candidate : JSON.stringify(result.candidate), usage: null, cost: result.consideration,
    verification: { schemaAssay: result.evidence?.schemaAssay, schemaAccepted: true, customerUsefulnessAccepted: false, providerSelfAttestation: false },
    latencyMs, settlement: result.evidence?.settlement,
    procurement: { market: exchange.provider.account, request: exchange.exchange.inputNi, result: exchange.resultNi, selectedOffer: result.evidence?.selectedOffer, compact: result.evidence?.compact, providerProposal: result.evidence?.providerProposal, settlement: result.evidence?.settlement, receipt: result.evidence?.receipt, schemaAssay: result.evidence?.schemaAssay, considerationDisposition: result.considerationDisposition ?? null, selectionRule: result.selectionRule, rankedFeasibleOffers: result.rankedFeasibleOffers ?? [], marketRound: result.marketRound ?? null, routeDecision: result.routeDecision ?? null, marketWitnesses: result.marketWitnesses ?? [], providerSettlementAttempts: result.providerSettlementAttempts ?? 1, taskClass: job.taskClass ?? job.workType ?? "inquiry", frontierInferenceCalls: result.frontierInferenceCalls ?? 1 },
  };
}

export async function requestInferenceWorkBatch(jobs, options) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  if (options?.signal?.aborted) throw aborted(options.signal.reason);
  if (options?.concurrency !== undefined) throw new Error("concurrency is retired; provider-authored capacity and market refusal form execution pressure");
  const records = await Promise.all(jobs.map(async (job) => {
    try { return await requestBatchJob(job, options); }
    catch (error) { return { id: job?.id, attempts: [], refusal: { type: error.condition === "cancelled" || error.name === "AbortError" ? "aborted" : "market-transport-refusal", condition: error.condition ?? "rejected", retryable: error.retryable === true, reason: error.message, evidence: error.evidence ?? {} }, procurement: { frontierInferenceCalls: 0 } }; }
  }));
  if (options.signal?.aborted) throw aborted(options.signal.reason);
  return records;
}

// read a task once and return the validated agent card and task object
async function readSenTask({ agentUrl, taskId, signal }) {
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl))
    throw new Error("one absolute inference‑work market Agent Card URL is required");
  if (typeof taskId !== "string" || taskId.trim() === "")
    throw new Error("a non‑empty taskId string is required");

  const agentCard = await discoverValidatedAgentCard(agentUrl, { requireSignature: true, signal });
  const task = await getTask(agentUrl, taskId, { signal });
  return { agentCard, task };
}

// observe the state of an already‑submitted inference work‑lot task (no polling)
export async function observeInferenceWorkLot({ agentUrl, taskId, inputNi, customer, signal, read = readSenTask }) {
  // argument validation
  if (typeof agentUrl !== "string" || !/^https?:\/\//u.test(agentUrl))
    throw new Error("one absolute inference‑work market Agent Card URL is required");
  if (typeof taskId !== "string" || taskId.trim() === "")
    throw new Error("a non‑empty taskId string is required");
  if (typeof inputNi !== "string" || inputNi.trim() === "")
    throw new Error("a non‑empty input NI string is required");
  if (typeof customer !== "string" || customer.trim() === "")
    throw new Error("a non‑empty customer URI string is required");

  // read the task exactly once
  const { agentCard, task } = await read({ agentUrl, taskId, signal });
  if (!task || task.id !== taskId) throw new Error("retrieved task does not match the requested taskId");

  // validate the original request appears as the first USER message
  const firstUserMsg = (Array.isArray(task.history) ? task.history : []).find(msg => msg.role === "ROLE_USER");
  if (!firstUserMsg) throw new Error("task history lacks a USER request message");
  const extracted = extractSenPart(firstUserMsg.parts);
  if (extracted.ni !== inputNi) throw new Error("the input NI in the task history does not match the supplied inputNi");

  const decoded = decodeJsonValue(extracted.bytes);
  const request = admitInferenceWorkRequest(decoded.value);
  if (request.customer !== customer) throw new Error("the request's customer URI does not match the supplied customer");

  // provider and state
  const provider = circuitInterfaceFromAgentCard(agentCard);
  const state = task.status?.state;
  if (!Object.values(TASK_STATE).includes(state))
    throw new Error("task.status.state is not a recognized TASK_STATE value");

  // non‑terminal
  if (!isTerminalTaskState(state)) {
    return Object.freeze({ outcome: "provider-task-pending", taskId, inputNi, provider, state });
  }

  // terminal but not completed
  if (state !== TASK_STATE.COMPLETED) {
    return Object.freeze({ outcome: "provider-task-terminal", taskId, inputNi, provider, state, task });
  }

  // completed
  const output = extractSenPart(a2aResultParts(task));
  const exchange = { result: task, outputNi: output.ni, inputNi, taskId, agentCard };
  return Object.freeze({ outcome: "provider-task-delivered", taskId, inputNi, state, ...settleInferenceExchange(exchange) });
}
