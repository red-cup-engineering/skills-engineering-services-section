import { decodeRelationalValue } from "@red-cup-engineering/signgraph/relational-value";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-engineering-services-section/semantic-content-identity";

export function identifyAscribed(objectKind, document) {
  if (document?.[0] !== "ascribe" || document.length !== 3) throw new TypeError("semantic document must be explicitly typed SEN");
  return identifyJsonSemanticContent({ objectKind, value: decodeRelationalValue(document[1], document[2]), witnessRoot: EMPTY_WITNESS_ROOT });
}

export function identifyRelationalValue(objectKind, value) {
  return identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT });
}
