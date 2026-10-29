import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export function loadLegacyBridgeRegistry(path) {
  const registryPath = resolve(path), registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const base = registry.baseDir ? resolve(dirname(registryPath), registry.baseDir) : dirname(registryPath);
  for (const endpoint of registry.endpoints ?? []) {
    if (endpoint.command && !isAbsolute(endpoint.command)) endpoint.command = resolve(base, endpoint.command);
    if (endpoint.cwd && !isAbsolute(endpoint.cwd)) endpoint.cwd = resolve(base, endpoint.cwd);
  }
  return registry;
}

function outputContract(packet) {
  const format = packet?.params?.response_format;
  if (format?.type === "json_schema" && format.json_schema?.schema) return { format: "json", mode: "json_schema", schema: format.json_schema.schema };
  if (format?.type === "json_object") return { format: "json" };
  return undefined;
}

export function legacyPacketToFabricJob(packet, id) {
  const maxTokens = packet["max-tokens"] ?? packet.max_tokens;
  return {
    id,
    messages: packet.messages,
    workType: "inquiry",
    requiredCapabilities: ["chat"],
    ...(Number.isInteger(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
    ...(outputContract(packet) ? { outputContract: outputContract(packet) } : {})
  };
}

export function fabricResultToLegacyRecord(packet, result, id, wallTimeSeconds) {
  const attempts = result?.attempts ?? [];
  const cost = { "fuel-consumed": attempts.length, "wall-time-seconds": wallTimeSeconds, denomination: "liss-fabric-attempts" };
  if (typeof result?.text === "string" && result.text.length > 0) return {
    id,
    packet,
    outcome: "completion",
    completion: {
      model: result.model ?? result.endpoint ?? "liss-fabric-selected-model",
      text: result.text,
      "finish-reason": "fabric-settled",
      raw: {
        type: "InferenceFabricCompatibilityEvidence",
        jobId: result.id,
        endpoint: result.endpoint ?? null,
        attempts,
        verification: result.verification ?? null,
        routing: result.routing ?? null
      }
    },
    cost
  };
  const refusalType = result?.refusal?.type ?? "fabric-untyped-refusal";
  return {
    id,
    packet,
    outcome: "refusal",
    refusal: {
      grounds: `the cheapest-sufficient inference fabric settled without a completion: ${refusalType}`,
      unmet: [refusalType]
    },
    cost
  };
}
