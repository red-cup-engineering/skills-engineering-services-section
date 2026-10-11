/** Unary bounded-inference source over the contracted inference-work-lot market. */
import {
  InferenceWorkLotClientError,
  requestInferenceWorkLot,

} from "@red-cup-engineering/computer-inference-engine/dispatch/client";
import { CHAT_COMPLETION_TURN_INPUT_SCHEMA } from "@red-cup-engineering/computer-inference-engine/openai/chat-turn-contract";
import {
  constraintSchemaOf,
  inferenceMessage,
  inferenceObstruction,
  inferenceResult,
} from "./inference-model.mjs";
import {
  inferenceSourceMove,
  inferenceSourceTerminal,
  inferenceStreamMove,

} from "./inference-source-kind.mjs";
import { requireJsonValue } from "@red-cup-engineering/json-services-section";
import { assertNonemptyString as nonempty } from "@red-cup-engineering/json-services-section/assert-nonempty-string";
import { inferenceCallToOpenAIChat, inferenceResultFromOpenAIChat } from "../openai/chat-completions/inference.mjs";

export const BOUNDED_INFERENCE_SERVICE_MODEL = "metroplat/bounded-inference";

/** Keep receiver quality observations for a canonical office work apart from generic probes. */
export function officeWorkInferenceTaskClass(work) {
  if (typeof work !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(work)) throw new TypeError("office work inference requires a canonical work identifier");
  return `metroplat/office-work/${work}`;
}
export const METROPLAT_INFERENCE_MARKET_CUSTOMER = "urn:ame:metroplat";
export const INFERENCE_WORK_LOT_CONFIGURATION_IDENTITY_EXTENSION = "inference-work-lot.configuration-identity";

function standardAgentCardUrl(value) {
  const url = new URL(nonempty(value, "inference-work-lot Agent Card URL", "nonempty text"));
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    || !url.pathname.endsWith("/.well-known/agent-card.json") || url.search !== "" || url.hash !== "") {
    throw new TypeError("inference-work-lot market must name one HTTPS standard Agent Card URL (HTTP is allowed only for loopback)");
  }
  return url;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? requireJsonValue(value, "inference-work-lot evidence")
    : undefined;
}

const CHAT_COMPLETION_FIELDS = new Set([
  ...Object.keys(CHAT_COMPLETION_TURN_INPUT_SCHEMA.properties),
]);
const CALLER_EXTENSION_FIELDS = new Set([...CHAT_COMPLETION_FIELDS].filter((field) => field !== "messages" && field !== "tools"));

export function chatCompletionOf(call) {
  const wire = inferenceCallToOpenAIChat(call);
  const completion = {};
  for (const [name, value] of Object.entries(wire)) {
    if (CHAT_COMPLETION_FIELDS.has(name) && value !== undefined) completion[name] = requireJsonValue(value, `OpenAI chat ${name}`);
  }
  return Object.keys(completion).length === 0 ? undefined : Object.freeze(completion);
}

export function unsupported(call) {
  const reasons = [];
  const extensions = call.extensions ?? {};
  const foreignExtensions = Object.keys(extensions).filter((name) => name !== "openai.chat-completions.request");
  if (foreignExtensions.length > 0) reasons.push(`bounded inference market cannot preserve extension namespaces: ${foreignExtensions.join(", ")}`);
  const requestExtension = extensions["openai.chat-completions.request"];
  if (requestExtension !== undefined) {
    const recordExtension = record(requestExtension);
    if (recordExtension === undefined) reasons.push("bounded inference market requires an object OpenAI chat request extension");
    else {
      const unsupportedFields = Object.keys(recordExtension).filter((field) => !CALLER_EXTENSION_FIELDS.has(field));
      if (unsupportedFields.length > 0) reasons.push(`bounded inference market cannot preserve OpenAI request fields: ${unsupportedFields.join(", ")}`);
    }
  }
  try {
    chatCompletionOf(call);
  } catch {
    reasons.push("bounded inference market cannot preserve this call as one standard OpenAI chat completion");
  }
  return Object.freeze(reasons);
}

