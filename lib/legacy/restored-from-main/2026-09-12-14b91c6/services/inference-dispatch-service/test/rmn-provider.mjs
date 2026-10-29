import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveContractedAgent } from "@red-cup-engineering/a2a-contracted-agent-service";
import { ephemeralAgentCardSigning } from "@red-cup-engineering/a2a-agent-card-key-service/testing";

const RMN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../../../../services/software-services-section/services/semiotic-software-services-section/services/relation-model-notation-services-section/services/rmn-conformance-service");

// The contracted-agent service now requires the membrane's durable sources,
// including for an in-process provider used solely by this integration test.
function memoryTaskSource() {
  const records = new Map();
  const key = (taskId, tenant = "") => `${tenant}\u0000${taskId}`;
  return Object.freeze({
    async put(record) { records.set(key(record.taskId, record.tenant), structuredClone(record)); return structuredClone(record); },
    async get({ taskId, tenant = "" }) { const record = records.get(key(taskId, tenant)); return record === undefined ? null : structuredClone(record); },
    async list({ tenant = "" } = {}) { return [...records.values()].filter((record) => record.tenant === tenant).map((record) => structuredClone(record)); },
  });
}

function memoryCoordinationSource() {
  const records = new Map();
  const coordinate = ({ namespace, tenant = "", key }) => `${namespace}\u0000${tenant}\u0000${key}`;
  return Object.freeze({
    async put(record) { const stored = { ...structuredClone(record), contentSha256: "memory", etag: randomUUID() }; records.set(coordinate(record), stored); return structuredClone(stored); },
    async get(record) { const stored = records.get(coordinate(record)); return stored === undefined ? null : structuredClone(stored); },
    async list({ namespace, tenant = "" }) { return [...records.values()].filter((record) => record.namespace === namespace && record.tenant === tenant).map((record) => structuredClone(record)); },
    async remove(record) { return records.delete(coordinate(record)); },
  });
}

export async function startRmnProvider() {
  const socket = createServer(); await new Promise((accept) => socket.listen(0, "127.0.0.1", accept));
  const port = socket.address().port; await new Promise((accept) => socket.close(accept));
  const baseUrl = `http://127.0.0.1:${port}`, prior = process.env.RMN_CONFORMANCE_AGENT;
  const running = await serveContractedAgent({ port, host: "127.0.0.1", baseUrl,
    agentCard: resolve(RMN_ROOT, "content/agent-cards/rmn-semantic-conformance.json"),
    executor: process.execPath, executorArgs: [resolve(import.meta.dirname, "execute-rmn-conformance-task.mjs")],
    taskSource: memoryTaskSource(), coordinationSource: memoryCoordinationSource(),
    ...ephemeralAgentCardSigning(baseUrl, "work-lot-rmn-test") });
  process.env.RMN_CONFORMANCE_AGENT = `${baseUrl}/.well-known/agent-card.json`;
  const stop = async () => {
    if (prior === undefined) delete process.env.RMN_CONFORMANCE_AGENT; else process.env.RMN_CONFORMANCE_AGENT = prior;
    await new Promise((accept) => running.server.close(accept));
  };
  stop.agentCardUrl = `${baseUrl}/.well-known/agent-card.json`;
  return stop;
}
