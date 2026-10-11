import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";

const CHAIN = "eip155:5615610";
const ACTOR = "urn:ame:notebooklm-inference-team";
let cachedWriter;
let cachedWriterKey;

function required(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}

export function chainWitnessBody({ actor = ACTOR, category, envelope, recordedAt }) {
  required(actor, "actor"); required(category, "category"); required(recordedAt, "recordedAt");
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new TypeError("witness envelope must be an object");
  return Object.freeze({ type: "SemioticExchangeChainWitness", chain: CHAIN, actor, category, recordedAt, envelope });
}

export function chainWitnessResource({ actor = ACTOR, category, graph }) {
  required(actor, "actor"); required(category, "category"); required(graph, "graph");
  return ["semiotic-exchange", "witness-journal", actor, category, graph];
}

function chainWitnessIndexResource({ actor = ACTOR, category }) {
  return ["semiotic-exchange", "witness-journal", actor, category, "index"];
}

export async function createChainWitnessWriter({ rpcUrl, keystorePath, passwordPath, contractAddress }) {
  const { OnchainResourceClient, loadOnchainWallet } = await import("@red-cup-engineering/activitypub-services-section/onchain");
  const cacheKey = [rpcUrl, keystorePath, passwordPath, contractAddress].join("\u0000");
  if (cachedWriter !== undefined && cachedWriterKey === cacheKey) return cachedWriter;
  const wallet = await loadOnchainWallet({ rpcUrl: required(rpcUrl, "EVM_RPC_URL"), keystorePath: required(keystorePath, "EVM_KEYSTORE_PATH"), passwordPath: required(passwordPath, "EVM_KEYSTORE_PASSWORD_PATH") });
  const client = new OnchainResourceClient({ contractAddress: required(contractAddress, "ONCHAIN_RESOURCE_CONTRACT"), wallet });
  cachedWriter = async ({ actor, category, envelope, recordedAt }) => {
    const body = JSON.stringify(chainWitnessBody({ actor, category, envelope, recordedAt }));
    const graph = sha256Digest(body);
    const resource = chainWitnessResource({ actor, category, graph });
    const settlement = await client.put(resource, body, "application/json");
    const indexResource = chainWitnessIndexResource({ actor, category });
    const current = await client.get(indexResource);
    const graphs = current === undefined ? [] : JSON.parse(current.body);
    if (!Array.isArray(graphs) || graphs.some((item) => typeof item !== "string")) throw new Error("Semiotic Exchange Chain witness index is malformed");
    if (!graphs.includes(graph)) await client.put(indexResource, JSON.stringify([...graphs, graph]), "application/json");
    return Object.freeze({ chain: CHAIN, graph, resource, ...settlement });
  };
  cachedWriterKey = cacheKey;
  return cachedWriter;
}

export async function queryChainWitnesses({ rpcUrl, keystorePath, passwordPath, contractAddress, actor = ACTOR, category }) {
  const { OnchainResourceClient, loadOnchainWallet } = await import("@red-cup-engineering/activitypub-services-section/onchain");
  const wallet = await loadOnchainWallet({ rpcUrl: required(rpcUrl, "EVM_RPC_URL"), keystorePath: required(keystorePath, "EVM_KEYSTORE_PATH"), passwordPath: required(passwordPath, "EVM_KEYSTORE_PASSWORD_PATH") });
  const client = new OnchainResourceClient({ contractAddress: required(contractAddress, "ONCHAIN_RESOURCE_CONTRACT"), wallet });
  const index = await client.get(chainWitnessIndexResource({ actor, category }));
  if (index === undefined) return [];
  const graphs = JSON.parse(index.body);
  if (!Array.isArray(graphs) || graphs.some((item) => typeof item !== "string")) throw new Error("Semiotic Exchange Chain witness index is malformed");
  return Promise.all(graphs.map(async (graph) => {
    const item = await client.get(chainWitnessResource({ actor, category, graph }));
    if (item === undefined) throw new Error(`Semiotic Exchange Chain witness is unavailable: ${graph}`);
    const witness = JSON.parse(item.body);
    return { id: graph, value: witness.envelope };
  }));
}

export function chainWitnessEnabled(env = process.env) {
  return env.SEMIOTIC_EXCHANGE_CHAIN === "1";
}