function objectiveOf(call) {
  const user = [...call.messages].reverse().find((message) => message.role === "user" && typeof message.content === "string" && message.content.trim().length > 0);
  return user?.content?.trim() ?? `Complete bounded inference work lot ${call.id}`;
}

function boundedAgentBounds(call, options) {
  const configured = options.agentBounds ?? {};
  const ceilings = [call.generation?.maxOutputTokens, configured.maximumTokensPerRequest, configured.maximumOutputTokens]
    .filter((value) => value !== undefined);
  const output = ceilings.length === 0 ? undefined : Math.min(...ceilings);
  // One canonical inference request per turn. FeltOS owns witnessed tool
  // execution and the duty-wide budget; a provider can choose only from the
  // caller's already-authorized tool surface. Nested delegation stays closed.
  return Object.freeze({
    ...configured,
    maximumRequests: Math.min(configured.maximumRequests ?? 1, 1),
    maximumToolCalls: configured.maximumToolCalls ?? 0,
    maximumDepth: 0,
    maximumToolRounds: configured.maximumToolRounds ?? 6,
    ...(output === undefined ? {} : { maximumTokensPerRequest: output, maximumOutputTokens: output }),
  });
}

function implementationAffinity(call, configured)

 {
  const identities = new Set();
  for (const message of call.messages) for (const move of message.toolMoves ?? []) {
    const extension = move.extensions?.[INFERENCE_WORK_LOT_CONFIGURATION_IDENTITY_EXTENSION];
    if (extension === undefined) continue;
    const binding = record(extension);
    if (binding === undefined || typeof binding.configurationIdentity !== "string" || binding.configurationIdentity.trim() === "") {
      return { reason: "bounded inference market requires a nonempty configuration identity on each tool-move affinity binding" };
    }
    identities.add(binding.configurationIdentity);
  }
  if (identities.size > 1) return { reason: "bounded inference market cannot continue tool moves bound to conflicting implementation identities" };
  const transcriptIdentity = identities.values().next().value;
  const configuredIdentity = configured?.requiredImplementationIdentity;
  if (configuredIdentity !== undefined && typeof configuredIdentity !== "string") {
    return { reason: "bounded inference market requires a nonempty configured implementation identity" };
  }
  if (configuredIdentity !== undefined && configuredIdentity.trim() === "") {
    return { reason: "bounded inference market requires a nonempty configured implementation identity" };
  }
  if (transcriptIdentity !== undefined && configuredIdentity !== undefined && transcriptIdentity !== configuredIdentity) {
    return { reason: "bounded inference market cannot merge conflicting configured and transcript implementation identities" };
  }
  const requiredImplementationIdentity = transcriptIdentity ?? configuredIdentity;
  return requiredImplementationIdentity === undefined
    ? {}
    : { requiredImplementationIdentity };
}

function workPlacementOf(call, options)

 {
  const affinity = implementationAffinity(call, options.workPlacement);
  if (affinity.reason !== undefined) return affinity;
  if (affinity.requiredImplementationIdentity === undefined) return { ...(options.workPlacement === undefined ? {} : { workPlacement: options.workPlacement }) };
  return {
    workPlacement: Object.freeze({
      ...(options.workPlacement ?? {}),
      requiredImplementationIdentity: affinity.requiredImplementationIdentity,
    }),
  };
}

