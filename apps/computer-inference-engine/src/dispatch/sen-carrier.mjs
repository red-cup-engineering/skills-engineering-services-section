import {
  decodeCanonical as decodeCarrier,
  encodeCanonical as normalizedCarrierBytes,
} from "@red-cup-engineering/cbor-services-section";
import { arrayTerm, objectTerm, stringTerm, termToJson } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/json-codec";
import { tm } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation";
import { checkTy, inferTy } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/typing";
import {
  admitNormalizedSemanticContent,
  identifyNormalizedSemanticContent,
} from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import {
  EMPTY_WITNESS_ROOT,
} from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";

const JSON_VALUE_KIND = "inference-work-lot.json-value";

export function identifyJsonValue(value) {
  const term = jsonTerm(value);
  const semanticType = inferTy([], term);
  if (semanticType === null || !checkTy([], term, semanticType)) throw new TypeError("JSON carrier did not earn a closed SEN type");
  const identified = identifyNormalizedSemanticContent({
    objectKind: JSON_VALUE_KIND,
    semanticType,
    term,
    witnessRoot: EMPTY_WITNESS_ROOT,
  });
  return Object.freeze({
    value,
    semanticType: identified.envelope.semanticType,
    term: identified.envelope.settledBody,
    envelope: identified.envelope,
    bytes: identified.bytes,
    token: identified.token,
  });
}

// The 0.0.1 codec exposes SEN charge names when decoding booleans. A work-lot
// JSON carrier must instead preserve ordinary JSON leaves byte-for-byte in
// meaning, including false and strings such as "denied".
function jsonTerm(value, path = "$") {
  if (value === null) return tm.mark(JSON.stringify(null));
  if (typeof value === "boolean" || typeof value === "number") return tm.mark(JSON.stringify(value));
  if (typeof value === "string") return stringTerm(value);
  if (Array.isArray(value)) return arrayTerm(value.map((item, index) => jsonTerm(item, `${path}[${index}]`)));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`SEN JSON carrier admits only JSON values; invalid value at ${path}`);
  }
  return objectTerm(Object.entries(value).map(([key, item]) => [key, jsonTerm(item, `${path}.${key}`)]));
}

export function decodeJsonValue(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("SEN JSON carrier bytes must be a Uint8Array");
  const source = Buffer.from(bytes);
  const identified = admitNormalizedSemanticContent(source);
  if (identified.envelope.objectKind !== JSON_VALUE_KIND) throw new TypeError("SEN JSON carrier has the wrong semantic object kind");
  const term = identified.envelope.settledBody;
  return Object.freeze({
    value: termToJson(term),
    semanticType: identified.envelope.semanticType,
    term,
    envelope: identified.envelope,
    bytes: source,
    token: identified.token,
  });
}

export const jsonValueId = (value) => identifyJsonValue(value).token;
const CONFIGURATION_FIELDS = new Set(["provider", "model", "executionClass", "endpoint", "endpointClass", "machine", "runtimeVersion", "mode", "maximumOutputTokens", "reasoningEffort", "capabilities", "workTypes", "agentCard", "contextIdentity"]);

/**
 * Projects an A2A offer into its stable public execution facts.
 * @param {{provider: string, offer: {object?: object}}} candidate
 * @returns {object}
 */
export function a2aExecutionConfiguration({ provider, offer }) {
  const object = offer?.object ?? {};
  return executionConfiguration({ provider, model: object.model ?? null, mode: object.mode ?? null, agentCard: object.agentCard ?? null, capabilities: [...(object.capabilities ?? [])].sort(), workTypes: [...(object.workTypes ?? [])].sort() });
}

/**
 * Admits credential-free public execution facts and removes no semantic setting.
 * @param {object} value
 * @returns {object}
 */
export function executionConfiguration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("execution configuration must be one plain object");
  const visit = (item, path = "configuration") => {
    if (Array.isArray(item)) return item.map((entry, index) => visit(entry, `${path}[${index}]`));
    if (item && typeof item === "object") {
      if (Object.getPrototypeOf(item) !== Object.prototype) throw new TypeError(`${path} must contain only JSON values`);
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => {
        if (/api.?key|auth|credential/ui.test(key)) throw new TypeError(`${path}.${key} is not credential-free public configuration`);
        return [key, visit(entry, `${path}.${key}`)];
      }));
    }
    if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError(`${path} must not contain a nonfinite number`);
    if (["string", "number", "boolean"].includes(typeof item) || item === null) return item;
    throw new TypeError(`${path} must contain only JSON values`);
  };
  const projected = {};
  for (const [key, item] of Object.entries(value)) {
    if (!CONFIGURATION_FIELDS.has(key)) throw new TypeError(`execution configuration field ${key} is not admitted`);
    projected[key] = visit(item, key);
  }
  if (typeof projected.provider !== "string" || projected.provider.trim() === "") throw new TypeError("execution configuration.provider must be nonempty text");
  if (projected.maximumOutputTokens !== undefined && (!Number.isSafeInteger(projected.maximumOutputTokens) || projected.maximumOutputTokens < 1)) throw new TypeError("execution configuration.maximumOutputTokens must be a positive integer");
  return Object.freeze(projected);
}

export const executionConfigurationIdentity = (value) => jsonValueId(executionConfiguration(value));
export const senCarrierId = (term) => {
  const semanticType = inferTy([], term);
  if (semanticType === null || !checkTy([], term, semanticType)) throw new TypeError("SEN carrier did not earn a type");
  return identifyNormalizedSemanticContent({
    objectKind: "inference-work-lot.sen-carrier",
    semanticType,
    term,
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).token;
};
export const decodeNormalizedCarrier = (bytes) => decodeCarrier(bytes);
export { normalizedCarrierBytes };
