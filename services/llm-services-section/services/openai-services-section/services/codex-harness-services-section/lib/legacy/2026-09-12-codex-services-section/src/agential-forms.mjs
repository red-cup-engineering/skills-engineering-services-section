import { ACTOR, CUSTOMER, identity } from "./enterprise.mjs";

export const CHARACTER_FACE_ACTOR = "urn:ame:codex-character-face-actuator";
export const OFFICE_OBLIGATION_ACTOR = "urn:ame:codex-office-obligation-actuator";
export const IMMUNITAS_ACTOR = "urn:ame:codex-immunitas-actuator";
export const CAPACITY_FABRICATION_ACTOR = "urn:ame:codex-capacity-fabrication-obligation-actuator";

const OFFERS = Object.freeze({
  face: "urn:offer:codex-character-face-composition",
  obligation: "urn:offer:codex-office-obligation-projection",
  immunitas: "urn:offer:codex-immunitas-observation",
  fabrication: "urn:offer:codex-capacity-fabrication-obligation",
});
const CHARGES = new Set(["bottom", "t", "f", "top"]);
const POSITIONS = new Set(["duty", "liberty", "deontic-power", "deontic-immunity"]);

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} is required`);
  return value.trim();
}
function strings(value, label, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && value.length === 0)) throw new TypeError(`${label} must be ${empty ? "an" : "a nonempty"} array`);
  const selected = value.map((entry, index) => nonempty(entry, `${label}[${index}]`));
  if (new Set(selected).size !== selected.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze(selected);
}
function exact(value, label, type) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an exact object`);
  const { id, ...body } = value;
  if (id !== identity(body)) throw new TypeError(`${label} must be content addressed exactly`);
  if (body.type !== type || body.version !== 1) throw new TypeError(`${label} must be ${type} version 1`);
  return Object.freeze({ id, ...body });
}
function record(body) { return Object.freeze({ id: identity(body), ...body }); }

export function stableActor(body = {}) {
  const selected = { type: "ActorK", version: 1, actor: ACTOR, enterprise: nonempty(body.enterprise ?? "bare-cedar-fog-codex-enterprise", "enterprise"), customer: CUSTOMER };
  return record(selected);
}
export function sessionFace(body) {
  const selected = { type: "SessionFaceK", version: 1, actor: nonempty(body?.actor, "actor"), sessionDigest: nonempty(body?.sessionDigest, "sessionDigest"), lifecycleReceipt: nonempty(body?.lifecycleReceipt, "lifecycleReceipt"), observedAt: nonempty(body?.observedAt, "observedAt"), authority: false };
  return record(selected);
}
export function character(body) {
  if (!new Set(["person", "session"]).has(body?.kind)) throw new TypeError("character kind must be person or session");
  const selected = { type: "CharacterK", version: 1, characterId: nonempty(body?.characterId, "characterId"), name: nonempty(body?.name, "name"), kind: body.kind, disposition: nonempty(body?.disposition, "disposition"), chronicleReceipts: strings(body?.chronicleReceipts ?? [], "chronicleReceipts", { empty: true }) };
  return record(selected);
}
export function mask(body) {
  if (body?.actor != null || body?.office != null || body?.incumbency != null || body?.authority != null) throw new TypeError("a mask cannot assert actor, office, incumbency, or authority");
  const selected = { type: "MaskK", version: 1, maskId: nonempty(body?.maskId, "maskId"), character: nonempty(body?.character, "character"), duties: strings(body?.duties ?? [], "duties", { empty: true }), skills: strings(body?.skills ?? [], "skills", { empty: true }), register: strings(body?.register ?? [], "register", { empty: true }), sourceReceipts: strings(body?.sourceReceipts, "sourceReceipts"), conveys: [] };
  return record(selected);
}
export function composeSituatedCharacterFace(input) {
  const actor = exact(input?.stableActor, "stableActor", "ActorK"), face = exact(input?.sessionFace, "sessionFace", "SessionFaceK");
  const role = exact(input?.character, "character", "CharacterK"), worn = exact(input?.mask, "mask", "MaskK");
  if (input?.actor !== ACTOR || actor.actor !== ACTOR || face.actor !== actor.id) throw new TypeError("session face must resolve to the stable Codex ActorK");
  if (role.kind !== "session" || worn.character !== role.id) throw new TypeError("a Codex session face requires the exact session character and its mask");
  if (!Array.isArray(worn.conveys) || worn.conveys.length !== 0 || face.authority !== false) throw new TypeError("face and mask cannot convey authority");
  const body = { type: "SituatedCharacterFaceK", version: 1, provider: CHARACTER_FACE_ACTOR, actor: actor.id, sessionFace: face.id, character: role.id, mask: worn.id, selectedDuties: worn.duties, selectedSkills: worn.skills, register: worn.register, formationReceipt: nonempty(input?.formationReceipt, "formationReceipt"), nativeResourceReceipt: nonempty(input?.nativeResourceReceipt, "nativeResourceReceipt"), offer: OFFERS.face, office: null, incumbency: null, authority: null, consideration: input?.consideration ?? null, customerOutcome: null, conveys: [] };
  return record(body);
}

