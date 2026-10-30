// The Codex actuation office's own EXECUTE-stage gate. Thin caller of Red
// Cup Engineering's authority-bounded-integration-service — the same
// mechanics the seated Claude peer now hires too, rather than each
// enterprise hand-copying them under its own name. This file supplies only
// this enterprise's own actor/customer identity, hash functions, and the
// actuator sub-identity distinct from the enterprise's own main actor; it
// never re-implements the gate itself.

import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ACTOR, CUSTOMER, DEFAULT_STATE_ROOT, identity } from "./enterprise.mjs";
import { semanticByteIdentity } from "./semiotic-circuit.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_SHAPE =
  "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-inference-system-services-section/services/llm-services-section/services/authority-bounded-integration-service/src/client.mjs";

function repoRootFromPackage() {
  let current = PACKAGE_ROOT;
  for (;;) {
    if (existsSync(join(current, SERVICE_SHAPE))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`cannot resolve repository root containing ${SERVICE_SHAPE}`);
    current = parent;
  }
}

function byteDigest(bytes) {
  return semanticByteIdentity(bytes, "bare-cedar-fog-codex.authority-carrier").id;
}

export const AUTHORITY_BOUNDED_INTEGRATION_ACTOR = "urn:ame:codex-authority-bounded-integration-actuator";
export const AUTHORITY_BOUNDED_INTEGRATION_OFFER = "urn:offer:codex-authority-bounded-integration";

const { createAuthorityBoundedIntegration } = await import(pathToFileURL(join(repoRootFromPackage(), SERVICE_SHAPE)).href);

const client = createAuthorityBoundedIntegration({
  actor: ACTOR,
  customer: CUSTOMER,
  identity,
  byteDigest,
  defaultStateRoot: DEFAULT_STATE_ROOT,
  provider: AUTHORITY_BOUNDED_INTEGRATION_ACTOR,
  offer: AUTHORITY_BOUNDED_INTEGRATION_OFFER,
});

export const AUTHOR_PROCESS_DIGEST = client.AUTHOR_PROCESS_DIGEST;
export const codexMutationIntent = client.mutationIntent;
export const leaderAuthority = client.leaderAuthority;

// The shared client only ever sees an explicit workspaceRoot/claimsRoot — it
// carries no knowledge of any provider's own env var convention. Resolving
// CODEX_AUTHORIZED_WORKSPACE_ROOT / CODEX_AUTHORITY_CLAIMS_ROOT is this
// enterprise's own business, done here, once, before delegating.
export function executeAuthorityBoundIntegration(input, options = {}) {
  return client.executeAuthorityBoundIntegration(input, {
    ...options,
    workspaceRoot: options.workspaceRoot ?? process.env.CODEX_AUTHORIZED_WORKSPACE_ROOT ?? process.cwd(),
    claimsRoot: options.claimsRoot ?? process.env.CODEX_AUTHORITY_CLAIMS_ROOT ?? resolve(DEFAULT_STATE_ROOT, "authority-claims"),
  });
}
