import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

export const INFERENCE_ACTOR = "urn:ame:logical-inference-service-section";
export const INFERENCE_ACTIVITYSTREAMS_CONTRACT = "inference-fabric-activitystreams-service";

const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const response = (type, source, object) => ({
  "@context": ACTIVITYSTREAMS_CONTEXT,
  id: semanticId({ actor: INFERENCE_ACTOR, type, inReplyTo: source?.id ?? null, object }),
  type,
  actor: INFERENCE_ACTOR,
  target: source?.actor ?? null,
  inReplyTo: source?.id ?? null,
  object
});

function safeFiles(root, maximum) {
  if (!existsSync(root)) return [];
  const found = [], visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(child);
      if (found.length > maximum) throw new Error(`ActivityStreams journal exceeds ${maximum} files`);
    }
  };
  visit(root);
  return found.sort();
}

function replayJournal(root, maximumRecords) {
  const records = [];
  for (const path of safeFiles(root, maximumRecords)) {
    if (statSync(path).size > 128 * 1024 * 1024) throw new Error("ActivityStreams journal file exceeds 128 MiB");
    const text = readFileSync(path, "utf8").trim();
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (records.length >= maximumRecords) throw new Error(`ActivityStreams replay exceeds ${maximumRecords} records`);
      records.push(JSON.parse(line));
    }
  }
  return records;
}

function datedJournal(root, at) {
  const day = at.slice(0, 10), [year, month, date] = day.split("-");
  return join(root, "journals", "activitystreams", year, month, date, `${day}-logical-inference-service-section-activitystreams.jsonl`);
}