/** One request policy for local and network delivery of the same inference call. */
export function inferenceWorkLotRequest(call, options, customer = options.customer ?? METROPLAT_INFERENCE_MARKET_CUSTOMER) {
  const placement = workPlacementOf(call, options);
  if (placement.reason !== undefined) return placement;
  const workPlacement = placement.workPlacement;
  const agentBounds = boundedAgentBounds(call, options);
  // The call's codomain becomes the market's output contract, so dispatch states it to each provider
  // in that provider's form (or assays the reply where none decodes under a schema), never one wire's.
  const schema = constraintSchemaOf(call.responseConstraint);
  const wire = chatCompletionOf(call);
  const chatCompletion = schema === undefined || wire === undefined ? wire
    : Object.freeze(Object.fromEntries(Object.entries(wire).filter(([name]) => name !== "response_format")));
  return Object.freeze({
    objective: objectiveOf(call),
    desiredUse: options.desiredUse,
    workType: options.workType ?? "chat",
    taskClass: call.caller?.transport === "agent-worker" && call.caller.work !== undefined
      ? officeWorkInferenceTaskClass(call.caller.work) : options.taskClass ?? "metroplat/bounded-inference",
    requiredCapabilities: Object.freeze([...(options.requiredCapabilities ?? [])]),
    ...(options.difficulty === undefined ? {} : { difficulty: options.difficulty }),
    customer,
    workLotId: call.id,
    mode: options.mode ?? "live",
    ...(options.considerationPolicy === undefined ? {} : { considerationPolicy: options.considerationPolicy }),
    ...(options.routingProfile === undefined ? {} : { routingProfile: options.routingProfile }),
    ...(options.extendedRoutingRationale === undefined ? {} : { extendedRoutingRationale: options.extendedRoutingRationale }),
    ...(options.zeroCashOnly === undefined ? {} : { zeroCashOnly: options.zeroCashOnly }),
    ...(agentBounds === undefined ? {} : { agentBounds }),
    ...(workPlacement === undefined ? {} : { workPlacement }),
    ...(schema === undefined ? {} : { outputSchema: schema, enforceProviderSchema: true }),
    // The order the caller's work item makes (organizing work/schema orderOfItem): misses are its.
    ...(typeof call.caller?.order === "string" && call.caller.order !== "" ? { order: call.caller.order } : {}),
    chatCompletion,
  });
}

function clientFailureOf(error) {
  const condition = error.condition;
  switch (condition) {
    case "configuration": case "unauthorized": case "unreachable": case "rate-limited":
    case "rejected": case "malformed": case "cancelled":
      return { condition, retryable: error.retryable, reason: `inference-work-lot client reported a ${condition} failure` };
    case "pending":
      return { condition: "unreachable", retryable: true, reason: "inference-work-lot market retained a durable pending dependency" };
    default:
      return { condition: "malformed", retryable: false, reason: "inference-work-lot client reported an unknown failure condition" };
  }
}

function canonicalSha256Ni(value) {
  return typeof value === "string" && /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(value);
}

/** Exact delivery identity, shared by local and network inference sources.
 * Absence stays unknown; exchange custody cannot stand in for delivery. */
export function inferenceWorkLotDelivery(call, request, result) {
  if (result.receipt === undefined) return undefined;
  const receipt = record(result.receipt)?.id;
  if (!canonicalSha256Ni(receipt) || result.workLot !== call.id
    || result.receiver !== request.customer || result.taskClass !== request.taskClass
    || typeof result.provider !== "string" || result.provider.trim() === ""
    || typeof result.selectedOffer !== "string" || result.selectedOffer.trim() === "") {
    throw new TypeError("inference-work-lot delivery does not bind the requested work lot, receiver, task class and receipt");
  }
  return Object.freeze({
    workLot: result.workLot, provider: result.provider, taskClass: result.taskClass,
    selectedOffer: result.selectedOffer, receipt, receiver: result.receiver,
    ...(typeof result.configurationIdentity !== "string" ? {} : { configurationIdentity: result.configurationIdentity }),
  });
}

