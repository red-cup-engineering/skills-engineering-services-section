/**
 * The smallest enforceable cash boundary for an inference node.  A provider
 * invocation is not a cash quote: until a node has an exact price, currency,
 * instrument, and named human authorization to compare, it must not turn a
 * credential into a paid attempt.
 */
export const ZERO_CASH_INFERENCE_CONTROL = Object.freeze({
  type: "InferenceCashControl",
  version: 1,
  cashCost: "zero",
  paidOverage: "forbidden",
});

/**
 * Reads the server-owned control shared by Bare Cedar Fog and Cold Red Gate.
 * The only currently enforceable mode is deliberately explicit and is the
 * default.  A future paid mode belongs here only with a quoted amount and its
 * separately evidenced human authorization; accepting a bare environment
 * switch would recreate the uncontrolled spending path this boundary removes.
 * @param {Record<string, string|undefined>} [environment]
 * @returns {typeof ZERO_CASH_INFERENCE_CONTROL}
 */
export function resolveInferenceCashControl(environment = process.env) {
  const configured = environment.INFERENCE_CASH_CONTROL;
  if (configured === undefined || configured.trim() === "" || configured === "zero-cash-only") return ZERO_CASH_INFERENCE_CONTROL;
  throw new TypeError("INFERENCE_CASH_CONTROL currently admits only zero-cash-only; paid inference requires an exact quoted price and separately evidenced human authorization");
}

/**
 * Makes the node-owned control non-escalatable by a request sender.
 * @param {object} request
 * @param {typeof ZERO_CASH_INFERENCE_CONTROL} [control]
 * @returns {object}
 */
export function applyInferenceCashControl(request, control = ZERO_CASH_INFERENCE_CONTROL) {
  if (control !== ZERO_CASH_INFERENCE_CONTROL) throw new TypeError("unsupported inference cash control");
  if (request?.zeroCashOnly === false) throw new TypeError("cash-controlled inference refuses a caller opt-out; paid inference requires an exact quoted price and separately evidenced human authorization");
  return Object.freeze({ ...request, zeroCashOnly: true });
}
