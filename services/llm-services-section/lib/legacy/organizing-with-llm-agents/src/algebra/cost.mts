// @emsenn/organizing-with-llm-agents/algebra — exact cost arithmetic and budget admission.
//
// Costs compose as a monoid (serial = sum, parallel = max). Budget admission is a
// bilattice verdict: an available check carries a potential charge, an aborted
// check its negation, and a degraded-but-over check the knowledge join of the two
// (a contested charge). The charge algebra is @emsenn/relating; nothing here
// touches IO, the network, or a wall clock.

import { action, carrierFrom, joinKnowledge, mark, negate, tm, witnessedPotential, type FromSchema, type ChargeCarrier } from "@emsenn/relating";

import type { InferenceResult } from "./model.mjs";

/**
 * How two costs combine: "serial" sums each resource, "parallel" takes the
 * per-resource maximum.
 */
export const CostCompositionModeSchema = { anyOf: [{ const: "serial" }, { const: "parallel" }] } as const;

export type CostCompositionMode = FromSchema<typeof CostCompositionModeSchema>;

export const CostTokensSchema = { "$id": "organizing/agents/llm/algebra/cost-tokens", "title": "LlmCostTokens", "additionalProperties": false, type: "object", required: ["input", "output"], properties: { "input": { type: "integer", "minimum": 0 }, "output": { type: "integer", "minimum": 0 } } } as const;

/** A token count split into input and output, each a nonnegative integer. */
export type CostTokens = Readonly<FromSchema<typeof CostTokensSchema>>;

export const CostAmountSchema = { "$id": "organizing/agents/llm/algebra/cost-amount", "title": "LlmCostAmount", "additionalProperties": false, type: "object", required: ["settlementFuel", "dollars", "tokens"], properties: { "settlementFuel": { type: "number", "minimum": 0 }, "dollars": { type: "number", "minimum": 0 }, "tokens": CostTokensSchema } } as const;

/**
 * The cost of an operation across three resources: settlement fuel, dollars,
 * and input/output tokens.
 */
export type CostAmount = Readonly<FromSchema<typeof CostAmountSchema>>;

export const CostEventSchema = { "$id": "organizing/agents/llm/algebra/cost-event", "title": "LlmCostEvent", "additionalProperties": false, type: "object", required: ["settlementFuel", "dollars", "tokens", "id", "operation", "transactionTime", "evidence"], properties: { "settlementFuel": { type: "number", "minimum": 0 }, "dollars": { type: "number", "minimum": 0 }, "tokens": CostTokensSchema, "id": { type: "string", "minLength": 1 }, "operation": { type: "string", "minLength": 1 }, "endpoint": { type: "string", "minLength": 1 }, "model": { type: "string", "minLength": 1 }, "transactionTime": { type: "string", "minLength": 1 }, "evidence": { type: "array", items: { type: "string" } } } } as const;

/**
 * A CostAmount tagged with provenance: a unique id, the operation name,
 * optional endpoint and model, a caller-supplied ISO-8601 transaction time, and
 * supporting evidence.
 */
export type CostEvent = Readonly<Omit<FromSchema<typeof CostEventSchema>, "evidence"> & {
  readonly evidence: readonly string[];
}>;

export const BudgetResourceKindSchema = { anyOf: [{ const: "dollars" }, { const: "tokens" }, { const: "settlement-fuel" }] } as const;

/**
 * Which resource a budget bounds: "dollars", "tokens" (input plus output), or
 * "settlement-fuel".
 */
export type BudgetResourceKind = FromSchema<typeof BudgetResourceKindSchema>;

export const BudgetExhaustionPolicySchema = { anyOf: [{ const: "abort" }, { const: "defer" }, { const: "escalate" }, { const: "degrade" }] } as const;

/**
 * What to do when a budget would be exceeded: "abort", "defer", "escalate", or
 * "degrade".
 */
export type BudgetExhaustionPolicy = FromSchema<typeof BudgetExhaustionPolicySchema>;

export const BudgetSchema = { "$id": "organizing/agents/llm/algebra/budget", "title": "LlmBudget", "additionalProperties": false, type: "object", required: ["id", "resourceKind", "boundValue", "scope", "exhaustionPolicy", "evidence"], properties: { "id": { type: "string", "minLength": 1 }, "resourceKind": BudgetResourceKindSchema, "boundValue": { type: "number", "minimum": 0 }, "scope": { type: "string", "minLength": 1 }, "exhaustionPolicy": BudgetExhaustionPolicySchema, "resetPolicy": { type: "string", "minLength": 1 }, "evidence": { type: "array", items: { type: "string" } } } } as const;

/**
 * A spending bound on one resource: its id, the resource kind it limits, the
 * bound value, a scope label, the policy to apply on exhaustion, an optional
 * reset policy, and supporting evidence.
 */
