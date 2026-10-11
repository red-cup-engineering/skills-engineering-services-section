import { randomUUID } from "node:crypto";
import { createWorkResourceReservations, evaluateWorkResourceControl, workResourceAccountKey } from "./work-placement/resource-reservations.mjs";

const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const measured = (resource, unit, value) => ({ resource, unit, amount: { numerator: String(value), denominator: "1" } });

/** Binds one root execution tree to server-owned account reservations.
 * @param {{store: object, resolveBinding: Function, reservationId?: string, now?: Function}} options Runtime authority and an isolated job identity.
 * @returns {{bindingFor: Function, wrap: Function, finish: Function, receipts: Function}} Shared holds and measured settlement for every child and retry.
 */
export function createInferenceResourceReservations({ store, resolveBinding, reservationId = randomUUID(), now = () => new Date().toISOString() }) {
  if (typeof resolveBinding !== "function") throw new TypeError("resource reservations require a server-owned account binding resolver");
  const holds = new Map(), receipts = [];
  let closed = false;
  const bindingFor = (descriptor) => {
    const value = resolveBinding(descriptor);
    if (!value) throw new Error("provider-account-capacity-not-admitted");
    const evaluation = evaluateWorkResourceControl(value, now());
    if (evaluation.disposition !== "admitted") throw new Error(evaluation.reason);
    const binding = evaluation.binding;
    if (binding.providerIdentity !== descriptor.provider) throw new Error("provider-account-binding-mismatch");
    return binding;
  };
  const action = async (hold, kind, extra = {}) => {
    const result = await hold.owner.apply({ type: "WorkResourceReservationRequest", action: kind, reservationId,
      providerIdentity: hold.binding.providerIdentity, accountIdentity: hold.binding.accountIdentity,
      windowIdentity: hold.binding.windowIdentity, evaluatedAt: now(), ...extra });
    receipts.push(result);
    if (result.disposition === "refused") throw new Error(result.reason);
    return result;
  };
  async function getHold(descriptor, resources) {
    const binding = bindingFor(descriptor), key = workResourceAccountKey(binding);
    if (!holds.has(key)) {
      const pending = (async () => {
        const hold = { binding, owner: createWorkResourceReservations({ store, binding }), attempted: false,
          requests: 0, outputTokens: 0, requestsKnown: true, outputKnown: true };
        const result = await action(hold, "reserve", { resources });
        if (result.disposition !== "held") throw new Error("resource-reservation-already-used");
        return hold;
      })();
      holds.set(key, pending);
    }
    return holds.get(key);
  }
  return Object.freeze({
    bindingFor,
    evaluatedAt: () => now(),
    /** Wraps the existing receiver transport at its admitted invocation boundary.
     * @param {object} descriptor The selected server-owned endpoint.
     * @param {Array<object>} resources Its conservative whole-tree resource demand.
     * @param {Function} invoke The existing receiver transport.
     * @returns {Function} The same transport with one account reservation.
     */
    wrap(descriptor, resources, invoke) {
      return async (packet) => {
        if (closed) throw new Error("resource-execution-tree-closed");
        if (packet.signal?.aborted) throw new Error("receiver-cancelled-before-resource-reservation");
        const hold = await getHold(descriptor, resources);
        if (!hold.claim) hold.claim = action(hold, "attempt").then(() => { hold.attempted = true; });
        await hold.claim;
        try {
          const result = await invoke(packet);
          const exchanges = result?.exchanges;
          if (!Array.isArray(exchanges) || !["ReceiverOwnedToolAgentCompletion", "ReceiverOwnedAssistantTurn"].includes(result?.type)) {
            hold.requestsKnown = false; hold.outputKnown = false;
          } else {
            hold.requests += exchanges.length;
            for (const exchange of exchanges) {
              if (!integer(exchange.usage?.outputTokens)) hold.outputKnown = false;
              else hold.outputTokens += exchange.usage.outputTokens;
            }
          }
          return result;
        } catch (error) {
          hold.requestsKnown = false; hold.outputKnown = false;
          throw error;
        }
      };
    },
    /** Settles once after the entire root tree finishes, retaining every unmeasured dimension.
     * @returns {Promise<Array<object>>} Durable transition receipts, including any settlement refusal.
     */
    async finish() {
      if (closed) return structuredClone(receipts);
      closed = true;
      for (const pending of holds.values()) {
        let hold;
        try { hold = await pending; } catch { continue; }
        try {
          if (!hold.attempted) await action(hold, "release");
          else {
            const measuredResources = [
              ...(hold.requestsKnown && integer(hold.requests) ? [measured("requests", "request", hold.requests)] : []),
              ...(hold.outputKnown && integer(hold.outputTokens) ? [measured("output-tokens", "token", hold.outputTokens)] : []),
            ];
            await action(hold, "settle", { measuredResources });
          }
        } catch {
          // Failed settlement retains the committed conservative charge.
        }
      }
      return structuredClone(receipts);
    },
    receipts: () => structuredClone(receipts),
  });
}
