/** Configured-customer inference capability; protocols project these operations. */
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";
import { ACTOR_TOKENS, dispatchInferenceInputSchema,
  CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA, RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA,
  DISPATCH_INFERENCE_INPUT_SCHEMA, INSPECT_INFERENCE_RESOURCES_INPUT_SCHEMA,
} from "./inference-dispatch-mcp-contract.mjs";
import { inferenceDispatchPort } from "./inference-dispatch-port.mjs";

const declarations = Object.freeze([
  {
    name: "inspect_inference_resources",
    description: "Inspect configured API models and separately supplied account-artifact capacity observations, including expiry and observed remaining capacity, without invoking inference.",
    inputSchema: INSPECT_INFERENCE_RESOURCES_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "dispatch_inference",
    description: "Solicit customer-admitted sovereign inference providers and execute one direct typed SEN/A2A inference act.",
    inputSchema: DISPATCH_INFERENCE_INPUT_SCHEMA,
  },
  {
    name: "classify_inference_demand",
    description: "Classify bounded demand before inference without sending source context.",
    inputSchema: CLASSIFY_INFERENCE_DEMAND_INPUT_SCHEMA,
  },
  {
    name: "record_inference_outcome",
    description: "Record one attributable receiver acceptance or refusal, or void an earlier judgment on the same delivery.",
    inputSchema: RECORD_INFERENCE_OUTCOME_INPUT_SCHEMA,
  },
]);

export function inferenceOperations(binding, options = {}) {
  const port = options.port ?? inferenceDispatchPort({ environment: options.environment ?? process.env });
  const token = ACTOR_TOKENS.get(port.customer) ?? "customer";
  const customerName = token.charAt(0).toUpperCase() + token.slice(1);
  return Object.freeze(declarations.map(declaration => {
    const verb = "inference-" + declaration.name.replaceAll("_", "-");
    const pure = declaration.name === "classify_inference_demand";
    const read = declaration.name === "inspect_inference_resources";
    return operation({
      verb, summary: declaration.description, description: declaration.description,
      inputFormat: "json", outputFormat: "json",
      domain: schemaFrom({ $id: verb + "/input", ...(declaration.name === "dispatch_inference"
        ? dispatchInferenceInputSchema(customerName, port.customer) : declaration.inputSchema) }),
      codomain: schemaFrom({ $id: verb + "/output", type: "object" }),
      effects: { class: pure ? "pure" : read ? "host-read" : "external",
        replay: pure || read ? "safe" : "coordinated",
        coordination: pure || read ? "coordination-free" : "coordination-required",
        deterministic: pure, totality: "partial" },
      run: async input => {
        const result = await port.call(declaration.name, input);
        const value = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === "text").text);
        if (result.isError) throw new Error(value.reason ?? "inference operation refused", { cause: value });
        return value;
      },
    });
  }));
}
