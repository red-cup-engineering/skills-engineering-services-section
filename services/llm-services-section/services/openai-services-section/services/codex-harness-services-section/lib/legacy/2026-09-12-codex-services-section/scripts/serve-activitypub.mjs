#!/usr/bin/env node
// Bare Cedar Fog Codex enterprise ActivityPub face.
//
// Completion of the 2026-07-26 network-custody cutover for this face: the
// @red-cup-engineering/activitypub-services-section server contract now
// refuses to start without purchased network KV and inbox custody adapters
// (server.mjs: "ActivityPub service requires purchased network KV and inbox
// custody adapters"). This entrypoint constructs the settlement's own
// onchain custody adapters — ERC-5219 resources on the Union alpha chain
// eip155:5615610 — and passes them to the library, exactly as the migrated
// settlement-pulse face (src/onchain-server.mjs) does, minus the
// settlement-pulse-specific outbox behavior which belongs to that cell only.
//
// Required environment (systemd unit bare-cedar-fog-codex-activitypub):
//   EVM_RPC_URL, EVM_CHAIN_ID, EVM_KEYSTORE_PATH, EVM_KEYSTORE_PASSWORD_PATH,
//   ONCHAIN_RESOURCE_CONTRACT, plus the ACTIVITYPUB_* variables the library
//   server already reads (origin, identifier, actor name/summary, keys path,
//   inbox bearer token file, HOST, PORT).

import {
  OnchainResourceClient,
  createOnchainActivityPubAdapters,
  loadOnchainWallet,
} from "@red-cup-engineering/activitypub-services-section/onchain";
import { serveActivityPubProvider } from "@red-cup-engineering/activitypub-services-section/server";
import { extractRmnActivity, projectRmnActivity } from "@red-cup-engineering/activitypub-services-section/rmn-activity";
import { executeA2aOperationBytes } from "../src/a2a-executor.mjs";

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

export async function main() {
  const wallet = await loadOnchainWallet({
    rpcUrl: required("EVM_RPC_URL"),
    keystorePath: required("EVM_KEYSTORE_PATH"),
    passwordPath: required("EVM_KEYSTORE_PASSWORD_PATH"),
  });
  const actor = required("ACTIVITYPUB_IDENTIFIER");
  const origin = required("ACTIVITYPUB_ORIGIN").replace(/\/$/u, "");
  const agentCard = required("ACTIVITYPUB_A2A_AGENT_CARD");
  // A public Actor cannot start as a bare nickname or a URN projection.  Its
  // two identity axes must already be settled: an EVM-root DID and its RMN
  // capability-cell content address.
  const controller = required("ACTIVITYPUB_CONTROLLER");
  const cell = required("ACTIVITYPUB_CELL_ID");
  const client = new OnchainResourceClient({ contractAddress: required("ONCHAIN_RESOURCE_CONTRACT"), wallet });
  const adapters = createOnchainActivityPubAdapters({ client, actor });
  return serveActivityPubProvider({
    origin,
    kv: adapters.kv,
    inbox: adapters.inbox,
    queue: adapters.queue,
    controller,
    cell,
    listOutbox: adapters.outbox.list,
    onActivity: async ({ jsonLd }) => {
      const incomingActor = jsonLd?.actor;
      if (typeof incomingActor !== "string") throw new TypeError("verified ActivityPub A2A carrier must name its actor");
      const received = extractRmnActivity(jsonLd, {
        expectedActor: incomingActor,
        expectedRecipient: `${origin}/actors/${actor}`,
      });
      const result = executeA2aOperationBytes(received.objectBytes);
      const response = projectRmnActivity({
        type: "Accept",
        origin,
        identifier: actor,
        recipient: incomingActor,
        objectBytes: result,
        agentCard,
        eventTime: new Date().toISOString(),
      });
      await adapters.outbox.publish(response);
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
