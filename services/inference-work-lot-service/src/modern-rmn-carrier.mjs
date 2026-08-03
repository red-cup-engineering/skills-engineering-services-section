import {
  decodeNormalizedCarrier as decodeCarrier,
  normalizedCarrierBytes,
} from "@red-cup-engineering/relation-model-notation-cbor-codec";
import { arrayTerm, objectTerm, stringTerm, termToJson } from "@red-cup-engineering/relation-model-notation-json-codec";
import { tm } from "@red-cup-engineering/relation-model-notation";
import { checkTy, inferTy } from "@red-cup-engineering/relation-model-notation-typing";
import {
  admitNormalizedSemanticContent,
  EMPTY_WITNESS_ROOT,
  identifyNormalizedSemanticContent,
} from "@red-cup-engineering/semantic-content-identify-service";

const JSON_VALUE_KIND = "inference-work-lot.json-value";

export function identifyJsonValue(value) {
  const term = jsonTerm(value);
  const semanticType = inferTy([], term);
  if (semanticType === null || !checkTy([], term, semanticType)) throw new TypeError("JSON carrier did not earn a closed RMN type");
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

// The 0.0.1 codec exposes RMN charge names when decoding booleans. A work-lot
// JSON carrier must instead preserve ordinary JSON leaves byte-for-byte in
// meaning, including false and strings such as "denied".
function jsonTerm(value) {
  if (value === null) return tm.star();
  if (typeof value === "boolean" || typeof value === "number") return tm.mark(JSON.stringify(value));
  if (typeof value === "string") return stringTerm(value);
  if (Array.isArray(value)) return arrayTerm(value.map(jsonTerm));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("RMN JSON carrier admits only JSON values");
  return objectTerm(Object.entries(value).map(([key, item]) => [key, jsonTerm(item)]));
}

export function decodeJsonValue(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("RMN JSON carrier bytes must be a Uint8Array");
  const source = Buffer.from(bytes);
  const identified = admitNormalizedSemanticContent(source);
  if (identified.envelope.objectKind !== JSON_VALUE_KIND) throw new TypeError("RMN JSON carrier has the wrong semantic object kind");
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
export const rmnCarrierId = (term) => {
  const semanticType = inferTy([], term);
  if (semanticType === null || !checkTy([], term, semanticType)) throw new TypeError("RMN carrier did not earn a type");
  return identifyNormalizedSemanticContent({
    objectKind: "inference-work-lot.rmn-carrier",
    semanticType,
    term,
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).token;
};
export const decodeNormalizedCarrier = (bytes) => decodeCarrier(bytes);
export { normalizedCarrierBytes };
