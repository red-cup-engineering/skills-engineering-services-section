// Claude-specific inference: Anthropic endpoint + holography wrapper.
// The only place keys and sockets enter this package; everything else is pure.
import { ENDPOINTS, type InferenceRequest, type InferenceResult } from "@emsenn/organizing-with-llm-agents/algebra";
import { type HolographyOptions, witnessInference } from "@emsenn/organizing-with-llm-agents/holography";

export type { HolographyOptions };
export type { CostEvent } from "@emsenn/organizing-with-llm-agents/algebra";

/** An inference function scoped to the Anthropic endpoint: receives a request
 *  without an endpoint field and resolves it. */
export type ClaudeInfer = (
  request: Omit<InferenceRequest, "endpoint">,
) => Promise<InferenceResult>;

/** Build a ClaudeInfer bound to the Anthropic endpoint. The API key is resolved
 *  by holography at call time; it never enters this closure. */
export function claudeInfer(options: HolographyOptions = {}): ClaudeInfer {
  const endpoint = ENDPOINTS.anthropic;
  return async (request) => {
    const outcome = await witnessInference(endpoint, { ...request, endpoint }, options);
    if (!outcome.ok) {
      throw new Error(`organizing-with-claude: inference ${outcome.condition}: ${outcome.reason}`);
    }
    return outcome.result;
  };
}
