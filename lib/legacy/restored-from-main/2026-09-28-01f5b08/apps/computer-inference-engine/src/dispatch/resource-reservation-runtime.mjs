import { admitWorkResourceBinding } from "./work-placement/resource-reservations.mjs";

const text = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function unavailable(reason) {
  return Object.freeze({
    resolveBinding() { throw new Error(`resource-reservations-unavailable:${reason}`); },
  });
}

/** Creates account/window reservations bound to the operator's configuration, backed by
 * whichever durable store the caller's `createStore` composes; the house has no default
 * store implementation, so a caller that supplies none gets a runtime that fails closed
 * ("durable-store-unavailable") the same way missing configuration fails closed, rather
 * than assuming unlimited capacity.
 */
export function createInferenceResourceReservationRuntime({ environment = process.env, createStore } = {}) {
  const path = text(environment.INFERENCE_RESOURCE_RESERVATION_SQLITE_PATH);
  const serializedBindings = text(environment.INFERENCE_RESOURCE_RESERVATION_BINDINGS);
  if (!path || !serializedBindings) return unavailable("operator-configuration-missing");
  let bindings;
  try {
    const decoded = JSON.parse(serializedBindings);
    if (!Array.isArray(decoded) || decoded.length === 0) throw new TypeError("bindings must be one nonempty array");
    bindings = decoded.map(admitWorkResourceBinding);
  } catch {
    return unavailable("operator-bindings-invalid");
  }
  const byProvider = new Map();
  for (const binding of bindings) {
    if (byProvider.has(binding.providerIdentity)) return unavailable("operator-bindings-ambiguous-provider");
    byProvider.set(binding.providerIdentity, binding);
  }
  let store;
  try {
    store = createStore({ path });
  } catch {
    return unavailable("durable-store-unavailable");
  }
  if (typeof store?.get !== "function" || typeof store?.compareAndSet !== "function") return unavailable("durable-store-invalid");
  return Object.freeze({
    store,
    resolveBinding(descriptor) {
      const provider = text(descriptor?.provider);
      const binding = provider ? byProvider.get(provider) : null;
      if (!binding) throw new Error("resource-account-binding-not-admitted");
      if (descriptor.accountEntitlement && descriptor.accountEntitlement.accountIdentity !== binding.accountIdentity) throw new Error("resource-account-entitlement-binding-mismatch");
      return binding;
    },
  });
}