export function office(body) {
  if (body?.holder != null || body?.incumbent != null) throw new TypeError("an office cannot assert its holder");
  const profile = body?.deonticProfile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || Object.keys(profile).length === 0) throw new TypeError("office deonticProfile must be a nonempty work map");
  for (const [work, position] of Object.entries(profile)) { nonempty(work, "deontic work"); if (!POSITIONS.has(position)) throw new TypeError(`unknown deontic position ${position}`); }
  const selected = { type: "OfficeK", version: 1, officeId: nonempty(body?.officeId, "officeId"), name: nonempty(body?.name, "name"), normativeStructure: nonempty(body?.normativeStructure, "normativeStructure"), deonticProfile: Object.freeze({ ...profile }), bearsDuties: strings(body?.bearsDuties, "bearsDuties"), jurisdiction: nonempty(body?.jurisdiction, "jurisdiction"), authorityScope: strings(body?.authorityScope, "authorityScope"), theorySources: strings(body?.theorySources, "theorySources") };
  return record(selected);
}
export function duty(body) {
  const selected = { type: "DutyK", version: 1, dutyId: nonempty(body?.dutyId, "dutyId"), name: nonempty(body?.name, "name"), authority: nonempty(body?.authority, "authority"), work: nonempty(body?.work, "work"), claim: nonempty(body?.claim, "claim"), skills: strings(body?.skills, "skills"), delegation: body?.delegation === true };
  return record(selected);
}
export function incumbency(body) {
  if (!CHARGES.has(body?.recognition) || !CHARGES.has(body?.induction)) throw new TypeError("incumbency axes must be Belnap charges");
  const selected = { type: "IncumbencyK", version: 1, office: nonempty(body?.office, "office"), holder: nonempty(body?.holder, "holder"), recognition: body.recognition, induction: body.induction, from: nonempty(body?.from, "from"), recognitionReceipt: nonempty(body?.recognitionReceipt, "recognitionReceipt"), inductionReceipt: nonempty(body?.inductionReceipt, "inductionReceipt") };
  return record(selected);
}
export function incumbencyState(value) {
  const seat = exact(value, "incumbency", "IncumbencyK");
  if (seat.recognition === "top" || seat.induction === "top") return "repair";
  if (seat.recognition === "f" || seat.induction === "f") return "failed";
  if (seat.recognition === "t" && seat.induction === "t") return "dignitas";
  if (seat.recognition === "t") return "recognition-only";
  if (seat.induction === "t") return "munus-only";
  return "vacant";
}
export function projectOfficeObligations(input) {
  if (input?.actor !== ACTOR) throw new TypeError(`obligation projection actor must be ${ACTOR}`);
  const roleOffice = exact(input?.office, "office", "OfficeK"), seat = exact(input?.incumbency, "incumbency", "IncumbencyK");
  const holder = exact(input?.holder, "holder", "CharacterK");
  if (seat.office !== roleOffice.id || seat.holder !== holder.id) throw new TypeError("incumbency must join the exact office and character");
  const state = incumbencyState(seat);
  if (state !== "dignitas") throw new TypeError(`office obligations have no execution bearer while incumbency is ${state}`);
  if (!Array.isArray(input?.duties) || input.duties.length !== roleOffice.bearsDuties.length) throw new TypeError("every and only borne duty must be supplied");
  const supplied = new Map(input.duties.map((entry, index) => { const item = exact(entry, `duties[${index}]`, "DutyK"); return [item.dutyId, item]; }));
  const obligations = roleOffice.bearsDuties.map((dutyId) => {
    const item = supplied.get(dutyId);
    if (!item || roleOffice.deonticProfile[item.work] !== "duty") throw new TypeError(`office does not bear exact duty ${dutyId} over its work`);
    return record({ type: "StandingObligationK", version: 1, office: roleOffice.id, incumbent: holder.id, duty: item.id, dutyId: item.dutyId, authority: item.authority, work: item.work, claim: item.claim, skills: item.skills, delegationPermitted: item.delegation, accountableOffice: roleOffice.id, standing: true });
  });
  const body = { type: "OfficeObligationSetK", version: 1, provider: OFFICE_OBLIGATION_ACTOR, actor: ACTOR, office: roleOffice.id, incumbency: seat.id, holder: holder.id, state, obligations, officeRepertoireReceipt: nonempty(input?.officeRepertoireReceipt, "officeRepertoireReceipt"), nativeResourceReceipt: nonempty(input?.nativeResourceReceipt, "nativeResourceReceipt"), offer: OFFERS.obligation, consideration: input?.consideration ?? null, customerOutcome: null, authorityConveyed: false, conveys: [] };
  return record(body);
}

