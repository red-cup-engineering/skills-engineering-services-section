// A deliberately dependency-light control plane for the Codex customer.  This
// module must remain free of provider transports: losing an optional supplier
// must not prevent the market MCP server from answering initialize or routing
// a mechanical task locally.
export const BOUNDED_CODEX_ROUTING_PROFILE = Object.freeze({ retired: true });

export function classifyCodexDemand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("one Codex demand classification object is required");
  const demandClass = input.demandClass;
  if (!["mechanical", "bounded-derivation", "premium-review"].includes(demandClass)) throw new Error("demandClass must identify mechanical work, a bounded derivation, or a human-led residual");
  if (demandClass === "mechanical") return Object.freeze({ disposition: "customer-local-deterministic", inferenceCalls: 0, contextAccepted: false, nextAct: "Use a customer-local deterministic command, parser, formatter, test, or exact file operation." });
  return Object.freeze({
    disposition: "contract-market-lot",
    inferenceCalls: 0,
    contextAccepted: false,
    nextAct: "Submit the finite work lot to provider-authored offers; price, capacity, and refusal determine its feasible extent.",
  });
}
