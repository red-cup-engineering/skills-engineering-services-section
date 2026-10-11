/** Derive model tool affordances from the protocol-neutral RPC description. */

import { inferenceTool } from "./inference-model.mjs";

export function inferenceToolsFromRpcDescription(description) {
  return Object.freeze(description.operations.map((operation) => inferenceTool({
    name: operation.verb,
    operation: operation.ref,
    ...(operation.summary === undefined ? {} : { description: operation.summary }),
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        input: operation.inputSchema ?? Object.freeze({ description: `The ${operation.inputFormat} input for ${operation.verb}.` }),
      }),
      required: Object.freeze(["input"]),
      additionalProperties: false,
    }),
    strict: true,
  })));
}
