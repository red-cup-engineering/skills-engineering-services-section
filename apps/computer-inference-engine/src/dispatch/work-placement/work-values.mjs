/**
 * @param {*} value The value value.
 * @param {*} label The label value.
 * @returns {*} The admitted or derived value.
 */
export function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(label + " must be one object");
  return value;
}
/**
 * @param {*} value The value value.
 * @param {*} label The label value.
 * @returns {*} The admitted or derived value.
 */
export function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(label + " must be nonempty text");
  return value;
}
/**
 * @param {*} value The value value.
 * @param {*} label The label value.
 * @returns {*} The admitted or derived value.
 */
export function instant(value, label) {
  text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) throw new TypeError(label + " must be an ISO 8601 instant with offset");
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch)) throw new TypeError(label + " must be a valid ISO 8601 instant");
  return epoch;
}
/**
 * @param {*} value The value value.
 * @param {*} label The label value.
 * @returns {*} The admitted or derived value.
 */
export function textSet(value, label) {
  if (!Array.isArray(value)) throw new TypeError(label + " must be an array of nonempty text");
  // Inspect actual positions, including holes, without trusting a custom iterator.
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || item.trim() === "") throw new TypeError(label + " must be an array of nonempty text");
    seen.add(item);
  }
  if (seen.size !== value.length) throw new TypeError(label + " must not contain duplicates");
  // Keep the original iterator/cardinality gate as an additional admission check.
  if (new Set(value).size !== value.length) throw new TypeError(label + " must not contain duplicates");
  return value;
}
/**
 * @param {*} left The left value.
 * @param {*} right The right value.
 * @returns {*} The admitted or derived value.
 */
/** @param {*} numeratorValue The numerator value. @param {*} denominatorValue The denominator value. @param {*} label The boundary label. @returns {{ readonly numerator: string, readonly denominator: string }} A nonnegative canonical ratio. */
export function normalizedFraction(numeratorValue, denominatorValue, label) {
  let normalized;
  try { normalized = hostRatio(numeratorValue, denominatorValue); }
  catch (error) { throw new TypeError(label + "." + error.message); }
  if (normalized.numerator.startsWith("-")) throw new TypeError(label + " must be nonnegative");
  return normalized;
}
/**
 * @param {*} value The value value.
 * @param {*} label The label value.
 * @returns {*} The admitted or derived value.
 */
export function fraction(value, label) {
  object(value, label);
  const normalized = normalizedFraction(value.numerator, value.denominator, label);
  if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) throw new TypeError(label + " must be a normalized exact fraction");
  return normalized;
}
/**
 * @param {*} numerator The numerator value.
 * @param {*} denominator The denominator value.
 * @returns {*} The admitted or derived value.
 */
export function exactAmount(numerator, denominator = 1) {
  return normalizedFraction(String(numerator), String(denominator), "exact amount");
}
/**
 * @param {*} left The left value.
 * @param {*} right The right value.
 * @returns {*} The admitted or derived value.
 */
export function compareFraction(left, right) {
  return compareHostRatio(left, right);
}
/**
 * @param {*} left The left value.
 * @param {*} right The right value.
 * @returns {*} The admitted or derived value.
 */
export function addFraction(left, right) {
  return addHostRatio(left, right);
}
/**
 * @param {*} left The left value (nonnegative).
 * @param {*} right The right value (positive; never zero for a Beta(1,1) posterior mean).
 * @returns {*} The admitted or derived value, left divided by right.
 */
export function divideFraction(left, right) {
  return hostRatio(BigInt(left.numerator) * BigInt(right.denominator), BigInt(left.denominator) * BigInt(right.numerator));
}
/**
 * @param {*} total The total value.
 * @param {*} count The count value.
 * @returns {*} The admitted or derived value.
 */
export function mean(total, count) {
  return exactAmount(total.numerator, BigInt(total.denominator) * BigInt(count));
}
/**
 * @param {*} value The value value.
 * @returns {*} The admitted or derived value.
 */
export function dimensionKey(value) {
  return [value.kind ?? value.resource, value.asset ?? "", value.unit].join("\u0000");
}
/**
 * @param {*} left The left value.
 * @param {*} right The right value.
 * @returns {*} The admitted or derived value.
 */
export function sameKeys(left, right) {
  return left.length === right.length && left.every((key) => right.includes(key));
}
/**
 * @param {*} value The value value.
 * @param {*} label The label value.
 * @param {*} category The category value.
 * @param {*} amountRequired The amountRequired value.
 * @returns {*} The admitted or derived value.
 */
export function validateDimension(value, label, category, amountRequired = true) {
  object(value, label);
  if (category === "consideration") {
    text(value.kind, label + ".kind");
    text(value.asset, label + ".asset");
  } else text(value.resource, label + ".resource");
  text(value.unit, label + ".unit");
  if (amountRequired) fraction(value.amount, label + ".amount");
  return value;
}
/**
 * @param {*} values The values value.
 * @param {*} label The label value.
 * @param {*} category The category value.
 * @param {*} amountRequired The amountRequired value.
 * @returns {*} The admitted or derived value.
 */
export function validateUniqueDimensions(values, label, category, amountRequired = true) {
  if (!Array.isArray(values)) throw new TypeError(label + " must be an array");
  values.forEach((dimension, index) => validateDimension(dimension, label + "[" + index + "]", category, amountRequired));
  const keys = values.map(dimensionKey);
  if (new Set(keys).size !== keys.length) throw new TypeError(label + " repeats a dimension");
  return values;
}
import { addHostRatio, compareHostRatio, hostRatio } from "@red-cup-engineering/metrologic/number/wire-ratio";