function refusedCondition(result) {
  const outcome = result.outcome;
  const disposition = result.disposition;
  if (outcome === "candidate-refused-by-schema-assay") return { condition: "malformed", retryable: false };
  if (disposition === "contract-dependency-pending" || disposition === "dependency-pending") return { condition: "unreachable", retryable: true };
  if (disposition === "selected-provider-refused") {
    const residues = Array.isArray(result.settlementResidues) ? result.settlementResidues : [];
    const transport = residues.some((value) => record(value)?.disposition === "settlement-transport-refusal");
    return { condition: transport ? "unreachable" : "rejected", retryable: transport };
  }
  if (disposition === "selected-provider-transport-obstructed") {
    const residues = Array.isArray(result.settlementResidues) ? result.settlementResidues : [];
    const cancelled = residues.some((value) => record(value)?.disposition === "customer-cancelled");
    return cancelled ? { condition: "cancelled", retryable: false } : { condition: "unreachable", retryable: true };
  }
  return { condition: "rejected", retryable: false };
}

function obstruction(
  call,
  condition,
  reason,
  retryable,
  observedAt,
  evidence,
  causes = [call.id],
) {
  return inferenceSourceTerminal(inferenceObstruction({
    call: call.id,
    condition,
    reasons: Object.freeze([reason]),
    retryable,
    ...(evidence === undefined ? {} : { extensions: Object.freeze({ "inference-work-lot": evidence }) }),
    observedAt,
    causes,
  }));
}

/**
 * Bind MetroPlat's stable bounded-inference service identity to the external
 * market. Provider and provider-native model identities enter only as result
 * provenance after the market has selected and assayed a candidate.
 */
