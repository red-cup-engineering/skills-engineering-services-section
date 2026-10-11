/** MCP projects the configured-customer inference operations. */
import { createMcpServer } from "@red-cup-engineering/mcp-engineering-services-section/server";
import { ACTOR_TOKENS, inferenceDispatchInstructions, MCP_SERVER_INFO } from "./inference-dispatch-mcp-contract.mjs";
import { inferenceDispatchPort } from "./inference-dispatch-port.mjs";
import { inferenceOperations } from "./operations.mjs";

export function openInferenceDispatchMcp(options = {}) {
  const port = options.port ?? inferenceDispatchPort(options);
  const token = ACTOR_TOKENS.get(port.customer) ?? "customer";
  const customerName = token.charAt(0).toUpperCase() + token.slice(1);
  const operations = inferenceOperations(undefined, { ...options, port });
  const server = createMcpServer({
    name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version,
    instructions: inferenceDispatchInstructions(port.customer, customerName),
    tools: operations.map(op => ({
      name: op.verb.slice("inference-".length).replaceAll("-", "_"),
      description: op.description, inputSchema: op.domain.schema,
      annotations: { destructiveHint: false, idempotentHint: op.effects.replay === "safe",
        openWorldHint: op.effects.class !== "pure", readOnlyHint: ["pure", "host-read"].includes(op.effects.class) },
      handler: args => op.execute(args),
    })),
  });
  return Object.freeze({ handle: message => server.handleMessage(message) });
}
