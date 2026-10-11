/**
 * economy/cost — exact LLM-call cost arithmetic, recovered from the
 * decommissioned `core/organizing-with-llm-agents/src/algebra/cost.mts` (git
 * 09655d160c). The former counting and measuring evaluator directories were
 * checked first and carry no cost concept: `counting` builds von Neumann
 * natural terms for SEN reification, not host-reported integers, and no
 * evaluator models dollars, tokens, or bytes. This module fills that gap as
 * pure arithmetic only: costs compose as a monoid (serial = sum, parallel =
 * max).
 *
 * Dollars, tokens, and bytes are all just informational measures of the same
 * "costed" energy behavior (src/lib:EnergeticObligation/EnergyBehavior)
 * — there is no separate budget/admission type system here. The dead
 * package's Budget/BudgetCheck FOUR-charge verdict was dropped: nothing
 * in this package consumed it, and a spend-limit admission verdict belongs on
 * the registered instrument's own energetics obligation
 * (the deleted instruments catalog once did this), not on a
 * parallel accounting concept a caller never reaches. Its third resource,
 * "settlement fuel", named a concept private to the dead package's own agent
 * economy with no counterpart here, so it is dropped too.
 */

/** How two costs combine: "serial" sums each resource, "parallel" takes the per-resource maximum. */

const costTokensSchema = {
  $id: "metroplat/contracts/economy/cost-tokens",
  type: "object",
  required: ["input", "output"],
  properties: {
    input: { type: "integer", minimum: 0 },
    output: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
  title: "CostTokens",
  description: "A token count split into input and output, each a nonnegative integer.",
};

/** A token count split into input and output, each a nonnegative integer. */

const costAmountSchema = {
  $id: "metroplat/contracts/economy/cost-amount",
  type: "object",
  required: ["dollars", "tokens"],
  properties: {
    dollars: { type: "number", minimum: 0 },
    tokens: costTokensSchema,
  },
  additionalProperties: false,
  title: "CostAmount",
  description: "The cost of an operation across two resources: dollars and input/output tokens.",
};

/** The cost of an operation across two resources: dollars and input/output tokens. */

const costEventSchema = {
  $id: "metroplat/contracts/economy/cost-event",
  type: "object",
  required: ["id", "operation", "at", "evidence", "dollars", "tokens"],
  properties: {
    id: { type: "string", minLength: 1 },
    operation: { type: "string", minLength: 1 },
    endpoint: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    at: { type: "string", minLength: 1 },
    evidence: { type: "array", items: { type: "string" } },
    dollars: { type: "number", minimum: 0 },
    tokens: costTokensSchema,
  },
  additionalProperties: false,
  title: "CostEvent",
  description: "A CostAmount tagged with provenance: a unique id, the operation name, optional endpoint and model, a caller-supplied ISO-8601 transaction time, and evidence.",
};

/** A CostAmount tagged with provenance: a unique id, the operation name, optional
 *  endpoint and model, a caller-supplied ISO-8601 transaction time, and evidence. */

const ZERO_COST = { dollars: 0, tokens: { input: 0, output: 0 } };

function nonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a nonnegative number`);
  return value;
}

function nonnegativeInteger(value, label) {
  nonnegative(value, label);
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

/** Combine cost amounts under a composition mode: sums each resource in "serial"
 *  mode, takes the per-resource maximum in "parallel" mode. Returns the zero
 *  cost for an empty list. */
export function composeCost(events, mode = "serial") {
  if (mode !== "serial" && mode !== "parallel") throw new TypeError("composeCost: mode must be serial or parallel");
  if (events.length === 0) return ZERO_COST;
  const combine = mode === "serial" ? (left, right) => left + right : Math.max;
  return events.reduce((left, right) => ({
    dollars: combine(left.dollars, nonnegative(right.dollars, "dollars")),
    tokens: {
      input: combine(left.tokens.input, nonnegativeInteger(right.tokens.input, "tokens.input")),
      output: combine(left.tokens.output, nonnegativeInteger(right.tokens.output, "tokens.output")),
    },
  }), ZERO_COST);
}

/** Project a CostAmount onto a single resource kind: dollars, or input plus output tokens. */
export function amountForResource(cost, resourceKind) {
  return resourceKind === "dollars" ? cost.dollars : cost.tokens.input + cost.tokens.output;
}

/** Price token counts and a per-million-token dollar rate into a cost amount. */
export function tokenCost(tokens, dollarsPerMillionInputTokens, dollarsPerMillionOutputTokens) {
  const input = nonnegativeInteger(tokens.input, "tokens.input");
  const output = nonnegativeInteger(tokens.output, "tokens.output");
  const dollars = (input * nonnegative(dollarsPerMillionInputTokens, "dollarsPerMillionInputTokens")
    + output * nonnegative(dollarsPerMillionOutputTokens, "dollarsPerMillionOutputTokens")) / 1_000_000;
  return { dollars, tokens: { input, output } };
}
