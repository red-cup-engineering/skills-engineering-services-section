import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decideQualifiedCapacityFlow}
 from '../../src/dispatch/work-placement/capacity-flow-placement.mjs';

const q=x=>({numerator:String(x),denominator:'1'});
const at='2026-10-14T05:40:00Z';
function demand(id,exclusive=false){
 return {
  type:'TypedWorkDemand',id,taskClass:'source-approved-cinema-writing',
  principal:'urn:ame:causeway-fiction',requiredCapabilities:['write-cinematic-treatment'],
  requiredQualityTiers:[],requiredEffects:['read-only'],
  requiredExecutionClasses:['managed'],idempotence:'idempotent',
  ...(exclusive?{requiredImplementationIdentity:'urn:implementation:a-gpu'}:{}),
  context:{identity:'urn:work:'+id,authorityScope:'urn:scope:source-rights-approved',
   freshnessIdentity:'urn:source-revision:accepted',dataConstraints:[],
   custodyConstraints:['private-original-script']},
  outputContract:{identity:'urn:contract:original-cinematic-treatment'},
  routePolicy:{preferenceOrder:[
   ['consideration-per-acceptance'],['resources'],['acceptance-probability']
  ],considerationCeilings:[],resourceCeilings:[],considerationPreference:[],
  reuse:'forbid',unknownAvailability:'refuse'}
 };
}
const window='window:2026-10-14:free-compute';
const observed='2026-10-14T05:10:00Z',until='2026-10-14T06:10:00Z';
function offer(label){
 const isGpu=label==='gpu';
 const id=isGpu?'urn:offer:a-gpu':'urn:offer:z-cpu',
  provider=isGpu?'urn:provider:gpu':'urn:provider:free-cpu';
 return {
  type:'NormalizedWorkOffer',id,provider,executionClass:'managed',
  operation:'source-approved-cinema-writing',
  implementationIdentity:isGpu?'urn:implementation:a-gpu':'urn:implementation:z-cpu',
  capabilities:['write-cinematic-treatment'],qualityTiers:[],
  authorityScopes:['urn:scope:source-rights-approved'],effects:['read-only'],
  idempotence:['idempotent'],dataConstraints:[],
  custodyConstraints:['private-original-script'],
  outputContractIdentities:['urn:contract:original-cinematic-treatment'],
  availability:'available',availableCapacity:1,
  consideration:[{kind:'work-credit',asset:'urn:unit:qualified-work',
   unit:'work-credit',amount:q(1)}],
  declaredResources:[],semantics:{reuse:'none'},
  availabilityEvidence:{offerId:id,accountIdentity:'account:'+label,
   windowIdentity:window,providerIdentity:provider,
   observedAt:observed,validFrom:observed,
   validUntil:until,resetsAt:until,expiresAt:until,
   availableResources:[]}
 };
}
function pool(label,slots=1){
 return {providerIdentity:offer(label).provider,accountIdentity:'account:'+label,
  windowIdentity:window,availableSlots:slots,
  observedAt:observed,validUntil:until,
  evidenceRef:'observation:current-'+label+'-account-slots'};
}
const packet=(flexFirst=true)=>({
 evaluatedAt:at,
 candidates:flexFirst?[
  {demand:demand('flexible'),offers:[offer('gpu'),offer('cpu')]},
  {demand:demand('exclusive',true),offers:[offer('gpu'),offer('cpu')]}
 ]:[
  {demand:demand('exclusive',true),offers:[offer('gpu'),offer('cpu')]},
  {demand:demand('flexible'),offers:[offer('gpu'),offer('cpu')]}
 ],
 capacityPools:[pool('gpu'),pool('cpu')]
});

test('source-qualified capacity flow doubles placement under same observed resources without implicit fallback',()=>{
 const result=decideQualifiedCapacityFlow(packet());
 assert.equal(result.type,'QualifiedCapacityFlowPlacement');
 assert.equal(result.originalDemandCount,2);
 assert.equal(result.proposedPlaceableCount,2);
 assert.equal(result.individuallyPreferredFirstChoiceCount,1);
 assert.equal(result.additionalPlaceableViaJointRouting,1);
 const routes=Object.fromEntries(result.assignments.map(x=>[x.demandId,x]));
 assert.equal(routes.exclusive.offerId,offer('gpu').id);
 assert.equal(routes.flexible.offerId,offer('cpu').id);
 assert.equal(routes.flexible.shiftedFromIndividualFirstChoice,true);
 assert.equal(result.mathematicalWitness.maxRoutable,'2');
 assert.equal(result.mathematicalWitness.minCut.capacity,'2');
 assert.equal(result.accountReservationState,'not-reserved');
 assert.equal(result.acceptedCustomerOutcomes,0);
 assert.match(result.limitation,/neither generates compute nor proves demand/u);
});

