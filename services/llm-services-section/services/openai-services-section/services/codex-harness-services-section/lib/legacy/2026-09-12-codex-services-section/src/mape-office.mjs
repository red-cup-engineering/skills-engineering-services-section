import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTOR, CUSTOMER, appendObservation, identity, readTrajectory } from "./enterprise.mjs";
import { canonicalJson as canonical } from "@red-cup-engineering/canonical-json-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, "../agents/office");
const STAGES = new Set(["monitor", "analyze", "plan", "execute"]);
const PROVIDER_MODES = new Set(["purchase", "direct-incubation", "external-observation"]);
const PROVIDER_PROTOCOLS = new Set(["CodexLifecycle", "local-content-addressed-query", "MCP+A2A", "digest-pinned-provider-cli", "notebooklm-workspace-market-mcp", "inference-work-lot-market", "CodexVSCode", "LeaderMovement", "CodexEnterpriseTrajectory"]);
const IDENTITY = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const REQUIRED_ROUTES = new Map([
  ["analyze-pinned-union-corpus", ["analyze", "urn:ame:notebooklm-inference-team", "digest-pinned-provider-cli"]],
  ["analyze-schema-bound-corpus", ["analyze", "urn:ame:notebooklm-inference-team", "notebooklm-workspace-market-mcp"]],
  ["analyze-reingested-structured-corpus", ["analyze", "urn:ame:notebooklm-inference-team", "notebooklm-workspace-market-mcp"]],
  ["analyze-contradictions-and-obstructions", ["analyze", "urn:ame:notebooklm-inference-team", "digest-pinned-provider-cli"]],
  ["plan-software-architecture-specification", ["plan", "urn:ame:claude-code-inference-team", "inference-work-lot-market"]],
  ["plan-high-level-design", ["plan", "urn:ame:claude-code-inference-team", "inference-work-lot-market"]],
  ["plan-low-level-design", ["plan", "urn:ame:inference-work-lot-service", "inference-work-lot-market"]],
  ["plan-bounded-work-lots", ["plan", "urn:ame:inference-work-lot-service", "inference-work-lot-market"]],
  ["plan-integrate-actuation", ["plan", ACTOR, "CodexVSCode"]],
  ["execute-repository-mutation", ["execute", ACTOR, "CodexVSCode"]],
]);



function digest(value) {
  return identity(value);
}

function contentId(value) {
  return identity(value);
}

function readJson(name) {
  return JSON.parse(readFileSync(join(CONTENT, name), "utf8"));
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}

function strings(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty array`);
  const result = value.map((entry, index) => nonempty(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must not contain duplicates`);
  return result;
}

export function loadCodexMapeOffice() {
  const office = readJson("codex-mape-office.json");
  const dutyRegistry = readJson("codex-mape-duties.json");
  const skillRegistry = readJson("codex-mape-skills.json");
  const knowledgeRegistry = readJson("codex-mape-knowledge.json");
  return validateCodexMapeOffice({ office, dutyRegistry, skillRegistry, knowledgeRegistry });
}

