// inference-work-verbs — this package's contract-inference-work operation as a plain verbs
// module: its named export is the verb function, carrying a `.spec` naming this package's own
// already-admitted INFERENCE_WORK_OPERATION domain/codomain types (not bare schema literals —
// the request type's schema $refs the chat-completion-turn carrier, so its own established type,
// with that reference already resolved, is what a caller must reuse) plus an `.effects` array —
// the shape computer-system-engine's generic stdio verb server
// (scripts/serve-verbs-over-stdio.mjs) loads with
// `--verbs @red-cup-engineering/computer-inference-engine/dispatch/inference-work-verbs`.
//
// Formerly declared inline in computer-deployment-engine's former composite worker script ("the existing
// work system supplies its complete operation and declarations. Procurement authority must be
// granted by the worker's process owner.") — this package owns the operation, so this is where
// its verb contract now lives.

import { dispatchInference } from "../../src/dispatch/inference-dispatch.mjs";
import { INFERENCE_WORK_REQUEST_TYPE, INFERENCE_WORK_OUTPUT_TYPE } from "../../src/dispatch/inference-work-carriers.mjs";
import { REFUSAL_SCHEMA } from "@red-cup-engineering/computer-system-engine/verb-refusal-schema";

function contractInferenceWork(input) {
  return dispatchInference(input);
}
contractInferenceWork.spec = {
  domainType: INFERENCE_WORK_REQUEST_TYPE,
  codomainType: INFERENCE_WORK_OUTPUT_TYPE,
  refusal: REFUSAL_SCHEMA,
};
contractInferenceWork.effects = ["inference:procure"];

export { contractInferenceWork as "contract-inference-work" };
