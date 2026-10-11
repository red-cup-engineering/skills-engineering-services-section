/** Dependency-light on purpose: must not require a provider transport. */
export const BOUNDED_INFERENCE_ROUTING_PROFILE = Object.freeze({ retired: true });

/**
 * @param {{ demandClass: "mechanical"|"bounded-derivation"|"premium-review", difficulty?: number, contextCharacters?: number }} input
 * @returns {{ disposition: string, inferenceCalls: number, contextAccepted: boolean, nextAct: string }}
 */
export function classifyInferenceDemand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("one inference demand classification object is required");
  const demandClass = input.demandClass;
  if (!["mechanical", "bounded-derivation", "premium-review"].includes(demandClass)) throw new Error("demandClass must identify mechanical work, a bounded derivation, or a human-led residual");
  if (demandClass === "mechanical") return Object.freeze({ disposition: "customer-local-deterministic", inferenceCalls: 0, contextAccepted: false, nextAct: "Use a customer-local deterministic command, parser, formatter, test, or exact file operation." });
  return Object.freeze({
    disposition: "dispatch-provider-lot",
    inferenceCalls: 0,
    contextAccepted: false,
    nextAct: "Submit the finite work lot to provider-authored offers; price, capacity, and refusal determine its feasible extent.",
  });
}
