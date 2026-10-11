/**
 * The house's inference market, reached from outside the node that serves it.
 *
 * A routine that needs text (a persona's notes, an answer to a reader) asks the market on the node's MCP surface as
 * that node's machine client, instead of keeping provider keys of its own. The market then places, meters and records
 * every act in one place. The consumer owes the market a judgment on each delivery after its required receiving,
 * with evidence. Fabrication pre-assays are not customer acceptance. Those judgments are what the market's quality
 * prior learns from.
 */
import { callMcpTool } from "@red-cup-engineering/mcp-engineering-services-section/scripts/call-tool";

export const DISPATCH_TOOL = "inference_dispatch_inference";
export const OUTCOME_TOOL = "inference_record_inference_outcome";

/** Judgment coordinates alongside the original delivery evidence carried into fabrication. */
export function deliveryLot(delivery, taskClass) {
  return {
    workLot: delivery.workLot, provider: delivery.provider, taskClass: delivery.taskClass ?? taskClass,
    selectedOffer: delivery.selectedOffer, receipt: delivery.receipt?.id, receiver: delivery.receiver, model: delivery.model,
    ...(delivery.configurationIdentity === undefined ? {} : { configurationIdentity: delivery.configurationIdentity }),
    delivery,
  };
}

/**
 * `chat({ taskClass, objective, messages, json, schema, temperature, requiredCapabilities, difficulty })` resolves to
 * `{ text, lot }`: the delivered message, judgment coordinates and original native evidence at `lot.delivery`.
 * `requiredCapabilities` (say ["code"]) and
 * `difficulty` are the lot's own terms, passed to placement as they are.
 * Resource ceilings, consideration and quality requirements travel to the native market unchanged.
 * A schema describes the candidate the consumer must admit locally; it is not
 * an assumption that every provider implements the house JSON Schema dialect.
 * Omitted eligibility restrictions are decided by the node, not invented by this client.
 * `judge(lot, outcome, evidence)` records the judgement; its evidence is one string.
 * A result without text is thrown with the native result as its cause, preserving
 * refusal, lot and resource evidence for the allocating caller. `call` replaces the MCP call.
 */
export function remoteInferenceMarket({ origin, clientId, clientSecret, timeoutMs, call = callMcpTool } = {}) {
  const tool = (name, input) => call({ origin, clientId, clientSecret, tool: name, input, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  return {
    async chat({ taskClass, objective, messages, json = false, schema, temperature, requiredCapabilities, difficulty, requiredQualityTiers, workPlacement, considerationPolicy, agentBounds, reasoning_effort, reasoning_budget, chat_template_kwargs }) {
      // The consumer owns admission. Send its data contract as context without
      // turning the house schema dialect into a provider-specific wire grammar.
      // Explicit JSON-mode callers retain that transport request.
      const contractMessages = schema === undefined ? messages : [...messages, {
        role: "system", content: "Return precisely one JSON document satisfying this data contract, without prose or fences: " + JSON.stringify(schema),
      }];
      const chatCompletion = { messages: contractMessages, ...(temperature === undefined ? {} : { temperature }),
        ...(json ? { response_format: { type: "json_object" } } : {}),
        ...(reasoning_effort === undefined ? {} : { reasoning_effort }),
        ...(reasoning_budget === undefined ? {} : { reasoning_budget }),
        ...(chat_template_kwargs === undefined ? {} : { chat_template_kwargs }) };
      const delivery = await tool(DISPATCH_TOOL, { objective, taskClass, chatCompletion, routingProfile: "bounded",
        ...(workPlacement === undefined ? {} : { workPlacement }),
        ...(considerationPolicy === undefined ? {} : { considerationPolicy }),
        ...(agentBounds === undefined ? {} : { agentBounds }),
        ...(requiredQualityTiers === undefined ? {} : { requiredQualityTiers }),
        ...(requiredCapabilities === undefined ? {} : { requiredCapabilities }), ...(difficulty === undefined ? {} : { difficulty }) });
      const text = delivery?.candidate?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new Error(`${taskClass}: the market delivered no text (${delivery?.outcome ?? "no outcome"})`, { cause: delivery });
      return { text, lot: deliveryLot(delivery, taskClass) };
    },
    // The outcome tool takes the lot's own fields and nothing else; whatever a routine kept beside them stays its own.
    async judge({ workLot, provider, taskClass, selectedOffer, receipt, receiver, configurationIdentity }, outcome, evidence) {
      return tool(OUTCOME_TOOL, { workLot, provider, taskClass, selectedOffer, receipt, receiver, outcome, evidence,
        ...(configurationIdentity === undefined ? {} : { configurationIdentity }) });
    },
  };
}

/** The market as this node's machine client: MCP_ORIGIN, MCP_CLIENT_ID and MCP_CLIENT_SECRET. */
export const remoteInferenceMarketFromEnv = (env = process.env, options = {}) =>
  remoteInferenceMarket({ origin: env.MCP_ORIGIN, clientId: env.MCP_CLIENT_ID, clientSecret: env.MCP_CLIENT_SECRET, ...options });