export function validateCodexMapeOffice(input) {
  const { office, dutyRegistry, skillRegistry, knowledgeRegistry } = input;
  if (office?.type !== "CodexMapeOffice" || office.version !== 1) throw new TypeError("Codex MAPE office must be version 1");
  if (office.actor !== ACTOR || office.customer !== CUSTOMER || office.surface !== "vscode-codex") throw new TypeError("Codex MAPE office identity boundary drifted");
  if (dutyRegistry?.type !== "CodexMapeDutyRegistry" || dutyRegistry.office !== office.id) throw new TypeError("duty registry does not belong to the Codex MAPE office");
  if (skillRegistry?.type !== "CodexMapeSkillRegistry" || knowledgeRegistry?.type !== "CodexMapeKnowledgeRegistry") throw new TypeError("skill and knowledge registries must be typed");

  const duties = dutyRegistry.duties ?? [];
  const skills = skillRegistry.skills ?? [];
  const knowledge = knowledgeRegistry.classes ?? [];
  const dutyIds = strings(duties.map((duty) => duty.id), "duty ids");
  const officeDuties = strings(office.duties, "office duties");
  if (canonical([...dutyIds].sort()) !== canonical([...officeDuties].sort())) throw new TypeError("office and duty registry disagree");
  const knowledgeIds = new Set(strings(knowledge.map((entry) => entry.id), "knowledge ids"));
  const skillIds = strings(skills.map((skill) => skill.id), "skill ids");
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const orders = new Set();

  for (const duty of duties) {
    const members = strings(duty.skills, `duty ${duty.id} skills`);
    if (members.length < 1) throw new TypeError(`duty ${duty.id} must resolve at least one skill`);
    for (const id of members) {
      const skill = skillById.get(id);
      if (!skill || skill.duty !== duty.id) throw new TypeError(`duty ${duty.id} does not own skill ${id}`);
    }
  }

  for (const skill of skills) {
    if (!STAGES.has(skill.stage)) throw new TypeError(`skill ${skill.id} is not exactly one MAPE stage`);
    if (!Number.isSafeInteger(skill.order) || orders.has(skill.order)) throw new TypeError(`skill ${skill.id} requires one unique integer order`);
    orders.add(skill.order);
    if (skill.marketActor !== undefined) throw new TypeError(`skill ${skill.id} carries a synthetic market actor instead of its real provider route`);
    if (!PROVIDER_MODES.has(skill.provider?.mode)) throw new TypeError(`skill ${skill.id} has invalid provider mode`);
    nonempty(skill.provider.requiredActor, `skill ${skill.id} provider actor`);
    if (!skill.provider.requiredActor.startsWith("urn:ame:") && skill.provider.requiredActor !== CUSTOMER) throw new TypeError(`skill ${skill.id} provider actor must be an admitted Actor URN`);
    nonempty(skill.provider.protocol, `skill ${skill.id} provider protocol`);
    if (!PROVIDER_PROTOCOLS.has(skill.provider.protocol) || /subagent|delegat/iu.test(`${skill.provider.mode}:${skill.provider.protocol}`)) throw new TypeError(`skill ${skill.id} substitutes delegation or an unadmitted carrier for purchase`);
    const requiredRoute = REQUIRED_ROUTES.get(skill.id);
    if (requiredRoute && canonical([skill.stage, skill.provider.requiredActor, skill.provider.protocol]) !== canonical(requiredRoute)) throw new TypeError(`skill ${skill.id} violates the admitted provider route`);
    const consumes = strings(skill.consumes, `skill ${skill.id} consumes`);
    const produces = strings(skill.produces, `skill ${skill.id} produces`);
    for (const id of [...consumes, ...produces]) if (!knowledgeIds.has(id)) throw new TypeError(`skill ${skill.id} references unknown knowledge ${id}`);
    if (skill.stage !== "execute" && consumes.includes("LeaderAuthorityK")) throw new TypeError(`skill ${skill.id} leaks execution authority into ${skill.stage}`);
    if (skill.stage === "execute" && consumes.includes("AdvisorySynthesisK")) throw new TypeError(`skill ${skill.id} shortcuts advisory output into Execute`);
    const dependencies = Array.isArray(skill.dependsOn) ? skill.dependsOn : [];
    for (const dependency of dependencies) {
      const predecessor = skillById.get(dependency);
      if (!predecessor || predecessor.order >= skill.order) throw new TypeError(`skill ${skill.id} has a missing or non-prior dependency ${dependency}`);
    }
    if (skill.mutation === true && (skill.stage !== "execute" || skill.provider.requiredActor !== ACTOR)) throw new TypeError(`only Codex Execute may mutate the customer filesystem`);
  }

  const mutations = skills.filter((skill) => skill.mutation === true);
  if (mutations.length !== 1 || mutations[0].id !== "execute-repository-mutation") throw new TypeError("office requires exactly one Codex filesystem mutation skill");
  if (skillIds.length !== new Set(duties.flatMap((duty) => duty.skills)).size) throw new TypeError("every Codex office skill must belong to one duty");

  const registryDigests = Object.freeze({
    office: digest(office),
    duties: digest(dutyRegistry),
    skills: digest(skillRegistry),
    knowledge: digest(knowledgeRegistry),
  });
  return Object.freeze({ office, duties: Object.freeze(duties), skills: Object.freeze([...skills].sort((left, right) => left.order - right.order)), knowledge: Object.freeze(knowledge), registryDigests });
}

