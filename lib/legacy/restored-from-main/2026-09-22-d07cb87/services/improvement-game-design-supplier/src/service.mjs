import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliverFromEnvironment } from "@red-cup-engineering/activitypub-services-section/deliver";
import { projectRmnActivity } from "@red-cup-engineering/activitypub-services-section/rmn-activity";
import { listAddressedRmnOutbox } from "@red-cup-engineering/activitypub-services-section/rmn-outbox-client";
import { requestImprovementGameProposalAssay } from "./proposal-assay-client.mjs";
import { ACTOR, CONTEXT, bidForGameOffer, fulfillGameAward } from "./supplier.mjs";
import { bytesOf, jsonFromBytes } from "./semantic-content.mjs";
import { createImprovementGameDesignSupplierRecordJournal } from "./record-journal.mjs";

export const ROOT = new URL("..", import.meta.url).pathname;
const CATEGORY = "improvement-game-design-supplier.foraging";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const ACTIVITY_KIND="improvement-game-design-supplier.activitypub-activity";
const activityBytes=(activity)=>bytesOf(activity,ACTIVITY_KIND);
function activityFromBytes(bytes){return jsonFromBytes(bytes,ACTIVITY_KIND);}
function requiredEnvironment(name){const value=process.env[name];if(typeof value!=="string"||!value)throw new Error(`${name} is required`);return value;}
function validatePolicy(policy){if(!policy?.proposalAssay?.agentCard||!Array.isArray(policy.boards)||policy.boards.some((board)=>["packageRoot","nodeId","contract"].some((field)=>Object.hasOwn(board,field))||!board.activityPubActor||!board.activityPubOutbox||!board.activityPubInbox||!board.a2aAgentCard||!board.supplierActivityPubActor))throw new Error("game supplier policy requires standard ActivityPub boards and one A2A proposal assay without package imports");return policy;}
export function loadPolicy(path=new URL("../content/policies/red-cup-game-design.json",import.meta.url)){return validatePolicy(JSON.parse(readFileSync(path,"utf8")));}
async function invokeBoard(board,operation,input=null){if(operation===board.listOperation&&input===null){const projections=await listAddressedRmnOutbox({outboxUrl:board.activityPubOutbox,expectedActor:board.activityPubActor,expectedAgentCard:board.a2aAgentCard,recipient:board.supplierActivityPubActor});const items=projections.map(({type,objectBytes})=>{const activity=activityFromBytes(objectBytes);if(activity?.type!==type||activity.actor!==board.actor||![PUBLIC,ACTOR].includes(activity.target))throw new Error("board projection disagrees with its RMN activity");return activity;});return{"@context":CONTEXT,type:"OrderedCollection",actor:board.actor,totalItems:items.length,orderedItems:items};}if(operation===board.submitOperation&&input?.actor===ACTOR&&input.target===board.actor){const origin=requiredEnvironment("GAME_DESIGN_ACTIVITYPUB_ORIGIN"),identifier=requiredEnvironment("GAME_DESIGN_ACTIVITYPUB_IDENTIFIER"),agentCard=requiredEnvironment("GAME_DESIGN_A2A_AGENT_CARD"),keyPath=requiredEnvironment("GAME_DESIGN_ACTIVITYPUB_KEYS_PATH"),projection=projectRmnActivity({type:input.type,origin,identifier,recipient:board.activityPubActor,objectBytes:activityBytes(input),agentCard});return deliverFromEnvironment(projection,{actor:ACTOR,origin,identifier,agentCard,keyPath,recipient:board.activityPubActor,inbox:board.activityPubInbox});}throw new Error(`operation ${operation} is outside the ActivityPub board treaty`);}
function defaultLedger(options = {}) {
  const dataRoot = resolve(options.dataRoot ?? process.env.RED_CUP_GAME_DESIGN_DATA_ROOT ?? new URL("../data", import.meta.url).pathname);
  const journal = createImprovementGameDesignSupplierRecordJournal({ root: dataRoot });
  return { read: () => journal.query({ category: CATEGORY }).map(({ record }) => record), append: (value, at) => journal.record({ category: CATEGORY, recordedAt: at, record: value, charge: { support: true, refutation: false } }) };
}
export function memoryLedger(seed = []) { const rows = [...seed]; return { read: () => [...rows], append: async (value) => { rows.push(value); return value; } }; }
const done = (rows, board, id) => rows.some((row) => row.board === board && row.activity === id && ["submitted", "terminal-skip"].includes(row.status));
const activityTick = (item) => item?.object?.awardedAtTick ?? item?.attachment?.find((part) => part?.type === "ImprovementGameBuyerQuote")?.tick ?? -1;

