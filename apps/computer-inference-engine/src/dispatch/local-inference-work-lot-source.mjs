/** An in-process FeltOS inference source over the admitted, observed direct-endpoint lane. */
import { dispatchInference } from "./inference-dispatch.mjs";
import { BOUNDED_INFERENCE_SERVICE_MODEL, METROPLAT_INFERENCE_MARKET_CUSTOMER, INFERENCE_WORK_LOT_CONFIGURATION_IDENTITY_EXTENSION, inferenceWorkLotRequest, inferenceWorkLotDelivery, unsupported } from "./inference-work-lot-source.mjs";
import { inferenceResultFromOpenAIChat } from "../openai/chat-completions/inference.mjs";
import { inferenceObstruction, inferenceResult } from "./inference-model.mjs";
import { inferenceSourceMove, inferenceSourceTerminal, inferenceStreamMove } from "./inference-source-kind.mjs";

function failure(call, condition, reason, observedAt, retryable = false) {
  return inferenceSourceTerminal(inferenceObstruction({
    call: call.id, condition, reasons: [reason], retryable, observedAt, causes: [call.id],
  }));
}

function move(type, channel, sequence, body, observedAt) {
  return inferenceSourceMove(inferenceStreamMove({ type, channel, sequence, body, observedAt }));
}

/** Provider selection, quota, and receiver observations have one owner: dispatchInference. */
export function localInferenceWorkLotSource({
  now = () => new Date().toISOString(),
  dispatch = dispatchInference,
  environment = process.env,
  pricingRoot,
  directDescriptors,
  workPlacement,
  customer = METROPLAT_INFERENCE_MARKET_CUSTOMER,
  serviceModel = BOUNDED_INFERENCE_SERVICE_MODEL,
  agentBounds = { maximumRequests: 1, maximumToolCalls: 0, maximumOutputTokens: 1024, maximumDepth: 0, maximumTokensPerRequest: 1024, maximumToolRounds: 0 },
} = {}) {
  const hostEnvironment = Object.freeze({ ...environment });
  return (call, options = {}) => ({
    async *[Symbol.asyncIterator]() {
      if (call.model !== serviceModel) {
        yield failure(call, "configuration", `local inference offers service model ${serviceModel}`, now());
        return;
      }
      if (options.signal?.aborted) {
        yield failure(call, "cancelled", "inference cancelled before dispatch", now());
        return;
      }
      const unsupportedReasons = unsupported(call);
      if (unsupportedReasons.length > 0) {
        yield failure(call, "rejected", unsupportedReasons.join("; "), now());
        return;
      }
      const requestInput = inferenceWorkLotRequest(call, { agentBounds, workPlacement, zeroCashOnly: true }, customer);
      if (requestInput.reason !== undefined) {
        yield failure(call, "rejected", requestInput.reason, now());
        return;
      }
      let result;
      try {
        result = await dispatch(requestInput, { environment: hostEnvironment, ...(pricingRoot ? { pricingRoot } : {}), ...(directDescriptors ? { directDescriptors } : {}), signal: options.signal });
      } catch (error) {
        yield failure(call, options.signal?.aborted ? "cancelled" : "unreachable", error instanceof Error ? error.message : String(error), now(), !options.signal?.aborted);
        return;
      }
      if (result.outcome !== "candidate-pending-customer-acceptance" && result.outcome !== "candidate-pending-codex-acceptance") {
        yield failure(call, "rejected", `inference dispatch returned ${String(result.outcome)}:${String(result.disposition ?? "unavailable")}`, now());
        return;
      }
      if (result.integrationAccepted !== false || !result.candidate || typeof result.provider !== "string" || typeof result.configurationIdentity !== "string") {
        yield failure(call, "malformed", "inference dispatch omitted candidate or provider provenance", now());
        return;
      }
      const observedAt = now();
      if (requestInput.workPlacement?.requiredImplementationIdentity !== undefined
        && result.configurationIdentity !== requestInput.workPlacement.requiredImplementationIdentity) {
        yield failure(call, "malformed", "inference dispatch did not return the required implementation identity", observedAt);
        return;
      }
      let delivery;
      try { delivery = inferenceWorkLotDelivery(call, requestInput, result); }
      catch (error) {
        yield failure(call, "malformed", error.message, observedAt);
        return;
      }
      let completion;
      try {
        completion = inferenceResultFromOpenAIChat(result.candidate, call, observedAt, [call.id, result.receipt?.id].filter(Boolean));
      } catch {
        yield failure(call, "malformed", "inference dispatch returned an invalid chat completion", observedAt);
        return;
      }
      const toolMoves = completion.toolMoves.map((toolMove) => ({
        ...toolMove,
        extensions: {
          ...(toolMove.extensions ?? {}),
          [INFERENCE_WORK_LOT_CONFIGURATION_IDENTITY_EXTENSION]: { configurationIdentity: result.configurationIdentity },
        },
      }));
      const evidence = {
        provider: result.provider, model: result.model, selectedOffer: result.selectedOffer,
        configurationIdentity: result.configurationIdentity, workLot: result.workLot,
        receipt: result.receipt?.id, integrationAccepted: false,
        ...(delivery === undefined ? {} : { delivery }),
        ...(result.measuredResources ? { measuredResources: result.measuredResources } : {}),
      };
      yield move("inference.response-start", "response", 0, { model: completion.model, provider: result.provider, buffered: true }, observedAt);
      let sequence = 1;
      if (completion.message?.content) yield move("inference.text-delta", "choice:0", sequence++, { choice: 0, text: completion.message.content }, observedAt);
      for (const [index, toolMove] of toolMoves.entries()) yield move("inference.tool-call-delta", `choice:0:tool:${index}`, sequence++, {
        choice: 0, index, request: toolMove.request, name: toolMove.name, arguments: JSON.stringify(toolMove.input),
      }, observedAt);
      yield move("inference.finish", "choice:0", sequence, { choice: 0, stop: completion.stop, buffered: true }, observedAt);
      yield inferenceSourceTerminal(inferenceResult({
        ...completion, toolMoves,
        ...(completion.message ? { message: { ...completion.message, toolMoves } } : {}),
        extensions: { ...completion.extensions, "inference-work-lot": evidence },
      }));
    },
  });
}