export function normalizeLeaderMove(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("leaderMove must be an object");
  const desiredOutcome = nonempty(value.desiredOutcome, "leaderMove.desiredOutcome");
  const source = nonempty(value.source, "leaderMove.source");
  const customer = value.customer ?? CUSTOMER;
  if (customer !== CUSTOMER) throw new TypeError(`leaderMove.customer must be ${CUSTOMER}`);
  const body = { type: "LeaderMoveK", version: 1, customer, desiredOutcome, source };
  const computedId = contentId(body);
  // `id` was once caller-supplied.  Preserve no authority in that legacy hint:
  // the canonical source envelope is the only identity input.
  return Object.freeze({ id: computedId, desiredOutcome, source, customer });
}

export function compileCodexMapeCycle(input, { registry = loadCodexMapeOffice() } = {}) {
  const move = normalizeLeaderMove(input?.leaderMove);
  const authorityReference = input.authorityReceipt == null ? null : nonempty(input.authorityReceipt, "authorityReceipt");
  // This legacy planner has no leader-receipt issuer or verification adapter.
  // A digest-shaped caller string is therefore a reference, never authority.
  const authorityReceipt = null;
  const initialKnowledge = Array.isArray(input.initialKnowledge)
    ? input.initialKnowledge.map((reference, index) => {
      const value = nonempty(reference, `initialKnowledge[${index}]`);
      return IDENTITY.test(value) ? value : contentId({ type: "CodexMapeInitialKnowledgeReference", value });
    })
    : [];
  const cycleBody = { type: "CodexMapeCycle", version: 1, actor: ACTOR, customer: CUSTOMER, move: move.id, desiredOutcome: move.desiredOutcome, source: move.source, initialKnowledge, registryDigests: registry.registryDigests };
  const cycleId = contentId(cycleBody);
  const bySkill = new Map();
  const lots = [];
  for (const skill of registry.skills) {
    const dependencies = skill.dependsOn.map((id) => bySkill.get(id));
    const blockedBy = [];
    if (skill.stage === "execute" && authorityReceipt === null) blockedBy.push("LeaderAuthorityK");
    const body = {
      type: "CodexMapeWorkLot",
      cycle: cycleId,
      actor: ACTOR,
      duty: skill.duty,
      skill: skill.id,
      stage: skill.stage,
      providerActor: skill.provider.requiredActor,
      providerOperation: skill.id,
      providerOffer: null,
      provider: skill.provider,
      consumes: skill.consumes,
      produces: skill.produces,
      dependsOn: dependencies,
      mutation: skill.mutation === true,
      authorityReceipt: skill.stage === "execute" ? authorityReceipt : null,
      state: blockedBy.length ? "blocked" : dependencies.length ? "awaiting-predecessor-receipts" : skill.provider.mode === "purchase" ? "market-demand" : "ready",
      blockedBy,
      supplierResultDisposition: skill.provider.mode === "purchase" ? "pending-observed-completion-or-receiver-outcome" : null,
    };
    const lot = Object.freeze({ id: contentId(body), ...body });
    lots.push(lot);
    bySkill.set(skill.id, lot.id);
  }
  return Object.freeze({ id: cycleId, ...cycleBody, authorityReceipt, authorityReference: authorityReceipt ? null : authorityReference, lots: Object.freeze(lots) });
}