function appendExchange(root, record, at) {
  const path = datedJournal(root, at);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

const refusal = (source, reason, refusalType = "contract-refusal", extra = {}) => response("Reject", source, {
  type: "Refusal",
  contract: INFERENCE_ACTIVITYSTREAMS_CONTRACT,
  refusalType,
  reason,
  ...extra
});

function validBase(activity, type) {
  return activity?.["@context"] === ACTIVITYSTREAMS_CONTEXT
    && activity.type === type
    && typeof activity.id === "string"
    && activity.id.length > 0
    && typeof activity.actor === "string"
    && activity.actor.length > 0
    && activity.target === INFERENCE_ACTOR;
}

function referencedOffer(value, issuedOffers) {
  const id = typeof value === "string" ? value : value?.id;
  const issued = typeof id === "string" ? issuedOffers.get(id) : null;
  if (!issued) return { problem: "accepted offer was not issued by LISS" };
  if (typeof value !== "string" && semanticId(issued.offer) !== semanticId(value)) return { problem: "accepted offer is not an exact provider-issued offer" };
  return { offer: issued.offer, issued };
}

function invocationProblem(activity, issuedOffers, registryDigest) {
  if (!validBase(activity, "Accept")) return "invocation must be an identified ActivityStreams Accept addressed to LISS";
  const contract = activity.object;
  if (contract?.type !== "ServiceContract" || contract.contract !== INFERENCE_ACTIVITYSTREAMS_CONTRACT) return `invocation must accept ${INFERENCE_ACTIVITYSTREAMS_CONTRACT}`;
  const resolved = referencedOffer(contract.offer, issuedOffers);
  if (resolved.problem) return resolved.problem;
  const { offer, issued } = resolved;
  if (offer.type !== "Offer" || offer.actor !== INFERENCE_ACTOR || offer.object?.type !== "ExecutableServiceOffer") return "ServiceContract must reference LISS's provider-authored offer";
  if (activity.actor !== issued.buyer || offer.target !== issued.buyer) return "accepted offer belongs to a different buyer";
  if (offer.object.jobDigest !== semanticId(offer.object.job)) return "accepted job differs from provider-authored bytes";
  if (offer.object.scope?.registryDigest !== registryDigest) return "provider registry changed; obtain a fresh offer";
  if (offer.object.considerationDigest !== semanticId(offer.object.consideration)) return "accepted consideration differs from provider-authored bytes";
  if (contract.considerationAcceptance?.termDigest !== offer.object.considerationDigest || contract.considerationAcceptance?.acceptedBy !== activity.actor) return "buyer did not accept the provider-authored consideration";
  const capability = contract.capability;
  if (capability?.type !== "Capability" || capability.holder !== INFERENCE_ACTOR || capability.invocationTarget !== INFERENCE_ACTOR) return "invocation requires a capability held by LISS";
  if (capability.parentOffer !== offer.id || capability.attenuation?.jobDigest !== offer.object.jobDigest || capability.attenuation?.buyer !== activity.actor) return "capability is not attenuated to this buyer and job";
  if (capability.capTP?.target !== INFERENCE_ACTOR || capability.capTP.method !== "invoke-service") return "capability does not authorize LISS's invoke-service method";
  if (!(capability.allowedActions ?? []).includes("invoke-service") || !(capability.allowedActions ?? []).includes("provider-local-write") || (capability.allowedActions ?? []).includes("customer-write")) return "capability must authorize only invocation and provider-local effects";
  return null;
}

export function createInferenceActivityStreams({ broker, dataRoot, now = () => new Date().toISOString(), maxReplayRecords = 100000 }) {
  if (!broker?.admit || !broker?.replay || !broker?.quote || !broker?.ready?.registryDigest) throw new Error("ActivityStreams adapter requires a quoteable persistent inference broker");
  const root = resolve(dataRoot), issuedOffers = new Map(), inboundDigests = new Map(), contractResponses = new Map(), ownership = new Map();

  for (const record of replayJournal(join(root, "journals", "activitystreams"), maxReplayRecords)) {
    const priorDigest = record?.inbound?.id ? inboundDigests.get(record.inbound.id) : null;
    if (priorDigest && priorDigest !== record.inboundDigest && record.kind !== "refusal") throw new Error("ActivityStreams journal contains conflicting accepted activity ids");
    if (record?.inbound?.id && record.inboundDigest && !priorDigest) inboundDigests.set(record.inbound.id, record.inboundDigest);
    if (record?.kind === "solicitation" && record.response?.type === "Offer") issuedOffers.set(record.response.id, { offer: structuredClone(record.response), buyer: record.inbound.actor });
    if (record?.kind === "contract" && record.inbound?.id) {
      const carriedOffer = record.inbound.object?.offer, resolved = referencedOffer(carriedOffer, issuedOffers);
      if (resolved.problem) throw new Error("ActivityStreams journal contract precedes or changes its provider offer");
      contractResponses.set(record.inbound.id, { digest: record.inboundDigest, response: structuredClone(record.response) });
      if (record.admitted === true && record.jobId && record.jobDigest && record.buyer) ownership.set(record.jobId, { buyer: record.buyer, jobDigest: record.jobDigest, acceptance: record.inbound.id });
    }
  }

  const persist = (kind, inbound, outbound, at, details = {}) => {
    const safeInbound = structuredClone(inbound ?? null), safeOutbound = structuredClone(outbound);
    const record = { kind, recordedAt: at, inbound: safeInbound, inboundDigest: semanticId(safeInbound), response: safeOutbound, responseDigest: semanticId(safeOutbound), ...details };
    appendExchange(root, record, at);
    if (inbound?.id && !inboundDigests.has(inbound.id)) inboundDigests.set(inbound.id, record.inboundDigest);
    return structuredClone(safeOutbound);
  };
  const conflict = (activity) => {
    const prior = inboundDigests.get(activity?.id);
    return prior && prior !== semanticId(activity);
  };

  const solicit = (activity, at) => {
    if (!validBase(activity, "Offer") || activity.object?.type !== "ServiceSolicitation" || activity.object.contract !== INFERENCE_ACTIVITYSTREAMS_CONTRACT) {
      return persist("refusal", activity, refusal(activity, "solicitation must be an identified ActivityStreams Offer<ServiceSolicitation> addressed to LISS", "invalid-solicitation"), at);
    }
    if (conflict(activity)) return persist("refusal", activity, refusal(activity, "activity id was reused with changed bytes", "id-payload-conflict"), at);
    for (const issued of issuedOffers.values()) if (issued.offer.inReplyTo === activity.id) return structuredClone(issued.offer);
    const job = activity.object.request;
    let quote;
    try { quote = broker.quote(job); }
    catch { return persist("refusal", activity, refusal(activity, "solicitation carries an invalid inference job", "invalid-job"), at); }
    if (quote.refused || !quote.plan?.length) return persist("refusal", activity, refusal(activity, "no capable supplier offers comparable admissible consideration", quote.refused ?? "no-feasible-endpoint", { quote }), at);
    const first = quote.plan[0], consideration = {
      type: "InferenceResolutionConsideration",
      expectedAmount: first.expectedResolutionCost,
      unit: first.unit,
      settlementProtocol: "supplier-resource-observation",
      monetaryClaim: false,
      x402Applicable: false
    };
    const object = {
      type: "ExecutableServiceOffer",
      contract: INFERENCE_ACTIVITYSTREAMS_CONTRACT,
      sourceActivity: activity.id,
      job,
      jobDigest: semanticId(job),
      commodity: { type: "ServiceCommodity", id: "urn:commodity:liss:verified-inference-resolution", quantity: 1, unit: "terminal-result-or-typed-refusal" },
      consideration,
      considerationDigest: semanticId(consideration),
      scope: { formulaVersion: "frugality-v2", registryDigest: broker.ready.registryDigest, quote },
      operation: "invoke-service",
      effects: ["provider-local-write"],
      evidence: ["provider-authored-price-plan", "immediate-admission-receipt", "append-only-terminal-result", "actor-bound-result-inquiry"]
    };
    const offer = response("Offer", activity, object);
    issuedOffers.set(offer.id, { offer: structuredClone(offer), buyer: activity.actor });
    return persist("solicitation", activity, offer, at);
  };

  const invoke = (activity, at) => {
    if (conflict(activity)) return persist("refusal", activity, refusal(activity, "activity id was reused with changed bytes", "id-payload-conflict"), at);
    const prior = contractResponses.get(activity?.id);
    if (prior) return prior.digest === semanticId(activity) ? structuredClone(prior.response) : persist("refusal", activity, refusal(activity, "activity id was reused with changed bytes", "id-payload-conflict"), at);
    const problem = invocationProblem(activity, issuedOffers, broker.ready.registryDigest);
    if (problem) return persist("refusal", activity, refusal(activity, problem, "invalid-contract"), at);
    const offer = referencedOffer(activity.object.offer, issuedOffers).offer, job = offer.object.job, admission = broker.admit(job);
    const accepted = admission.receipt.status === "admitted" || admission.receipt.status === "already-settled";
    const outbound = accepted ? response("Accept", activity, {
      type: "InferenceSubmissionResult",
      contract: INFERENCE_ACTIVITYSTREAMS_CONTRACT,
      offer: offer.id,
      jobId: job.id,
      jobDigest: offer.object.jobDigest,
      submissionReceipt: admission.receipt,
      resultInquiry: { type: "InferenceResultQuery", id: job.id, jobDigest: offer.object.jobDigest },
      customerTerritoryMutation: false
    }) : refusal(activity, "the persistent broker refused admission", admission.receipt.refusal?.type ?? "admission-refused", { submissionReceipt: admission.receipt });
    persist("contract", activity, outbound, at, { buyer: activity.actor, jobId: job.id, jobDigest: offer.object.jobDigest, admitted: accepted });
    contractResponses.set(activity.id, { digest: semanticId(activity), response: structuredClone(outbound) });
    if (accepted) ownership.set(job.id, { buyer: activity.actor, jobDigest: offer.object.jobDigest, acceptance: activity.id });
    return outbound;
  };

  const inquire = (activity, at) => {
    if (!validBase(activity, "Question") || activity.object?.type !== "InferenceResultQuery" || typeof activity.object.id !== "string") {
      return persist("refusal", activity, refusal(activity, "inquiry must be an identified ActivityStreams Question<InferenceResultQuery> addressed to LISS", "invalid-inquiry"), at);
    }
    if (conflict(activity)) return persist("refusal", activity, refusal(activity, "activity id was reused with changed bytes", "id-payload-conflict"), at);
    const owner = ownership.get(activity.object.id);
    if (!owner || owner.buyer !== activity.actor || owner.jobDigest !== activity.object.jobDigest) return persist("inquiry", activity, refusal(activity, "buyer is not authorized to receive this job result", "query-not-authorized"), at);
    const result = broker.replay(activity.object.id);
    if (!result) return persist("inquiry", activity, refusal(activity, "accepted inference has not reached terminal settlement", "result-not-settled", { retryable: true }), at);
    if (result.jobDigest && `sha256:${result.jobDigest}` !== owner.jobDigest) return persist("inquiry", activity, refusal(activity, "terminal result digest does not match the accepted job", "settlement-digest-conflict"), at);
    return persist("inquiry", activity, response("Accept", activity, {
      type: "InferenceSettlementResult",
      contract: INFERENCE_ACTIVITYSTREAMS_CONTRACT,
      acceptance: owner.acceptance,
      jobId: activity.object.id,
      jobDigest: owner.jobDigest,
      result,
      customerTerritoryMutation: false
    }), at);
  };

  const handle = (activity, at = now()) => {
    const isolated = structuredClone(activity ?? null);
    if (isolated?.type === "Offer") return solicit(isolated, at);
    if (isolated?.type === "Accept") return invoke(isolated, at);
    if (isolated?.type === "Question") return inquire(isolated, at);
    return persist("refusal", isolated, refusal(isolated, "unsupported ActivityStreams inference operation", "unsupported-operation"), at);
  };

  return {
    recognizes: (value) => value?.["@context"] === ACTIVITYSTREAMS_CONTEXT,
    handle,
    snapshot: () => ({ offers: issuedOffers.size, contracts: contractResponses.size, ownedJobs: ownership.size })
  };
}