export async function operatePulse(activity, options = {}) {
  const policy = options.policy ?? loadPolicy(), at = options.recordedAt ?? new Date().toISOString();
  const valid = activity?.["@context"] === CONTEXT && activity.type === "Create" && activity.actor === policy.clockActor && activity.target === ACTOR && activity.capability === policy.deliveryCapabilityId && activity.object?.type === "IndependentImprovementGameSupplierPulse" && /#[0-9]+$/u.test(activity.object.pulseId ?? "");
  if (!valid) return { "@context": CONTEXT, type: "Reject", actor: ACTOR, target: activity?.actor ?? null, inReplyTo: activity?.id ?? null, object: { type: "ImprovementGameSupplierPulseRefusal", reason: "exact-contracted-clockkeeper-pulse-required", customerMutation: false } };
  const ledger = options.ledger ?? defaultLedger(options), callBoard = options.invokeBoard ?? invokeBoard, reviewProposal = options.reviewProposal ?? (async(request)=>(await requestImprovementGameProposalAssay(request,{agentCardUrl:policy.proposalAssay.agentCard})).review), outcomes = [];
  for (const board of policy.boards) {
    let outbox; try { outbox = await callBoard(board, board.listOperation, null); } catch (error) { outcomes.push({ board: board.actor, status: "transport-residue", reason: error.message }); continue; }
    const awarded = new Set(outbox.orderedItems?.filter((item) => item?.type === "Accept" && item.object?.type === "ImprovementGameDesignAward").map((item) => item.object.quote) ?? []);
    const candidates = (outbox.orderedItems ?? []).filter((item) => item?.id && !done(ledger.read(), board.actor, item.id) && activityTick(item) >= board.minimumBoardTick)
      .filter((item) => (item.type === "Accept" && item.target === ACTOR && item.object?.type === "ImprovementGameDesignAward") || (item.type === "Offer" && item.object?.type === "ImprovementGameDesignWorkLot" && !awarded.has(item.attachment?.find((part) => part?.type === "ImprovementGameBuyerQuote")?.id)))
      .sort((a, b) => Number(b.type === "Accept") - Number(a.type === "Accept") || activityTick(b) - activityTick(a) || a.id.localeCompare(b.id));
    for (const publication of candidates.slice(0, policy.maximumActivitiesPerTick)) {
      let authored;
      try {
        authored = publication.type === "Accept" ? await fulfillGameAward(publication, publication.object.bidSnapshot, { policy, recordedAt: at, reviewProposal }) : bidForGameOffer(publication, policy);
        const status = authored ? "submitted" : "terminal-skip", receipt = authored ? await callBoard(board, board.submitOperation, authored) : null;
        const disposition = { type: "ImprovementGameSupplierDisposition", board: board.actor, activity: publication.id, status: receipt?.type === "Reject" ? "customer-rejected" : status, detail: authored ? { authored: authored.id, authoredType: authored.type, objectType: authored.object?.type, receipt: receipt?.id ?? null } : "outside-current-supplier-qualification", recordedAt: at, customerTerritoryMutation: false };
        await ledger.append(disposition, at); outcomes.push(disposition);
      } catch (error) { const residue = { type: "ImprovementGameSupplierDisposition", board: board.actor, activity: publication.id, status: "retryable-residue", detail: error.message, recordedAt: at, customerTerritoryMutation: false }; await ledger.append(residue, at); outcomes.push(residue); }
    }
  }
  return { "@context": CONTEXT, type: "Accept", actor: ACTOR, target: activity.actor, inReplyTo: activity.id, object: { type: "IndependentImprovementGameSupplierTickReceipt", pulseId: activity.object.pulseId, outcomes, nextTickRequired: true, customerTerritoryMutation: false } };
}