test('provider account windows are shared across competing work and never double-booked',()=>{
 const noCpu=packet();noCpu.capacityPools=[pool('gpu',1)];
 const result=decideQualifiedCapacityFlow(noCpu);
 assert.equal(result.proposedPlaceableCount,1);
 assert.equal(result.poolUse.find(x=>x.accountIdentity==='account:gpu').proposedSlots,1);
 assert.equal(result.unrouted.length,1);
 const noGPU=packet();noGPU.capacityPools=[pool('gpu',0),pool('cpu',1)];
 const pressure=decideQualifiedCapacityFlow(noGPU);
 assert.equal(pressure.proposedPlaceableCount,1);
 assert.equal(pressure.unrouted.find(x=>x.demandId==='exclusive').reason,
  'qualified-capacity-bottleneck');
});

test('renaming and reordering does not change maximal lawful throughput',()=>{
 const first=decideQualifiedCapacityFlow(packet(true));
 const reversed=decideQualifiedCapacityFlow(packet(false));
 assert.equal(reversed.proposedPlaceableCount,first.proposedPlaceableCount);
 assert.equal(reversed.mathematicalWitness.minCut.capacity,first.mathematicalWitness.minCut.capacity);
 assert.equal(reversed.additionalPlaceableViaJointRouting,1,
  'two individually identical first-choice decisions cannot invent implicit fallback even when submitted in another order');
});
test('rights and output mismatch leave market gaps unclaimed, not silently converted to offers',()=>{
 const source=packet();
 source.candidates[0]={...source.candidates[0],
  demand:{...source.candidates[0].demand,requiredEffects:['publish-private-original-story']}};
 const reading=decideQualifiedCapacityFlow(source);
 assert.equal(reading.proposedPlaceableCount,1);
 assert.equal(reading.unrouted.find(x=>x.demandId==='flexible').reason,
  'no-current-permissioned-provider-offer');
 assert.equal(reading.marketGapStatus,
  'unserved-original-work-demands-not-independent-evidence-of-a-market');
});
test('stale pools, conflicting account windows, and contradictory offers fail closed',()=>{
 const stale=packet();stale.capacityPools=[{...pool('gpu'),
  validUntil:'2026-10-14T05:20:00Z'},pool('cpu')];
 const measured=decideQualifiedCapacityFlow(stale);
 assert.equal(measured.proposedPlaceableCount,1);
 assert.equal(measured.stalePools.length,1);
 const double=packet();double.capacityPools.push(pool('gpu'));
 assert.throws(()=>decideQualifiedCapacityFlow(double),/duplicate account-window identity/u);
 const swapped=packet();
 swapped.candidates[1]={...swapped.candidates[1],
  offers:[{...offer('gpu'),availableCapacity:2},offer('cpu')]};
 assert.throws(()=>decideQualifiedCapacityFlow(swapped),
  /same offer identity cannot carry conflicting/u);
});
test('single account with two model offers still has only ONE observed account capacity',()=>{
 const both=packet();both.capacityPools=[
  pool('gpu'),pool('cpu',1)
 ];
 const duplicated=offer('cpu');
 const another={...duplicated,id:'urn:offer:zz-cpu-alternative',
  availabilityEvidence:{...duplicated.availabilityEvidence,
   offerId:'urn:offer:zz-cpu-alternative'}};
 both.candidates[0]={...both.candidates[0],
  offers:[offer('gpu'),duplicated,another]};
 const state=decideQualifiedCapacityFlow(both);
 assert.equal(state.proposedPlaceableCount,2);
 assert.equal(state.poolUse.find(x=>x.accountIdentity==='account:cpu').proposedSlots,1);
 assert.equal(state.poolUse.find(x=>x.accountIdentity==='account:cpu').spareSlots,0);
});

test('original JSONL inference placement CLI handles a source-bound account-capacity portfolio',()=>{
 const cli=fileURLToPath(new URL('../../scripts/dispatch/decide-work-placement.mjs',import.meta.url));
 const result=JSON.parse(execFileSync(process.execPath,[cli],{
  input:JSON.stringify({type:'QualifiedCapacityFlowRequest',...packet()})+'\n',
  encoding:'utf8',timeout:20000,maxBuffer:3000000
 }));
 assert.equal(result.type,'QualifiedCapacityFlowPlacement');
 assert.equal(result.proposedPlaceableCount,2);
 assert.equal(result.additionalPlaceableViaJointRouting,1);
 assert.equal(result.accountReservationState,'not-reserved');
 assert.equal(result.mathematicalWitness.conservation.maximumEqualsMinimumCut,true);
});
