import { readFileSync } from "node:fs";
import { AGENT_CARD_PATH, AgentCard, Message, Role, Task, TaskState } from "@a2a-js/sdk";
import { ClientFactory, JsonRpcTransportFactory, RestTransportFactory, ServiceParameters, createAuthenticatingFetchWithRetry, withA2AExtensions } from "@a2a-js/sdk/client";
import { discoverAgentCard, discoverSignedAgentCard } from "./agent-card-discovery.mjs";
import { extractRmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, circuitInterfaceFromAgentCard } from "./sovereign-provider-interface.mjs";

export function a2aResultParts(result) {
  if (Array.isArray(result?.parts)) return result.parts;
  if (Array.isArray(result?.status?.message?.parts)) return result.status.message.parts;
  if (Array.isArray(result?.artifacts)) return result.artifacts.flatMap((artifact) => artifact.parts ?? []);
  return [];
}
export function a2aResultMetadata(result) {
  if (Array.isArray(result?.parts)) return result.metadata ?? {};
  if (Array.isArray(result?.status?.message?.parts)) return result.status.message.metadata ?? {};
  return result?.metadata ?? {};
}

export async function discoverValidatedAgentCard(agentUrl, { requireSignature = false, signal, discover } = {}) {
  return await (discover ?? (requireSignature ? discoverSignedAgentCard : discoverAgentCard))({ agentUrl, signal });
}

function bearerFetch(path) {
  if (!path) return undefined;
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.length > 4096) throw new Error("A2A Bearer token must contain 1 through 4096 bytes");
  const token = bytes.toString("utf8").replace(/\r?\n$/u, "");
  if (!/^[A-Za-z0-9\-._~+/]+=*$/u.test(token)) throw new Error("A2A Bearer token file must contain one RFC 6750 bearer token");
  return createAuthenticatingFetchWithRetry(fetch, { headers: async () => ({ Authorization: `Bearer ${token}` }), shouldRetryWithHeaders: async () => undefined });
}

function cardRequiresBearer(card) {
  const requirements = card.securityRequirements ?? [], schemes = card.securitySchemes ?? {};
  if (requirements.length === 0) return false;
  if (requirements.length !== 1) throw new Error("A2A client supports exactly one global security requirement");
  const names = Object.keys(requirements[0]?.schemes ?? {});
  const declared = names.length === 1 ? schemes[names[0]] : undefined;
  const scheme = declared?.httpAuthSecurityScheme ?? (declared?.scheme?.$case === "httpAuthSecurityScheme" ? declared.scheme.value : undefined);
  if (!scheme || String(scheme.scheme).toLowerCase() !== "bearer") throw new Error("A2A client currently supports only standard HTTP Bearer security");
  return true;
}

async function linked(agentUrl, extensions, requireSignature, signal, bearerTokenFile) {
  const discovered = await discoverValidatedAgentCard(agentUrl, { requireSignature, signal });
  const card = AgentCard.toJSON(discovered);
  const needsBearer = cardRequiresBearer(card);
  if (needsBearer !== Boolean(bearerTokenFile)) throw new Error(needsBearer ? "A2A Agent Card requires a Bearer token file" : "A2A Bearer token supplied to an Agent Card that does not declare Bearer security");
  const authenticatedFetch = bearerFetch(bearerTokenFile);
  const factory = authenticatedFetch ? new ClientFactory({ transports: [new JsonRpcTransportFactory({ fetchImpl: authenticatedFetch }), new RestTransportFactory({ fetchImpl: authenticatedFetch })] }) : new ClientFactory();
  const parsed = new URL(agentUrl);
  const client = await (parsed.pathname.endsWith(`/${AGENT_CARD_PATH}`) ? factory.createFromUrl(agentUrl, "") : factory.createFromAgentCard(discovered));
  const supported = new Set([SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, ...extensions]), negotiated = new Set(extensions);
  for (const extension of card.capabilities?.extensions ?? []) if (extension.required === true) {
    if (!supported.has(extension.uri)) throw new Error(`A2A agent requires an unsupported extension: ${String(extension.uri)}`);
    negotiated.add(extension.uri);
  }
  if (negotiated.has(SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION)) circuitInterfaceFromAgentCard(card);
  return { agentCard: card, authentication: { required: requireSignature, agentCardSignatureVerified: requireSignature }, client, extensions: [...negotiated], serviceParameters: ServiceParameters.create(withA2AExtensions(...negotiated)) };
}