export function immunitas(body) {
  const selected = { type: "ImmunitasK", version: 1, under: nonempty(body?.under, "under"), protects: nonempty(body?.protects, "protects"), holder: nonempty(body?.holder, "holder"), against: strings(body?.against, "against"), sourceReceipt: nonempty(body?.sourceReceipt, "sourceReceipt"), standing: true };
  return record(selected);
}
export function observeImmunitas(input) {
  if (input?.actor !== ACTOR) throw new TypeError(`immunitas observer must be ${ACTOR}`);
  const obligation = exact(input?.obligation, "obligation", "StandingObligationK"), protection = exact(input?.immunitas, "immunitas", "ImmunitasK");
  if (protection.protects !== obligation.id || protection.standing !== true) throw new TypeError("immunitas must protect the exact standing obligation");
  const requester = nonempty(input?.requester, "requester"), blocked = protection.against.includes(requester);
  const body = { type: "ImmunitasObservationK", version: 1, provider: IMMUNITAS_ACTOR, actor: ACTOR, obligation: obligation.id, immunitas: protection.id, requester, proposedChange: nonempty(input?.proposedChange, "proposedChange"), disposition: blocked ? "refused-disabled-by-immunitas" : "not-blocked-by-this-immunitas-pending-owning-authority", originalObligationPreserved: true, changeAuthorized: false, nativeResourceReceipt: nonempty(input?.nativeResourceReceipt, "nativeResourceReceipt"), offer: OFFERS.immunitas, consideration: input?.consideration ?? null, customerOutcome: null, conveys: [] };
  return record(body);
}

export function capacityGap(body) {
  const selected = { type: "CapacityGapK", version: 1, demand: nonempty(body?.demand, "demand"), missingCapability: nonempty(body?.missingCapability, "missingCapability"), evidenceReceipt: nonempty(body?.evidenceReceipt, "evidenceReceipt"), issuer: nonempty(body?.issuer, "issuer"), demandState: body?.demandState === "open" ? "open" : (() => { throw new TypeError("capacity gap must bind an open demand"); })() };
  return record(selected);
}
export function deriveCapacityFabricationObligation(input) {
  if (input?.actor !== ACTOR) throw new TypeError(`capacity fabrication actor must be ${ACTOR}`);
  const obligation = exact(input?.obligation, "obligation", "StandingObligationK"), gap = exact(input?.gap, "gap", "CapacityGapK");
  if (obligation.work !== "practicing-cybernetic-medicine" || obligation.standing !== true) throw new TypeError("capacity fabrication requires the standing cybernetic-medicine obligation");
  if (gap.demandState !== "open") throw new TypeError("capacity fabrication requires an open witnessed gap");
  const pipeline = nonempty(input?.pipeline, "pipeline");
  const body = { type: "CapacityFabricationObligationK", version: 1, provider: CAPACITY_FABRICATION_ACTOR, actor: ACTOR, customer: CUSTOMER, demand: gap.demand, bearerOffice: obligation.office, obligation: obligation.id, claim: obligation.claim, authority: obligation.authority, gap: gap.id, missingCapability: gap.missingCapability, pipeline, pipelineOfferReceipt: nonempty(input?.pipelineOfferReceipt, "pipelineOfferReceipt"), marketObservationReceipt: nonempty(input?.marketObservationReceipt, "marketObservationReceipt"), officeTransitionReceipt: nonempty(input?.officeTransitionReceipt, "officeTransitionReceipt"), nativeResourceReceipt: nonempty(input?.nativeResourceReceipt, "nativeResourceReceipt"), requiredEvidence: ["providerReceipt", "exactCandidateDigest", "freshProcessAssayReceipt", "customerOutcomeReceipt"], candidateCapabilityCell: null, completionState: "open", offer: OFFERS.fabrication, consideration: input?.consideration ?? null, acceptanceAuthority: CUSTOMER, mutationAuthority: false, conveys: [] };
  return record(body);
}
