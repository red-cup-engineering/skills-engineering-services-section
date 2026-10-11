import { assertNonemptyString as nonempty } from "@red-cup-engineering/json-services-section/assert-nonempty-string";
/** Provider-neutral incremental source contract for inference-domain contributions. */
import { requireJsonValue } from "@red-cup-engineering/json-services-section";

export function inferenceStreamMove(input) {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new RangeError("inference stream sequence: expected a non-negative safe integer");
  }
  return Object.freeze({
    kind: "metroplat.inference.stream-move",
    type: nonempty(input.type, "inference stream move type"),
    channel: nonempty(input.channel, "inference stream move channel"),
    sequence: input.sequence,
    body: requireJsonValue(input.body, "inference stream move body"),
    observedAt: nonempty(input.observedAt, "inference stream move observedAt"),
  });
}

export function inferenceSourceMove(move) {
  return Object.freeze({ kind: "metroplat.inference.source-move", move: inferenceStreamMove(move) });
}

export function inferenceSourceTerminal(outcome) {
  return Object.freeze({ kind: "metroplat.inference.source-terminal", outcome });
}