export function recordCodexMapeArtifact(input, options = {}) {
  const registry = options.registry ?? loadCodexMapeOffice();
  const skill = registry.skills.find((entry) => entry.id === input?.skill);
  if (!skill) throw new TypeError("artifact names no admitted Codex MAPE skill");
  const knowledgeClass = nonempty(input.knowledgeClass, "knowledgeClass");
  if (!skill.produces.includes(knowledgeClass)) throw new TypeError(`${skill.id} cannot produce ${knowledgeClass}`);
  const cycle = nonempty(input.cycle, "cycle");
  if (!input.workLot || typeof input.workLot !== "object" || Array.isArray(input.workLot)) throw new TypeError("workLot must be an exact compiled work-lot record");
  const { id: workLot, ...workLotBody } = input.workLot;
  if (!IDENTITY.test(nonempty(workLot, "workLot.id")) || workLot !== contentId(workLotBody)) throw new TypeError("workLot must be exact and content addressed");
  if (workLotBody.type !== "CodexMapeWorkLot" || workLotBody.cycle !== cycle || workLotBody.skill !== skill.id || workLotBody.stage !== skill.stage) throw new TypeError("workLot does not bind the artifact cycle, skill, and stage");
  const issuer = nonempty(input.issuer, "issuer");
  const payloadDigest = nonempty(input.payloadDigest, "payloadDigest");
  if (![cycle, payloadDigest].every((id) => IDENTITY.test(id))) throw new TypeError("cycle and payloadDigest must be content addressed");
  const sourceReceipts = strings(input.sourceReceipts, "sourceReceipts");
  if (!sourceReceipts.every((id) => IDENTITY.test(id))) throw new TypeError("sourceReceipts must be content addressed");
  if (!input.knowledgeReceipts || typeof input.knowledgeReceipts !== "object" || Array.isArray(input.knowledgeReceipts)) throw new TypeError("knowledgeReceipts must index exact inputs by K class");
  for (const knowledge of skill.consumes) {
    if (!IDENTITY.test(input.knowledgeReceipts[knowledge] ?? "")) throw new TypeError(`${skill.id} requires a content-addressed ${knowledge} receipt`);
  }
  const providerReceipt = input.providerReceipt == null ? null : nonempty(input.providerReceipt, "providerReceipt");
  if (skill.provider.mode === "purchase" && providerReceipt === null) throw new TypeError("purchased skill output requires a provider receipt");
  if (input.authorityReceipt != null && skill.stage !== "execute") throw new TypeError("Monitor Analyze and Plan artifacts cannot carry execution authority");
  if (skill.stage === "execute") throw new TypeError("legacy MAPE records cannot authorize execution; use a verified Codex enterprise exchange and Codex integration");
  if (skill.provider.requiredActor === ACTOR && issuer !== ACTOR) throw new TypeError(`${skill.id} must be supplied by Codex`);
  if (knowledgeClass === "CustomerOutcomeK" && issuer !== CUSTOMER) throw new TypeError("only the named receiver authority may issue CustomerOutcomeK");
  const observedAt = nonempty(input.observedAt, "observedAt");
  if (Number.isNaN(Date.parse(observedAt))) throw new TypeError("observedAt must be an ISO-compatible instant");
  if (knowledgeClass === "CustomerOutcomeK" && !["accepted", "rejected", "correction", "continued-objection"].includes(input.disposition)) throw new TypeError("CustomerOutcomeK requires a typed receiver disposition");
  const endpoint = knowledgeClass === "CustomerOutcomeK" ? nonempty(input.endpoint, "endpoint") : null;
  const body = {
    type: "MapeKnowledgeArtifactObserved",
    actor: ACTOR,
    cycle,
    workLot,
    skill: skill.id,
    stage: skill.stage,
    knowledgeClass,
    issuer,
    payloadDigest,
    sourceReceipts,
    knowledgeReceipts: input.knowledgeReceipts,
    providerReceipt,
    authorityReceipt: skill.stage === "execute" ? input.authorityReceipt : null,
    planReceipt: skill.stage === "execute" ? input.planReceipt : null,
    endpoint,
    disposition: knowledgeClass === "CustomerOutcomeK" ? nonempty(input.disposition, "disposition") : "candidate",
    observedAt,
  };
  return appendObservation(body, options.enterpriseOptions ?? options);
}

export function codexMapePosition(options = {}) {
  const registry = options.registry ?? loadCodexMapeOffice();
  const rows = readTrajectory(options.enterpriseOptions ?? options).filter((row) => row.type === "MapeKnowledgeArtifactObserved");
  const byClass = Object.fromEntries(registry.knowledge.map((entry) => [entry.id, rows.filter((row) => row.knowledgeClass === entry.id).map((row) => row.id)]));
  return Object.freeze({ type: "CodexMapeOfficePosition", actor: ACTOR, office: registry.office.id, registryDigests: registry.registryDigests, artifactCount: rows.length, byClass });
}
