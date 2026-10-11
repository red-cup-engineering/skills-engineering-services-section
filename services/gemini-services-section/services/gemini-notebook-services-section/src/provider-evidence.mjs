import { chainWitnessEnabled, queryChainWitnesses } from "./chain-witness.mjs";

const PROVIDER = "urn:ame:notebooklm-inference-team";

export function providerEvidenceConfig(env = process.env) {
  return { rpcUrl: env.EVM_RPC_URL, keystorePath: env.EVM_KEYSTORE_PATH, passwordPath: env.EVM_KEYSTORE_PASSWORD_PATH, contractAddress: env.ONCHAIN_RESOURCE_CONTRACT, actor: PROVIDER };
}

export async function queryProviderCategory(category, options = {}) {
  if (chainWitnessEnabled()) return queryChainWitnesses({ ...providerEvidenceConfig(), category });
  const { witnessJournalAgentUrl, ...documentOptions } = options;
  const agentUrl = witnessJournalAgentUrl ?? documentOptions.agentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT;
  return (await import("@red-cup-engineering/witness-journal-document-service")).queryWitnessJournalDocumentsByCategory(category, {
    predicate: "urn:emsenn:gemini-notebook:category",
    ...documentOptions,
    agentUrl,
  });
}
