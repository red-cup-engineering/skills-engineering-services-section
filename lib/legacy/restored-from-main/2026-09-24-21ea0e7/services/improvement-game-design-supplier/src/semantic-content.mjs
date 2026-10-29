import {
  EMPTY_WITNESS_ROOT,
  admitNormalizedSemanticContent,
  identifyNormalizedSemanticContent,
} from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { jsonToTerm, termToJson } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/json-codec";
import { inferTy } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/typing";

export function identifyJson(value, objectKind) {
  const term = jsonToTerm(value);
  const semanticType = inferTy([], term);
  if (semanticType === null) throw new TypeError(`${objectKind} did not derive an RMN type`);
  return identifyNormalizedSemanticContent({
    objectKind,
    semanticType,
    term,
    witnessRoot: EMPTY_WITNESS_ROOT,
  });
}

export const idOf = (value, objectKind) => identifyJson(value, objectKind).id;
export const bytesOf = (value, objectKind) => identifyJson(value, objectKind).bytes;

export function jsonFromBytes(bytes, objectKind) {
  const admitted = admitNormalizedSemanticContent(bytes);
  if (admitted.envelope.objectKind !== objectKind) {
    throw new TypeError(`expected ${objectKind}, received ${admitted.envelope.objectKind}`);
  }
  return termToJson(admitted.envelope.settledBody);
}
