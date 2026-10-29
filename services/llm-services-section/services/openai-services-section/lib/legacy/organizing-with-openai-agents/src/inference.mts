/**
 * inference — drive inference against ANY OpenAI-compatible endpoint.
 *
 * The generalization of @emsenn/computing-with-openai-codex's `codexInfer`: where
 * that closure is bound to the single `openai` endpoint, `openaiAgentInfer` binds
 * to whichever endpoint the caller names (id or EndpointSpec). The API key is
 * resolved by holography at call time from the endpoint's own apiKeyEnv names; it
 * never enters this closure. This is the only place keys and sockets are used.
 */
import { type InferenceRequest, type InferenceResult } from "@emsenn/organizing-with-llm-agents/algebra";
import { type HolographyOptions, witnessInference } from "@emsenn/organizing-with-llm-agents/holography";
import { defaultModelFor, resolveEndpoint, type EndpointRef } from "./endpoints.mjs";

export type { HolographyOptions, EndpointRef };

/**
 * An inference function scoped to one endpoint: it receives a request without an
 * endpoint field (and may omit the model, falling back to the endpoint default)
 * and resolves it.
 */
export type OpenaiAgentInfer = (
  request: Omit<InferenceRequest, "endpoint" | "model"> & { readonly model?: string },
) => Promise<InferenceResult>;

/**
 * Build an OpenaiAgentInfer bound to one endpoint. The endpoint may be a built-in
 * id (openai | nvidia | groq | cerebras) or a full EndpointSpec. A request's
 * model defaults to the endpoint's defaultModel when omitted. Throws with the
 * holography fault condition/reason when a call cannot settle.
 */
export function openaiAgentInfer(
  endpointRef: EndpointRef,
  options: HolographyOptions = {},
): OpenaiAgentInfer {
  const endpoint = resolveEndpoint(endpointRef);
  return async (request) => {
    const model = request.model ?? defaultModelFor(endpoint);
    const outcome = await witnessInference(endpoint, { ...request, endpoint, model }, options);
    if (!outcome.ok) {
      throw new Error(
        `@emsenn/organizing-with-openai-agents: inference on ${endpoint.id} ${outcome.condition}: ${outcome.reason}`,
      );
    }
    return outcome.result;
  };
}
