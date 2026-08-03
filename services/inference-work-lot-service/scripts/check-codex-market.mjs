#!/usr/bin/env node

import { discoverSignedAgentCard } from "../src/agent-card-discovery.mjs";
import { CODEX_CUSTOMER_SERVICES, CODEX_INFERENCE_PROVIDERS } from "../src/codex-inference-market.mjs";

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const code = error.cause && typeof error.cause === "object" && "code" in error.cause ? ` (${error.cause.code})` : "";
  return `${error.message}${code}`;
}

async function probe(kind, admission) {
  try {
    const card = await discoverSignedAgentCard({ agentUrl: admission.agentCard });
    return Object.freeze({ kind, actor: admission.actor, agentCard: admission.agentCard, ok: true, name: card.name, version: card.version });
  } catch (error) {
    return Object.freeze({ kind, actor: admission.actor, agentCard: admission.agentCard, ok: false, reason: errorMessage(error) });
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

export async function checkCodexMarketHealth() {
  // Agent-card signatures are provider-owned runtime material.  Some of the
  // local providers serve that material through one signing path, so a health
  // diagnostic must not create its own concurrent verification race.  This is
  // a bounded eight-card readiness assay, not the market's execution path.
  const customerServices = await mapWithConcurrency(Object.values(CODEX_CUSTOMER_SERVICES), 1, (admission) => probe("customer-service", admission));
  const providers = await mapWithConcurrency(CODEX_INFERENCE_PROVIDERS, 1, (admission) => probe("inference-provider", admission));
  const liveProviders = providers.filter(({ ok }) => ok).length;
  const failedServices = customerServices.filter(({ ok }) => !ok);
  const ok = failedServices.length === 0 && liveProviders > 0;
  const summary = ok
    ? `customer services healthy; ${liveProviders}/${providers.length} inference providers available`
    : `${failedServices.length} customer service(s) unavailable; ${liveProviders}/${providers.length} inference providers available`;
  return Object.freeze({ type: "CodexInferenceMarketHealth", ok, summary, customerServices, providers });
}

const report = await checkCodexMarketHealth();
// Systemd records stdout in the journal.  A restart gate needs a decisive,
// low-volume attestation there; retain the complete provider diagnostic for a
// human or an admitted monitoring customer that explicitly asks for it.
process.stdout.write(process.argv.includes("--summary")
  ? `${report.summary}\n`
  : `${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
