/**
 * Qualified batch placement: use EXISTING Red Cup work selection plus
 * EXISTING Metrologic exact conserved flow, never another inference router.
 *
 * Each per-demand Pareto/rights check is performed by decideWorkPlacement.
 * Only that decision's single/equivalent FIRST tier may enter the flow graph;
 * a noncommensurate choice, lower-tier implicit fallback, unknown current
 * account, rights mismatch or missing consumer authorization does not become
 * an edge. Shared account/window slots are one sink-bound quota even when
 * several models/offers claim availability on that same account.
 *
 * The result is a *placement proposal*. Source availability and actor claims
 * do not constitute a reservation, charged API call, cloud deployment, or
 * independent customer receiving. Execution must separately use the owner's
 * atomic WorkResourceReservation store and qualified dispatch authority.
 */
import {decideWorkPlacement} from '../decide-work-placement.mjs';
import {solveConservedCapacityFlow} from '@red-cup-engineering/metrologic/obstruction/capacity-flow';
import {canonicalJson as canonical} from '@red-cup-engineering/json-services-section/canonical-json';
import {instant,object,text} from './work-values.mjs';

const fail=msg=>{throw new TypeError('portfolio capacity flow: '+msg)};
const clamp=(value,label,limit=1000000)=>{
 if(!Number.isSafeInteger(value)||value<0||value>limit)
  fail(label+' must be an observed nonnegative finite slot count');
 return value;
};
const ref=x=>JSON.stringify([x.providerIdentity,x.accountIdentity,x.windowIdentity]);
const compare=(a,b)=>a.localeCompare(b);

/**
 * Match independently observed work demands to provider offers and account
 * windows, maximising jointly placeable jobs, without effects.
 *
 * Units are exactly ONE qualified job slot; this interface does NOT convert
 * an account slot to USD, Flow credits, CPU seconds or inference tokens.
 */
