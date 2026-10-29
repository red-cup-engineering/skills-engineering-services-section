import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOGICAL_INFERENCE_ACTIVITY_PROVIDER = "urn:ame:logical-inference-service-section:rmn-inference-pulse-provider";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COLONY_ACTOR = "urn:ame:bare-cedar-fog-colony";
function digest(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function inventory(root, suffix) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true }).filter((name) => typeof name === "string" && name.endsWith(suffix)).map((name) => { const path = join(root, name); const stat = statSync(path); return stat.isFile() ? { path, bytes: stat.size, observedAt: stat.mtime.toISOString(), evidence: `urn:ame:logical-inference-service-section:evidence:${digest(readFileSync(path))}` } : null; }).filter(Boolean);
}

export async function collectLogicalInferenceColonyActivity({ window, recordedAt, root = ROOT } = {}) {
  const from = Date.parse(window.fromExclusive); const to = Date.parse(window.toInclusive);
  const rmn = inventory(join(root, "data", "rmn"), ".rmn.cbor"); const rwil = inventory(join(root, "data", "rwil"), ".nq");
  const eligibleRmn = rmn.filter((item) => Date.parse(item.observedAt) <= to); const eligibleRwil = rwil.filter((item) => Date.parse(item.observedAt) <= to);
  const changes = [...eligibleRmn, ...eligibleRwil].filter((item) => Date.parse(item.observedAt) > from);
  const packageBytes = readFileSync(join(root, "package.json")); const pkg = JSON.parse(packageBytes);
  const evidence = [...new Set([...eligibleRmn, ...eligibleRwil].map((item) => item.evidence))];
  const latestCarrierAt = eligibleRmn.map((item) => item.observedAt).sort().at(-1);
  const events = changes.length ? [{
    id: `urn:sha256:${digest(Buffer.from(`${window.fromExclusive}\n${window.toInclusive}\n${changes.map((item) => item.evidence).join("\n")}`)).slice(7)}`,
    occurredAt: changes.map((item) => item.observedAt).sort().at(-1), domain: "formations", kind: "rmn-inference-seam-formation", outcome: "succeeded",
    summary: `Logical Inference Service Section formed version ${pkg.version} as one exact A2A/RMN child-inference seam; it is explicitly not a provider selector, queue, scheduler, or Union runtime.`,
    quantities: [
      { label: "LISS canonical RMN carriers", amount: String(eligibleRmn.length), unit: "carriers", displayOrder: 430 },
      { label: "LISS RWIL projections", amount: String(eligibleRwil.length), unit: "projections", displayOrder: 431 },
      { label: "LISS RMN carrier bytes", amount: String(eligibleRmn.reduce((sum, item) => sum + item.bytes, 0)), unit: "bytes", displayOrder: 432 }
    ], evidence: evidence.length ? evidence : [`urn:ame:logical-inference-service-section:evidence:${digest(packageBytes)}`]
  }] : [];
  return {
    type: "ColonyActivityPulseEnvelope", providerActor: LOGICAL_INFERENCE_ACTIVITY_PROVIDER, settlementActor: "urn:ame:logical-inference-service-section", colonyActor: COLONY_ACTOR, window, recordedAt, events,
    stocks: [
      { id: "admitted-rmn-inference-operations", observedAt: latestCarrierAt ?? recordedAt, domain: "contracts", label: "Admitted RMN inference operations", amount: "1", unit: "operations", status: latestCarrierAt ? (Date.parse(latestCarrierAt) > from ? "observed" : "stale") : "unknown", displayOrder: 870, evidence: [`urn:ame:logical-inference-service-section:evidence:${digest(packageBytes)}`] },
      { id: "canonical-rmn-carriers", observedAt: latestCarrierAt ?? recordedAt, domain: "formations", label: "LISS canonical RMN carriers", amount: String(eligibleRmn.length), unit: "carriers", status: latestCarrierAt ? (Date.parse(latestCarrierAt) > from ? "observed" : "stale") : "unknown", displayOrder: 871, evidence: evidence.length ? evidence : [`urn:ame:logical-inference-service-section:evidence:${digest(packageBytes)}`] }
    ],
    unsupportedDomains: ["politics", "a2a", "activity-streams", "git-io", "evm", "deployments", "operations"],
    refusals: [
      { domain: "work", reason: "The current RMN/RWIL carrier exposes the inference seam and its formation, but no provider-authored exact-interval task outcome projection; completed and refused inference counts are unknown.", evidence: evidence.length ? evidence : [`urn:ame:logical-inference-service-section:evidence:${digest(packageBytes)}`] },
      { domain: "economy", reason: "Market selection and any x402 payment occur before the LISS seam; this pulse has no price, spend, or revenue receipt, so monetary outcomes are unknown.", evidence: [`urn:ame:logical-inference-service-section:evidence:${digest(packageBytes)}`] }
    ]
  };
}