export type Budget = Readonly<Omit<FromSchema<typeof BudgetSchema>, "evidence"> & {
  readonly evidence: readonly string[];
}>;

export const BudgetStatusSchema = { anyOf: [{ const: "available" }, { const: "exhausted" }, { const: "downgrade" }] } as const;

/**
 * The outcome of a budget check: "available" (within bound), "exhausted" (over
 * bound, aborting), or "downgrade" (over bound under a defer/escalate/degrade
 * policy).
 */
export type BudgetStatus = FromSchema<typeof BudgetStatusSchema>;

export const BudgetCheckSchema = { "$id": "organizing/agents/llm/algebra/budget-check", "title": "LlmBudgetCheck", "additionalProperties": false, type: "object", required: ["budget", "status", "currentConsumption", "proposedAmount", "projectedConsumption", "charge"], properties: { "budget": BudgetSchema, "status": BudgetStatusSchema, "policy": BudgetExhaustionPolicySchema, "currentConsumption": { type: "number", "minimum": 0 }, "proposedAmount": { type: "number", "minimum": 0 }, "projectedConsumption": { type: "number", "minimum": 0 }, "remaining": { type: "number", "minimum": 0 }, "charge": {} } } as const;

/**
 * The verdict of checking a proposed charge against a budget: the budget, the
 * resulting status and policy, current and proposed and projected consumption,
 * optional remaining headroom, and a ChargeCarrier encoding the admission
 * verdict in the charge bilattice.
 */
export type BudgetCheck = Readonly<Omit<FromSchema<typeof BudgetCheckSchema>, "budget" | "charge"> & {
  readonly budget: Budget;
  readonly charge: ChargeCarrier;
}>;

export const costTokensCarrier = carrierFrom(CostTokensSchema);

export const costAmountCarrier = carrierFrom(CostAmountSchema);

export const costEventCarrier = carrierFrom(CostEventSchema);

export const budgetCarrier = carrierFrom(BudgetSchema);

export const budgetCheckCarrier = carrierFrom(BudgetCheckSchema);

