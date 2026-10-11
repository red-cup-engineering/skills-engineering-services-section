#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSignedAgentCard } from "@red-cup-engineering/a2a-services-section/agent-card-signing";
import { CUSTOMER_SERVICES, INFERENCE_PROVIDERS } from "../../src/dispatch/inference-dispatch.mjs";
import { cachedProviderCardProbe } from "../../src/dispatch/provider-card-liveness-cache.mjs";
import { loadDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";
import { observeProviderModelCatalogs } from "../../src/dispatch/provider-model-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// provider-admission.mjs requires every declared agentCard to name a
// "/.well-known/..." resource; a2a-services-section discovers by origin and
// appends its own AGENT_CARD_PATH, so the declared URL is trimmed back to
// its origin here rather than assumed to share one exact well-known name.
function agentCardOrigin(agentCardUrl) {
  const url = new URL(agentCardUrl);
  return `${url.protocol}//${url.host}`;
}
function discoverAdmittedAgentCard(agentCardUrl) {
  return discoverSignedAgentCard(agentCardOrigin(agentCardUrl));
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const code = error.cause && typeof error.cause === "object" && "code" in error.cause ? ` (${error.cause.code})` : "";
  return `${error.message}${code}`;
}

async function probe(kind, admission) {
  if (typeof admission.substrate === "string") {
    return Object.freeze({
      kind,
      actor: admission.actor,
      substrate: admission.substrate,
      ok: true,
      disposition: "customer-local-substrate-admitted",
    });
  }
  try {
    const card = kind === "inference-provider"
      ? await cachedProviderCardProbe(ROOT, admission.agentCard, () => discoverAdmittedAgentCard(admission.agentCard))
      : await discoverAdmittedAgentCard(admission.agentCard);
    return Object.freeze({ kind, actor: admission.actor, agentCard: admission.agentCard, ok: true, name: card.name, version: card.version });
  } catch (error) {
    const cached = error?.code === "provider-card-cached-offline";
    return Object.freeze({ kind, actor: admission.actor, agentCard: admission.agentCard, ok: false, reason: errorMessage(error), ...(cached ? { cached: true } : {}) });
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

export async function checkInferenceProviderHealth() {
  // Agent-card signatures are provider-owned runtime material.  Some of the
  // local providers serve that material through one signing path, so a health
  // diagnostic must not create its own concurrent verification race.  This is
  // a bounded eight-card readiness assay, not the dispatch execution path.
  const customerServices = await mapWithConcurrency(Object.values(CUSTOMER_SERVICES), 1, (admission) => probe("customer-service", admission));
  const providers = await mapWithConcurrency(INFERENCE_PROVIDERS, 1, (admission) => probe("inference-provider", admission));
  const directDescriptors = loadDirectEndpointProviderDescriptors();
  const directCatalogs = await observeProviderModelCatalogs(directDescriptors, { timeoutMs: 7_000 });
  const directEndpoints = directCatalogs.map((catalog, index) => {
    const descriptor = directDescriptors[index];
    return Object.freeze({
      provider: catalog.providerIdentity,
      model: descriptor.model,
      disposition: catalog.disposition,
      ...(catalog.status === undefined ? {} : { status: catalog.status }),
      modelCount: catalog.models.length,
      pinnedModelListed: catalog.models.some(({ id }) => id === descriptor.model),
    });
  });
  const liveProviders = providers.filter(({ ok }) => ok).length;
  const listedDirectEndpoints = directEndpoints.filter(({ pinnedModelListed }) => pinnedModelListed).length;
  const failedServices = customerServices.filter(({ ok }) => !ok);
  const ok = failedServices.length === 0 && (liveProviders > 0 || listedDirectEndpoints > 0);
  const summary = ok
    ? `customer services healthy; ${liveProviders}/${providers.length} signed provider cards live; ${listedDirectEndpoints}/${directEndpoints.length} direct endpoint model pins listed`
    : `${failedServices.length} customer service(s) unavailable; ${liveProviders}/${providers.length} signed provider cards live; ${listedDirectEndpoints}/${directEndpoints.length} direct endpoint model pins listed`;
  return Object.freeze({ type: "InferenceProviderHealth", ok, summary, customerServices, providers, directEndpoints });
}

const report = await checkInferenceProviderHealth();
// Systemd records stdout in the journal.  A restart gate needs a decisive,
// low-volume attestation there; retain the complete provider diagnostic for a
// human or an admitted monitoring customer that explicitly asks for it.
process.stdout.write(process.argv.includes("--summary")
  ? `${report.summary}\n`
  : `${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
