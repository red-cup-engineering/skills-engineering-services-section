// @red-cup-engineering/llm-server — the OpenAI-compatible chat-completions service.
//
// Binds apps/llm-computer's agentic loop to an HTTP transport via @red-cup-engineering/web-server.
// Inference enters through @red-cup-engineering/organizing-with-llm-agents/holography (the only place keys and sockets
// live); the computer and topology stay pure. The OpenAI request/response mapping
// is pure and separately testable from the transport.

import { type App, type Context, jsonRepr, readJsonBody } from "@red-cup-engineering/http-server";
import {
  type EndpointSpec,
  type InferenceRequest,
  type Role,
  ENDPOINTS,
} from "@red-cup-engineering/organizing-with-llm-agents/algebra";
import { type AgentRun, classifyRun, runCost } from "@red-cup-engineering/organizing-with-llm-agents/running";
import { type CostRates, type Infer, runAgentLoop } from "@red-cup-engineering/llm-computer";
import { type HolographyOptions, witnessInference } from "@red-cup-engineering/organizing-with-llm-agents/holography";

/** Adapt holography's witnessed inference into the computer's injected Infer capability. */
export function inferFromHolography(endpoint: EndpointSpec, options: HolographyOptions = {}): Infer {
  return async (request) => {
    const outcome = await witnessInference(endpoint, request, options);
    if (!outcome.ok) throw new Error(`llm-server: inference ${outcome.condition}: ${outcome.reason}`);
    return outcome.result;
  };
}

// ── OpenAI request/response mapping (pure) ─────────────────────────────────────
export type OpenAiMessage = Readonly<{ role?: string; content?: unknown }>;
/** OpenAI-compatible wire projection. `requestFromOpenAi` immediately
 *  normalizes this HTTP shape into the LLM inference request carrier; the
 *  service never treats it as an independent model. */
export type OpenAiChatRequest = Readonly<{
  model?: string;
  messages?: readonly OpenAiMessage[];
  temperature?: number;
  max_tokens?: number;
}>;

const ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool"]);
function roleOf(role: unknown): Role {
  return typeof role === "string" && ROLES.has(role) ? role as Role : "user";
}

export function requestFromOpenAi(body: OpenAiChatRequest, endpoint: EndpointSpec, defaultModel: string): InferenceRequest {
  return {
    endpoint,
    model: body.model ?? defaultModel,
    messages: (body.messages ?? []).map((m) => ({ role: roleOf(m.role), content: String(m.content ?? "") })),
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    ...(body.max_tokens === undefined ? {} : { maxTokens: body.max_tokens }),
  };
}

export function completionFromRun(run: AgentRun, model: string): Record<string, unknown> {
  const classification = classifyRun(run);
  const cost = runCost(run);
  return {
    id: run.id,
    object: "chat.completion",
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: run.finalAnswer ?? "" },
      finish_reason: classification.settled ? "stop" : "length",
    }],
    usage: {
      prompt_tokens: cost.tokens.input,
      completion_tokens: cost.tokens.output,
      total_tokens: cost.tokens.input + cost.tokens.output,
    },
  };
}

// ── the app ────────────────────────────────────────────────────────────────────
/** Service projection controls for binding the pure LLM computer to HTTP.
 *  Inference, run state, and cost settle in @red-cup-engineering/organizing-with-llm-agents carriers; these options
 *  only choose the upstream, route, limits, and injected clocks/costs. */
export type LlmServerOptions = Readonly<{
  upstream?: EndpointSpec;
  model?: string;
  path?: string;
  maxBodyBytes?: number;
  holography?: HolographyOptions;
  cost?: CostRates;
  maxSteps?: number;
  now?: () => string;
}>;

export function createLlmServerApp(options: LlmServerOptions = {}): App {
  const upstream: EndpointSpec = options.upstream ?? ENDPOINTS.groq;
  const model = options.model ?? upstream.defaultModel ?? "";
  const path = options.path ?? "/v1/chat/completions";
  const infer = inferFromHolography(upstream, options.holography ?? {});

  return {
    resources: [{
      match: path,
      methods: ["POST"],
      id: "chat-completions",
      handler: async (ctx: Context) => {
        const body = await readJsonBody<OpenAiChatRequest>(ctx.req);
        const request = requestFromOpenAi(body, upstream, model);
        if (!request.model) return jsonRepr({ error: { message: "no model given and upstream has no default" } }, 400);
        const now = options.now?.() ?? new Date().toISOString(); // law-allow: wall-clock-as-data — injectable timestamp testimony for the run loop; ordering is carried by the loop trace
        const run = await runAgentLoop({
          request,
          infer,
          now,
          ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
          ...(options.cost === undefined ? {} : { cost: options.cost }),
        });
        return jsonRepr(completionFromRun(run, request.model), 200);
      },
    }],
  };
}
