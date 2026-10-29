// @emsenn/organizing-with-llm-agents/algebra — the pure algebraic substrate of language-model inference.
//
// The carrier model (conversations, endpoints, tools, inference requests/results)
// and exact cost arithmetic with bilattice budget admission. Charges come from
// @emsenn/relating. No IO (that is @emsenn/organizing-with-llm-agents/holography), no wire parsing
// (that is @emsenn/organizing-with-llm-agents/codecs/openai / -anthropic), no settling (that is
// @emsenn/organizing-with-llm-agents/running).

// ── carrier model ──────────────────────────────────────────────────────────────
export type {
  JsonPrimitive, JsonValue, JsonObject,
  Role, ChatMessage, Conversation,
  EndpointDialect, EndpointSpec,
  ToolDefinition, ToolCall, ToolResult,
  InferenceRequest, TokenUsage, InferenceResult,
} from "./model.mjs";
export {
  EndpointDialectSchema,
  EndpointSpecSchema,
  InferenceRequestSchema,
  InferenceResultSchema,
  endpointSpecCarrier,
  inferenceRequestCarrier,
  inferenceResultCarrier,
  canonicalizeEndpointSpecAction,
  canonicalizeInferenceRequestAction,
  canonicalizeInferenceResultAction,
  actions as modelActions,
  message, system, user, assistant,
  endpointUrl, ENDPOINTS,
} from "./model.mjs";
export {
  ChatMessageSchema,
  ToolDefinitionSchema,
  ToolCallSchema,
  ToolResultSchema,
  TokenUsageSchema,
  chatMessageCarrier,
  toolDefinitionCarrier,
  toolCallCarrier,
  toolResultCarrier,
  tokenUsageCarrier,
} from "@emsenn/organizing-with-agents/algebra";

// ── cost & budget ────────────────────────────────────────────────────────────
export type {
  CostCompositionMode, CostTokens, CostAmount, CostEvent,
  BudgetResourceKind, BudgetExhaustionPolicy, Budget, BudgetStatus, BudgetCheck,
  InferenceCostOptions,
} from "./cost.mjs";
export {
  CostCompositionModeSchema,
  CostTokensSchema,
  CostAmountSchema,
  CostEventSchema,
  BudgetResourceKindSchema,
  BudgetExhaustionPolicySchema,
  BudgetSchema,
  BudgetStatusSchema,
  BudgetCheckSchema,
  costTokensCarrier,
  costAmountCarrier,
  costEventCarrier,
  budgetCarrier,
  budgetCheckCarrier,
  canonicalizeCostTokensAction,
  canonicalizeCostAmountAction,
  canonicalizeCostEventAction,
  canonicalizeBudgetAction,
  canonicalizeBudgetCheckAction,
  actions as costActions,
  composeCost, checkBudget, amountForResource, consumedForBudget, inferenceCostEvent,
} from "./cost.mjs";

import { actions as modelActionsRef } from "./model.mjs";
import { actions as costActionsRef } from "./cost.mjs";

export const actions = Object.freeze([
  ...modelActionsRef,
  ...costActionsRef,
]);