export function inferenceWorkLotSource(options) {
  const agentUrl = standardAgentCardUrl(options.agentUrl);
  const customer = nonempty(options.customer ?? METROPLAT_INFERENCE_MARKET_CUSTOMER, "inference-work-lot customer", "nonempty text");
  if (!customer.startsWith("urn:")) throw new TypeError("inference-work-lot customer must be a URN");
  const serviceModel = nonempty(options.serviceModel ?? BOUNDED_INFERENCE_SERVICE_MODEL, "bounded inference service model", "nonempty text");
  nonempty(options.desiredUse, "inference-work-lot desired use", "nonempty text");
  if (options.difficulty !== undefined && (!Number.isFinite(options.difficulty) || options.difficulty < 0 || options.difficulty > 1)) {
    throw new RangeError("inference-work-lot difficulty must be on the closed interval 0..1");
  }
  const request = options.request ?? requestInferenceWorkLot;
  const now = options.now;

  return (call, sourceOptions) => Object.freeze({
    async *[Symbol.asyncIterator]() {
      const observedAt = now();
      if (call.model !== serviceModel) {
        yield obstruction(call, "configuration", `bounded inference market offers service model ${serviceModel}`, false, observedAt);
        return;
      }
      const unsupportedReasons = unsupported(call);
      if (unsupportedReasons.length > 0) {
        yield inferenceSourceTerminal(inferenceObstruction({
          call: call.id,
          condition: "rejected",
          reasons: unsupportedReasons,
          retryable: false,
          observedAt,
          causes: Object.freeze([call.id]),
        }));
        return;
      }
      if (sourceOptions?.signal?.aborted) {
        yield obstruction(call, "cancelled", "bounded inference market request was cancelled before dispatch", false, observedAt);
        return;
      }
      const requestInput = inferenceWorkLotRequest(call, options, customer);
      if (requestInput.reason !== undefined) {
        yield obstruction(call, "rejected", requestInput.reason, false, observedAt);
        return;
      }

      let exchange;
      try {
        exchange = await request({
          agentUrl: agentUrl.href,
          request: requestInput,
          attemptKey: sourceOptions?.idempotencyKey ?? call.request,
          ...(sourceOptions?.signal === undefined ? {} : { signal: sourceOptions.signal }),
        });
      } catch (error) {
        if (error instanceof InferenceWorkLotClientError) {
          const failure = clientFailureOf(error);
          const evidence = record(error.evidence);
          yield obstruction(call, failure.condition, failure.reason, failure.retryable, now(), evidence);
          return;
        }
        yield obstruction(call, sourceOptions?.signal?.aborted ? "cancelled" : "rejected", sourceOptions?.signal?.aborted
          ? "bounded inference market request was cancelled"
          : "bounded inference market request failed without typed evidence", false, now());
        return;
      }

      const result = record(exchange.result);
      const inputNi = canonicalSha256Ni(exchange.exchange?.inputNi) ? exchange.exchange.inputNi : undefined;
      const resultNi = canonicalSha256Ni(exchange.resultNi) ? exchange.resultNi : undefined;
      const causes = Object.freeze([call.id, ...(inputNi === undefined ? [] : [inputNi]), ...(resultNi === undefined ? [] : [resultNi])]);
      if (result === undefined) {
        yield obstruction(call, "malformed", "inference-work-lot market returned no typed result", false, now(), undefined, causes);
        return;
      }
      if (result.outcome !== "candidate-pending-customer-acceptance" && result.outcome !== "candidate-pending-codex-acceptance") {
        const refusal = refusedCondition(result);
        yield obstruction(call, refusal.condition, `inference-work-lot market settled ${String(result.outcome ?? "unknown")}:${String(result.disposition ?? "unknown")}`, refusal.retryable, now(), result, causes);
        return;
      }
      const requestedImplementationIdentity = requestInput.workPlacement?.requiredImplementationIdentity;
      const configurationIdentity = typeof result.configurationIdentity === "string" && result.configurationIdentity.trim() !== ""
        ? result.configurationIdentity
        : undefined;
      if (requestedImplementationIdentity !== undefined && configurationIdentity !== requestedImplementationIdentity) {
        yield obstruction(call, "malformed", "inference-work-lot result did not return the required implementation identity", false, now(), result, causes);
        return;
      }
      const chatCandidate = record(result.candidate);
      if (result.integrationAccepted !== false || typeof result.provider !== "string" || result.provider.length === 0
        || typeof result.model !== "string" || result.model.length === 0
        || (typeof result.candidate !== "string" && chatCandidate === undefined)) {
        yield obstruction(call, "malformed", "inference-work-lot candidate omitted its non-authoritative provider, model, or completion evidence", false, now(), result, causes);
        return;
      }

      if (inputNi === undefined || resultNi === undefined || typeof exchange.provider.account !== "string" || exchange.provider.account.length === 0) {
        yield obstruction(call, "malformed", "inference-work-lot exchange omitted canonical custody or market-account evidence", false, now(), result, Object.freeze([call.id]));
        return;
      }

      let delivery;
      try { delivery = inferenceWorkLotDelivery(call, requestInput, result); }
      catch (error) {
        yield obstruction(call, "malformed", error.message, false, now(), result, causes);
        return;
      }

      const settledAt = now();
      let evidence;
      try {
        const marketEvidence = record(result.evidence);
        const resourceEvidence = {};
        for (const field of ["declaredResources", "measuredResources", "providerEvidence"]) {
          if (result[field] !== undefined) resourceEvidence[field] = requireJsonValue(result[field], `inference-work-lot ${field}`);
        }
        evidence = Object.freeze({
          ...resourceEvidence,
          provider: result.provider,
          model: result.model,
          integrationAccepted: false,
          marketAccount: exchange.provider.account,
          requestNi: inputNi,
          resultNi,
          ...(delivery === undefined ? {} : { delivery }),
          ...(marketEvidence === undefined ? {} : { evidence: marketEvidence }),
          ...(result.consideration === undefined ? {} : { consideration: requireJsonValue(result.consideration, "inference-work-lot consideration") }),
          ...(typeof result.selectionRule !== "string" ? {} : { selectionRule: result.selectionRule }),
          ...(result.marketRound === undefined ? {} : { marketRound: requireJsonValue(result.marketRound, "inference-work-lot market round") }),
          ...(result.routeDecision === undefined ? {} : { routeDecision: requireJsonValue(result.routeDecision, "inference-work-lot route decision") }),
          ...(result.marketWitnesses === undefined ? {} : { marketWitnesses: requireJsonValue(result.marketWitnesses, "inference-work-lot market witnesses") }),
          ...(chatCandidate === undefined ? {} : { chatCompletion: chatCandidate }),
        });
      } catch {
        yield obstruction(call, "malformed", "inference-work-lot result contained inadmissible settlement evidence", false, now(), result, causes);
        return;
      }
      if (chatCandidate === undefined) {
        const candidate = typeof result.candidate === "string" ? result.candidate : "";
        yield inferenceSourceMove(inferenceStreamMove({
        type: "inference.response-start", channel: "response", sequence: 0,
        body: Object.freeze({ model: result.model, provider: result.provider, buffered: true }), observedAt: settledAt,
        }));
        yield inferenceSourceMove(inferenceStreamMove({
        type: "inference.text-delta", channel: "choice:0", sequence: 1,
        body: Object.freeze({ choice: 0, text: candidate }), observedAt: settledAt,
        }));
        yield inferenceSourceMove(inferenceStreamMove({
        type: "inference.finish", channel: "choice:0", sequence: 2,
        body: Object.freeze({ choice: 0, stop: "completed", buffered: true }), observedAt: settledAt,
        }));
        yield inferenceSourceTerminal(inferenceResult({
        call: call.id,
        model: result.model,
        stop: "completed",
        message: inferenceMessage({ role: "assistant", content: candidate }),
        extensions: Object.freeze({ "inference-work-lot": evidence }),
        observedAt: settledAt,
        causes,
        }));
        return;
      }

      let completion;
      try {
        completion = inferenceResultFromOpenAIChat(chatCandidate, call, settledAt, causes);
      } catch {
        yield obstruction(call, "malformed", "inference-work-lot candidate was not one standard OpenAI chat completion", false, now(), result, causes);
        return;
      }
      if (completion.toolMoves.length > 0 && configurationIdentity === undefined) {
        yield obstruction(call, "malformed", "inference-work-lot tool result omitted its implementation identity", false, now(), result, causes);
        return;
      }
      const toolMoves = configurationIdentity === undefined
        ? completion.toolMoves
        : completion.toolMoves.map((move) => Object.freeze({
          ...move,
          extensions: Object.freeze({
            ...(move.extensions ?? {}),
            [INFERENCE_WORK_LOT_CONFIGURATION_IDENTITY_EXTENSION]: Object.freeze({ configurationIdentity }),
          }),
        }));
      yield inferenceSourceMove(inferenceStreamMove({
        type: "inference.response-start", channel: "response", sequence: 0,
        body: Object.freeze({ model: completion.model, provider: result.provider, buffered: true }), observedAt: settledAt,
      }));
      let sequence = 1;
      if (typeof completion.message?.content === "string" && completion.message.content.length > 0) {
        yield inferenceSourceMove(inferenceStreamMove({
          type: "inference.text-delta", channel: "choice:0", sequence: sequence++,
          body: Object.freeze({ choice: 0, text: completion.message.content }), observedAt: settledAt,
        }));
      }
      for (const [index, move] of toolMoves.entries()) {
        yield inferenceSourceMove(inferenceStreamMove({
          type: "inference.tool-call-delta", channel: `choice:0:tool:${index}`, sequence: sequence++,
          body: Object.freeze({ choice: 0, index, request: move.request, name: move.name, arguments: JSON.stringify(move.input) }), observedAt: settledAt,
        }));
      }
      yield inferenceSourceMove(inferenceStreamMove({
        type: "inference.finish", channel: "choice:0", sequence,
        body: Object.freeze({ choice: 0, stop: completion.stop, buffered: true }), observedAt: settledAt,
      }));
      yield inferenceSourceTerminal(inferenceResult({
        ...completion,
        ...(completion.message === undefined ? {} : {
          message: Object.freeze({
            ...completion.message,
            toolMoves,
          }),
        }),
        toolMoves,
        extensions: Object.freeze({ ...(completion.extensions ?? {}), "inference-work-lot": evidence }),
        observedAt: settledAt,
        causes,
      }));
    },
  });
}
