import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { each, has, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { loadCustomerAdmissions } from "./provider-admission.mjs";

/** The store type of a purchase: the record is the event and the time `at` it was recorded. */
export const INFERENCE_PURCHASE_TYPE = "inference-purchase";
export const INFERENCE_PURCHASED_EVENT_TYPE = "inference-work-lot/purchase";
const CUSTOMER_ADMISSIONS = fileURLToPath(new URL("../../content/dispatch/customer-admissions/admitted-customers.json", import.meta.url));
const MARKET = "urn:ame:inference-work-lot-service";

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}

function purchasePrice(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("price is required");
  const { denomination, amount } = value;
  if (!denomination || Object.getPrototypeOf(denomination) !== Object.prototype ||
      !["kind", "asset", "unit"].every((key) => typeof denomination[key] === "string" && denomination[key] !== "")) {
    throw new TypeError("price.denomination must carry nonempty kind, asset, and unit");
  }
  if (!amount || Object.getPrototypeOf(amount) !== Object.prototype ||
      typeof amount.numerator !== "string" || !/^-?[0-9]+$/u.test(amount.numerator) ||
      typeof amount.denominator !== "string" || !/^[1-9][0-9]*$/u.test(amount.denominator)) {
    throw new TypeError("price.amount must be an exact fraction with decimal-integer numerator and positive denominator strings");
  }
  return { denomination: { ...denomination }, amount: { ...amount } };
}

function purchaseUsage(value) {
  if (value === undefined) return undefined;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("usage must be an object when supplied");
  const sides = {};
  for (const label of ["input", "output"]) {
    const side = value[label];
    if (side === undefined) continue;
    if (!side || Object.getPrototypeOf(side) !== Object.prototype || !Number.isInteger(side.quantity) || side.quantity < 0 || typeof side.denomination !== "string" || side.denomination === "") {
      throw new TypeError(`usage.${label} must carry a nonnegative integer quantity and a nonempty denomination`);
    }
    sides[label] = { quantity: side.quantity, denomination: side.denomination };
  }
  return Object.keys(sides).length ? sides : undefined;
}

/** One measured exchange purchase, owned by inference rather than by an agent harness. */
export function recordInferencePurchase({ root, actor, turnId, provider, model, outcome, latencySeconds, price, exchangeId, usage, recordedAt = new Date().toISOString() }) {
  const customer = requiredText(actor, "actor");
  if (!loadCustomerAdmissions(CUSTOMER_ADMISSIONS, { market: MARKET }).has(customer)) throw new TypeError(`actor is not an admitted inference customer: ${customer}`);
  const turn = requiredText(turnId, "turnId");
  const providerId = requiredText(provider, "provider");
  const modelId = requiredText(model, "model");
  const exchange = requiredText(exchangeId, "exchangeId");
  if (!["completion", "refusal"].includes(outcome)) throw new TypeError("outcome must be completion or refusal");
  if (typeof latencySeconds !== "number" || !Number.isFinite(latencySeconds) || latencySeconds < 0) throw new TypeError("latencySeconds must be a nonnegative finite number");
  const exactPrice = purchasePrice(price);
  const measuredUsage = purchaseUsage(usage);
  const event = Object.freeze({
    type: INFERENCE_PURCHASED_EVENT_TYPE,
    version: 1,
    actor: customer,
    turn,
    provider: providerId,
    model: modelId,
    outcome,
    latencySeconds,
    exchangeId: exchange,
    price: exactPrice,
    ...(measuredUsage === undefined ? {} : { usage: measuredUsage }),
  });
  const home = resolve(requiredText(root, "root")), held = { ...event, at: recordedAt };
  const appended = !has(home, INFERENCE_PURCHASE_TYPE, semanticId(held));
  return Object.freeze({ id: put(home, INFERENCE_PURCHASE_TYPE, held), appended, event, recordedAt });
}

/** Read the purchases held under `root` as `{id, recordedAt, record}`, oldest first. */
export function readInferencePurchases({ root }) {
  const byExchange = new Map();
  for (const { address, record: { at, ...record } } of each(resolve(requiredText(root, "root")), INFERENCE_PURCHASE_TYPE)) {
    const row = { id: address, recordedAt: at, record };
    const key = `${row.record?.actor}\u0000${row.record?.exchangeId}`;
    const prior = byExchange.get(key);
    if (prior && JSON.stringify({ ...prior.record, type: undefined }) !== JSON.stringify({ ...row.record, type: undefined })) {
      throw new Error(`conflicting inference purchase records for ${key}`);
    }
    if (!prior || row.recordedAt < prior.recordedAt) byExchange.set(key, row);
  }
  return [...byExchange.values()].sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
}