const terminal = new Set([TaskState.TASK_STATE_COMPLETED, TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_INPUT_REQUIRED, TaskState.TASK_STATE_REJECTED, TaskState.TASK_STATE_AUTH_REQUIRED]);
export class A2aTaskPendingError extends Error {
  constructor(task, agentUrl) { super(`A2A task ${task?.id ?? "(unknown)"} remains nonterminal`); this.name = "A2aTaskPendingError"; this.task = Task.toJSON(task); this.taskId = task?.id; this.agentUrl = agentUrl; }
}
function completed(result, connection, inputNi) {
  if (typeof result?.id === "string" && !terminal.has(result.status?.state)) throw new A2aTaskPendingError(result, connection.agentUrl);
  const state = result?.status?.state, disposition = a2aResultMetadata(result).disposition;
  if (disposition === "refused" || [TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_INPUT_REQUIRED, TaskState.TASK_STATE_REJECTED, TaskState.TASK_STATE_AUTH_REQUIRED].includes(state)) {
    const reason = a2aResultParts(result).find((part) => part?.content?.$case === "text")?.content?.value ?? "A2A agent refused the RMN task";
    const error = new Error(reason); error.result = result; error.inputNi = inputNi; throw error;
  }
  const output = extractRmnPart(a2aResultParts(result));
  return { result, inputNi, outputNi: output.ni, agentCard: connection.agentCard, authentication: connection.authentication, extensions: connection.extensions };
}

export async function submitRmnTask({ agentUrl, extensions = [], message: source, requireSignature = false, bearerTokenFile, signal }) {
  const message = Message.fromJSON(source);
  if (message.role !== Role.ROLE_USER) throw new Error("outbound A2A message role must be ROLE_USER");
  const input = extractRmnPart(message.parts), connection = { ...(await linked(agentUrl, extensions, requireSignature, signal, bearerTokenFile)), agentUrl };
  const task = await connection.client.sendMessage({ message, configuration: { acceptedOutputModes: ["application/rmn+cbor"], historyLength: 0, returnImmediately: true } }, { signal, serviceParameters: connection.serviceParameters });
  if (typeof task?.id !== "string") throw new Error("durable A2A submission did not return an opaque task identity");
  return Object.freeze({ task: Task.toJSON(task), taskId: task.id, inputNi: input.ni, agentCard: connection.agentCard, authentication: connection.authentication, extensions: connection.extensions });
}

export async function resumeRmnTask({ agentUrl, taskId, inputNi, extensions = [], requireSignature = false, bearerTokenFile, signal }) {
  const connection = { ...(await linked(agentUrl, extensions, requireSignature, signal, bearerTokenFile)), agentUrl };
  const result = await connection.client.getTask({ id: taskId, historyLength: 0 }, { signal, serviceParameters: connection.serviceParameters });
  return completed(result, connection, inputNi ?? a2aResultMetadata(result).inputNi);
}

export async function sendRmnTask(options) {
  const { agentUrl, extensions = [], message: source, requireSignature = false, bearerTokenFile, signal } = options;
  const message = Message.fromJSON(source);
  if (message.role !== Role.ROLE_USER) throw new Error("outbound A2A message role must be ROLE_USER");
  const input = extractRmnPart(message.parts), connection = { ...(await linked(agentUrl, extensions, requireSignature, signal, bearerTokenFile)), agentUrl };
  const result = await connection.client.sendMessage({ message, configuration: { acceptedOutputModes: ["application/rmn+cbor"], historyLength: 0, returnImmediately: false } }, { signal, serviceParameters: connection.serviceParameters });
  return completed(result, connection, input.ni);
}