export const canonicalizeCostTokensAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-cost-tokens",
  description: "Canonicalize an LLM cost token carrier.",
  domain: costTokensCarrier,
  codomain: costTokensCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeCostAmountAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-cost-amount",
  description: "Canonicalize an LLM cost amount carrier.",
  domain: costAmountCarrier,
  codomain: costAmountCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeCostEventAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-cost-event",
  description: "Canonicalize an LLM cost event carrier.",
  domain: costEventCarrier,
  codomain: costEventCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeBudgetAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-budget",
  description: "Canonicalize an LLM budget carrier.",
  domain: budgetCarrier,
  codomain: budgetCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeBudgetCheckAction = action({
  verb: "organizing.agents.llm.algebra.canonicalize-budget-check",
  description: "Canonicalize an LLM budget check carrier.",
  domain: budgetCheckCarrier,
  codomain: budgetCheckCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const actions = Object.freeze([
  canonicalizeCostTokensAction,
  canonicalizeCostAmountAction,
  canonicalizeCostEventAction,
  canonicalizeBudgetAction,
  canonicalizeBudgetCheckAction,
]);

/**
 * Inputs for pricing an inference into a CostEvent: optional id and operation,
 * a required ISO-8601 transaction time, settlement fuel, per-million-token
 * dollar rates for input and output, a chars-per-token divisor for estimating
 * missing usage, and evidence.
 */
export type InferenceCostOptions = Readonly<{
  id?: string;
  operation?: string;
  /** an ISO-8601 instant; required so the algebra stays clock-free */
  transactionTime: string;
  settlementFuel?: number;
  dollarsPerMillionInputTokens?: number;
  dollarsPerMillionOutputTokens?: number;
  charsPerToken?: number;
  evidence?: readonly string[];
}>;

const ZERO_COST: CostAmount = {
  settlementFuel: 0,
  dollars: 0,
  tokens: { input: 0, output: 0 },
};

const potential = (witness: unknown): ChargeCarrier => witnessedPotential(mark(witness));

/**
 * Combines cost amounts under a composition mode, summing each resource in
 * "serial" mode and taking the per-resource maximum in "parallel" mode; returns
 * the zero cost for an empty list and validates each value as nonnegative.
 */
export function composeCost(events: readonly CostAmount[], mode: CostCompositionMode = "serial"): CostAmount {
  if (mode !== "serial" && mode !== "parallel") throw new TypeError("composeCost: mode must be serial or parallel");
  if (events.length === 0) return ZERO_COST;
  const combine = mode === "serial" ? (left: number, right: number) => left + right : Math.max;
  return events.reduce((left, right) => ({
    settlementFuel: combine(left.settlementFuel, nonnegative(right.settlementFuel, "settlementFuel")),
    dollars: combine(left.dollars, nonnegative(right.dollars, "dollars")),
    tokens: {
      input: combine(left.tokens.input, nonnegativeInteger(right.tokens.input, "tokens.input")),
      output: combine(left.tokens.output, nonnegativeInteger(right.tokens.output, "tokens.output")),
    },
  }), ZERO_COST);
}

/**
 * Tests a proposed charge against a budget given current consumption, returning
 * a BudgetCheck: "available" with a witnessed potential charge when projected
 * consumption stays within the bound, "exhausted" with a negated charge under
 * an abort policy, or "downgrade" with the knowledge join of a witnessed and a
 * negated charge under defer/escalate/degrade policies.
 */
export function checkBudget(budget: Budget, currentConsumption: number, proposedAmount: number): BudgetCheck {
  const current = nonnegative(currentConsumption, "currentConsumption");
  const proposed = nonnegative(proposedAmount, "proposedAmount");
  const bound = nonnegative(budget.boundValue, "budget.boundValue");
  const projectedConsumption = current + proposed;
  if (projectedConsumption <= bound) {
    return {
      budget,
      status: "available",
      currentConsumption: current,
      proposedAmount: proposed,
      projectedConsumption,
      remaining: bound - projectedConsumption,
      charge: potential({ budget: budget.id, status: "available" }),
    };
  }
  if (budget.exhaustionPolicy === "abort") {
    return {
      budget,
      status: "exhausted",
      policy: budget.exhaustionPolicy,
      currentConsumption: current,
      proposedAmount: proposed,
      projectedConsumption,
      charge: negate(potential({ budget: budget.id, status: "exhausted" })),
    };
  }
  if (budget.exhaustionPolicy === "defer" || budget.exhaustionPolicy === "escalate" || budget.exhaustionPolicy === "degrade") {
    return {
      budget,
      status: "downgrade",
      policy: budget.exhaustionPolicy,
      currentConsumption: current,
      proposedAmount: proposed,
      projectedConsumption,
      charge: joinKnowledge(
        potential({ budget: budget.id, status: "downgrade" }),
        negate(potential({ budget: budget.id, status: "over-budget" })),
      ),
    };
  }
  throw new TypeError(`checkBudget: unknown exhaustion policy ${(budget as { exhaustionPolicy?: unknown }).exhaustionPolicy}`);
}

/**
 * Projects a CostAmount onto a single resource kind: dollars, input plus output
 * tokens, or settlement fuel.
 */
export function amountForResource(cost: CostAmount, resourceKind: BudgetResourceKind): number {
  switch (resourceKind) {
    case "dollars":
      return cost.dollars;
    case "tokens":
      return cost.tokens.input + cost.tokens.output;
    case "settlement-fuel":
      return cost.settlementFuel;
  }
}

/**
 * Composes the given cost events under a mode and returns the amount consumed
 * in the budget's resource kind.
 */
export function consumedForBudget(events: readonly CostAmount[], budget: Budget, mode: CostCompositionMode = "serial"): number {
  return amountForResource(composeCost(events, mode), budget.resourceKind);
}

/**
 * Builds a CostEvent from an inference result and pricing options: takes token
 * counts from the result's usage or estimates them from prompt bytes and text
 * length via charsPerToken, computes dollars from the per-million-token rates,
 * and fills in id, operation, endpoint, model, settlement fuel, transaction
 * time, and evidence.
 */
export function inferenceCostEvent(result: InferenceResult, options: InferenceCostOptions): CostEvent {
  const charsPerToken = nonnegative(options.charsPerToken ?? 4, "charsPerToken") || 4;
  const input = result.usage?.input ?? Math.ceil(result.promptBytes / charsPerToken);
  const output = result.usage?.output ?? Math.ceil(result.text.length / charsPerToken);
  const tokens = {
    input: nonnegativeInteger(input, "tokens.input"),
    output: nonnegativeInteger(output, "tokens.output"),
  };
  const inputRate = nonnegative(options.dollarsPerMillionInputTokens ?? 0, "dollarsPerMillionInputTokens");
  const outputRate = nonnegative(options.dollarsPerMillionOutputTokens ?? 0, "dollarsPerMillionOutputTokens");
  const dollars = (tokens.input * inputRate + tokens.output * outputRate) / 1_000_000;
  const operation = options.operation ?? "inferring";
  const evidence = options.evidence ?? [`inference:${result.endpoint}:${result.model}`];
  return {
    id: options.id ?? `cost:${operation}:${result.endpoint}:${result.model}:${tokens.input}-${tokens.output}`,
    operation,
    endpoint: result.endpoint,
    model: result.model,
    settlementFuel: nonnegative(options.settlementFuel ?? 1, "settlementFuel"),
    dollars,
    tokens,
    transactionTime: options.transactionTime,
    evidence,
  };
}

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a nonnegative number`);
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  nonnegative(value, label);
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}