export function decideQualifiedCapacityFlow({
 candidates,capacityPools,evaluatedAt
}={}){
 const now=instant(evaluatedAt,'portfolio evaluatedAt');
 if(!Array.isArray(candidates)||candidates.length<1||candidates.length>64)
  fail('1..64 original typed work demands required');
 if(!Array.isArray(capacityPools)||capacityPools.length>128)
  fail('at most 128 actually evidenced account-window pools');
 const pools=new Map(),stale=[];
 for(const raw of capacityPools){
  object(raw,'account-window pool');
  for(const field of ['providerIdentity','accountIdentity','windowIdentity','evidenceRef',
   'observedAt','validUntil'])text(raw[field],'pool.'+field);
  const key=ref(raw);
  if(pools.has(key))fail('duplicate account-window identity; cannot double issue slots');
  const observed=instant(raw.observedAt,'pool observedAt'),
   until=instant(raw.validUntil,'pool validUntil');
  const slots=clamp(raw.availableSlots,'pool.availableSlots');
  if(observed>now||now>=until||until<=observed){
   stale.push(Object.freeze({accountKey:key,evidenceRef:raw.evidenceRef,
    reason:'stale-or-future-pool-source-evidence'}));
   continue;
  }
  pools.set(key,Object.freeze({...raw,availableSlots:slots,accountKey:key}));
 }
 const seenDemands=new Set(),offers=new Map(),admissible=[],deferred=[];
 let supportedPairCount=0;
 for(const packet of candidates){
  object(packet,'work demand packet');
  const decision=decideWorkPlacement({
   demand:packet.demand,offers:packet.offers,
   observations:packet.observations??[],evaluatedAt
  });
  const demandId=packet.demand?.id;
  text(demandId,'source demand identity');
  if(seenDemands.has(demandId))fail('duplicate source work demand');
  seenDemands.add(demandId);
  const top=decision.attemptPlan?.[0];
  if(decision.disposition!=='selected'||!top||
     !['single','equivalent'].includes(top.relation)){
   deferred.push(Object.freeze({demandId,reason:
    decision.disposition==='choice-required'?
     'noncommensurate-frontier-requires-customer-choice':
     'no-current-permissioned-provider-offer',decision}));
   continue;
  }
  const options=[];
  for(const candidate of top.offers){
   if(candidate.mode!=='execute')continue;
   const offer=candidate.offer,availability=offer?.availabilityEvidence;
   if(!availability)continue;
   const key=ref(availability),pool=pools.get(key);
   if(!pool||pool.providerIdentity!==offer.provider||
      availability.providerIdentity!==offer.provider)
    continue;
   const prior=offers.get(offer.id);
   if(prior&&canonical(prior.offer)!==canonical(offer))
    fail('same offer identity cannot carry conflicting provider/account evidence');
   offers.set(offer.id,Object.freeze({offer,pool,accountKey:key}));
   if(offers.size>128)
    fail('portfolio needs at most 128 distinct qualified offer identities');
   options.push(offer.id);
  }
  if(!options.length){
   deferred.push(Object.freeze({demandId,reason:
    'no-current-qualified-account-window-or-unreceived-result-reuse',decision}));
   continue;
  }
  supportedPairCount+=options.length;
  if(supportedPairCount>4096)fail('bounded portfolio exceeds 4096 qualified transport links');
  admissible.push(Object.freeze({demandId,choice:decision.selected.offerId,
   options:Object.freeze([...new Set(options)].sort(compare))}));
 }
 const needed=admissible.sort((a,b)=>compare(a.demandId,b.demandId));
 const offered=[...offers].sort(([a],[b])=>compare(a,b));
 const sourcePools=[...new Map(offered.map(([,v])=>[v.accountKey,v.pool]))]
  .sort(([a],[b])=>compare(a,b));
 const names=['source','sink',
  ...needed.map((_,i)=>'d'+i),
  ...offered.map((_,i)=>'o'+i),
  ...sourcePools.map((_,i)=>'p'+i)];
 const offerIx=new Map(offered.map(([id],i)=>[id,i]));
 const poolIx=new Map(sourcePools.map(([id],i)=>[id,i]));
 const links=[];
 for(const [i,row] of needed.entries()){
  links.push({id:'want-'+i,from:'source',to:'d'+i,capacity:'1'});
  for(const id of row.options){
   links.push({id:'eligible-'+i+'-'+offerIx.get(id),
    from:'d'+i,to:'o'+offerIx.get(id),capacity:'1'});
  }
 }
 for(const [i,[id,v]] of offered.entries()){
  links.push({id:'offer-'+i,from:'o'+i,to:'p'+poolIx.get(v.accountKey),
   capacity:String(v.offer.availableCapacity)});
 }
 for(const [i,[,pool]] of sourcePools.entries()){
  links.push({id:'account-'+i,from:'p'+i,to:'sink',
   capacity:String(pool.availableSlots)});
 }
 const solved=solveConservedCapacityFlow({unit:'qualified-work-slot',
  nodes:names,source:'source',sink:'sink',links});
 const byEdge=new Map(solved.links.map(x=>[x.id,x]));
 const assignments=[],fulfilled=new Set(),poolAssigned=new Map(),offerAssigned=new Map();
 for(const [i,row] of needed.entries()){
  for(const id of row.options){
   const j=offerIx.get(id);
   if(byEdge.get('eligible-'+i+'-'+j).moved!=='1')continue;
   const info=offers.get(id),pool=info.pool;
   assignments.push(Object.freeze({
    demandId:row.demandId,offerId:id,provider:info.offer.provider,
    executionClass:info.offer.executionClass,mode:'execute',
    accountIdentity:pool.accountIdentity,windowIdentity:pool.windowIdentity,
    availabilityEvidenceRef:pool.evidenceRef,
    originalFirstChoiceOfferId:row.choice,
    shiftedFromIndividualFirstChoice:row.choice!==id,
    receiving:'explicit-authority-and-atomic-shared-resource-hold-required'
   }));
   fulfilled.add(row.demandId);
   poolAssigned.set(info.accountKey,(poolAssigned.get(info.accountKey)??0)+1);
   offerAssigned.set(id,(offerAssigned.get(id)??0)+1);
  }
 }
 // Independent conservation check at the operational projection boundary.
 if(assignments.length!==Number(solved.maxRoutable)||
  [...poolAssigned].some(([key,count])=>count>pools.get(key).availableSlots)||
  [...offerAssigned].some(([id,count])=>count>offers.get(id).offer.availableCapacity))
  fail('source projection diverged from exact flow capacity witness');
 const remaining=needed.filter(row=>!fulfilled.has(row.demandId)).map(row=>
  Object.freeze({demandId:row.demandId,reason:'qualified-capacity-bottleneck'}));
 // Controlled baseline: each original single-work decision selects its first
 // option in caller-supplied order, without re-routing after the account fills. This is
 // a measured algorithmic comparison, not a historical production counter.
 const offerUsed=new Map(),poolUsed=new Map();
 let baseline=0;
 for(const packet of candidates){
  const row=needed.find(x=>x.demandId===packet.demand?.id);
  if(!row||!row.options.includes(row.choice))continue;
  const selected=offers.get(row.choice),key=selected.accountKey;
  if((offerUsed.get(row.choice)??0)>=selected.offer.availableCapacity||
     (poolUsed.get(key)??0)>=selected.pool.availableSlots)continue;
  offerUsed.set(row.choice,(offerUsed.get(row.choice)??0)+1);
  poolUsed.set(key,(poolUsed.get(key)??0)+1);
  baseline++;
 }
 const poolUse=sourcePools.map(([key,pool])=>Object.freeze({
  providerIdentity:pool.providerIdentity,accountIdentity:pool.accountIdentity,
  windowIdentity:pool.windowIdentity,evidenceRef:pool.evidenceRef,
  claimedAvailableSlots:pool.availableSlots,
  proposedSlots:poolAssigned.get(key)??0,
  spareSlots:pool.availableSlots-(poolAssigned.get(key)??0)
 }));
 return Object.freeze({
  type:'QualifiedCapacityFlowPlacement',version:1,evaluatedAt,
  originalDemandCount:candidates.length,admittedDemandCount:needed.length,
  proposedPlaceableCount:assignments.length,
  individuallyPreferredFirstChoiceCount:baseline,
  additionalPlaceableViaJointRouting:assignments.length-baseline,
  assignments:Object.freeze(assignments),
  poolUse:Object.freeze(poolUse),
  unrouted:Object.freeze([...deferred,...remaining]),
  stalePools:Object.freeze(stale),
  mathematicalWitness:solved,
  pricing:'original-work-Pareto-consideration-kept-unconverted',
  accountReservationState:'not-reserved',
  execution:'original-customer-authority-and-existing-shared-CAS-account-reservation-required',
  acceptedCustomerOutcomes:0,
  marketGapStatus:'unserved-original-work-demands-not-independent-evidence-of-a-market',
  limitation:'Source availability and actor-qualified offers are not fresh runtime quota holds. Max flow improves possible placement when sources remain true; it neither generates compute nor proves demand, permission, physical CFD, cash settlement or a delivered film.'
 });
}
