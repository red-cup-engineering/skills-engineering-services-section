/**
 * Google Flow: credit-bounded, provider-specific planning for TEXT-to-video.
 *
 * This is deliberately NOT an alternate media market, an account API, or
 * evidence that reference-conditioned video is supported by this wire client.
 * Actual credit holds/submission/custody belong to flow-generate.mjs after
 * independently admitted customer award and availability checks.
 */
import {videoModelKey} from './flow-protocol.mjs';

const requireText=(v,name)=>{if(typeof v!=='string'||!v.trim())throw new TypeError(`${name} requires text`);return v.trim()};
const safeInt=(v,name,min=0)=>{if(!Number.isSafeInteger(v)||v<min)throw new TypeError(`${name} must be integer >= ${min}`);return v};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const seen=(key,rows)=>rows.some(row=>row?.key===key);

/** A read-only projection of actual model/credit observations; never guessed prices. */
export function flowTextVideoOptions(catalog,{aspect='9:16'}={}) {
  if(!Array.isArray(catalog))throw new TypeError('observed Flow model catalog is required');
  if(!['9:16','16:9'].includes(aspect))throw new TypeError('Flow video aspect must be 9:16 or 16:9');
  const options=[];
  for(const row of catalog){
    if(!record(row)||row.medium!=='video'||typeof row.key!=='string')continue;
    if(!/^(?:veo_.+_t2v(?:_.+)?|abra_t2v_\d+s(?:_360p)?)$/u.test(row.key))continue;
    if(!Number.isSafeInteger(row.credits)||row.credits<0)continue;
    const effectiveKey=videoModelKey(row.key,aspect);
    // A portrait-specific Veo 3.1 model must actually be in the live catalog.
    // Lite and abra_t2v models use an aspect argument rather than a remapped key.
    if(effectiveKey!==row.key&&!seen(effectiveKey,catalog))continue;
    const seconds=Number.isSafeInteger(row.seconds)&&row.seconds>0?row.seconds:null;
    options.push(Object.freeze({model:row.key,effectiveKey,aspect,
      credits:row.credits,creditsUnit:'flow-credit',seconds,
      mode:'text-to-video',referenceImagesSupported:false}));
  }
  return Object.freeze(options.sort((a,b)=>a.credits-b.credits||a.model.localeCompare(b.model)));
}


/**
 * Turn one exact dramatic source into a **usable Google Flow UI reference-video
 * audition**, priced only from a just-observed account model catalog.
 *
 * The Flow product UI supports Ingredients to Video for Veo 3.1 Lite/Fast
 * (8-second clips) and Gemini Omni Flash (4/6/8/10 seconds). This repository's
 * Flow *wire client* currently supports TEXT-to-video only. Do NOT feed this
 * result to flow-generate as if reference conditioning were supported.
 *
 * The output is an artist/operator handoff, not an approved MediaNeed,
 * renderer invocation, source-of-truth world revision, accepted clip or spend.
 */
export function planFlowReferencedSceneTrial({
  catalog, sourceRef, referenceImages, shots, consumer, destination,
  maxCredits, aspect='9:16'
}={}){
  if(!Array.isArray(catalog))throw new TypeError('observed Flow model catalog is required');
  if(!['9:16','16:9'].includes(aspect))throw new TypeError('invalid Flow video aspect');
  const source=requireText(sourceRef,'exact source revision');
  if(!/^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40})$/u.test(source))
    throw new TypeError('source revision must be exact sha256: or git: identity');
  const owner=requireText(consumer,'consumer');
  const delivery=requireText(destination,'destination');
  const budget=safeInt(maxCredits,'maximum Flow credits',1);
  if(!Array.isArray(shots)||shots.length<1||shots.length>8)
    throw new TypeError('one to eight actual dramatic shots required');
  if(!Array.isArray(referenceImages)||referenceImages.length<1||referenceImages.length>3)
    return Object.freeze({type:'FlowReferencedSceneTrial',status:'HELD_MISSING_OR_TOO_MANY_REFERENCES',
      sourceRef:source,reason:'Require 1–3 exact reference images before staging consistent characters'});
  const labels=new Set(),references=referenceImages.map((item)=>{
    if(!record(item))throw new TypeError('reference image must be object');
    const label=requireText(item.label,'reference label');
    if(labels.has(label))throw new TypeError('reference labels must be unique');labels.add(label);
    if(!['character','environment','object'].includes(item.kind))
      throw new TypeError('reference kind must be character/environment/object');
    if(!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(item.identity))
      throw new TypeError('reference image identity must be content-addressed NI');
    return Object.freeze({label,kind:item.kind,identity:item.identity});
  });
  if(!references.some(ref=>ref.kind==='character'))
    throw new TypeError('a character-continuity trial needs a character reference');
  const ids=new Set(),take=shots.map((shot)=>{
    if(!record(shot))throw new TypeError('shot must be object');
    const id=requireText(shot.id,'shot ID');
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(id)||ids.has(id))
      throw new TypeError('shot IDs must be distinct lowercase slugs');
    ids.add(id);
    const prompt=requireText(shot.prompt,'cinematic prompt');
    if(prompt.length>6000)throw new TypeError('cinematic prompt is too long');
    const seconds=safeInt(shot.seconds,'shot seconds',4);
    if(![4,6,8,10].includes(seconds))throw new TypeError('shot seconds must be 4/6/8/10');
    return Object.freeze({id,seconds,prompt});
  });
  const candidates=[];
  for(const row of catalog){
    if(!record(row)||row.medium!=='video'||typeof row.key!=='string'||
      !Number.isSafeInteger(row.credits)||row.credits<0)continue;
    const key=row.key;
    const veoLite=key==='veo_3_1_r2v_lite';
    const veoFast=/^veo_3_1_r2v_fast_(?:portrait|landscape)$/u.test(key);
    const omni=/^abra_r2v_(?:4|6|8|10)s(?:_360p)?$/u.test(key);
    if(!veoLite&&!veoFast&&!omni)continue;
    if(veoFast && ((aspect==='9:16'&&!key.endsWith('_portrait'))||
       (aspect==='16:9'&&!key.endsWith('_landscape'))))continue;
    const seconds=omni?Number(key.match(/_r2v_(\d+)s/u)[1]):8;
    if(take.some(shot=>shot.seconds!==seconds))continue;
    if(row.seconds!=null && row.seconds!==seconds)continue;
    const totalCredits=row.credits*take.length;
    candidates.push(Object.freeze({
      modelKey:key,modelFamily:omni?'Gemini Omni Flash':veoLite?'Veo 3.1 Lite':'Veo 3.1 Fast',
      secondsPerShot:seconds,creditsPerShot:row.credits,totalCredits,
      aspect,availableWithinCeiling:totalCredits<=budget,
      supportedUIFeature:'Ingredients / References to Video',
      automatedWireSupport:false,
    }));
  }
  candidates.sort((a,b)=>a.totalCredits-b.totalCredits||a.modelKey.localeCompare(b.modelKey));
  const feasible=candidates.filter(item=>item.availableWithinCeiling);
  return Object.freeze({
    type:'FlowReferencedSceneTrial',
    status:feasible.length?'PREPARED_FLOW_UI_HANDOFF_NOT_SUBMITTED':
      candidates.length?'HELD_CREDIT_CEILING':'HELD_NO_OBSERVED_UI_MODEL',
    sourceRef:source,consumer:owner,destination:delivery,
    references:Object.freeze(references),
    shots:Object.freeze(take),aspect,maximumCredits:budget,
    candidates:Object.freeze(candidates),cheapestFeasible:feasible[0]??null,
    sequenceRule:'Reuse these exact source-character reference identities in every shot. Compare the same characters under a different camera/action; do not substitute a new reference silently.',
    manualReceiver:'Generate in the actual Google Flow project UI; source-linked provider media IDs must be adopted via the existing Flow media custody path. This planner cannot click Flow or spend credits.',
    limitation:'UI-only, unapproved development experiment. Flow credits are NOT Gemini Developer API dollars. Source binding, independent asset approval and rendered identity must still be checked.',
  });
}

/**
 * A proposed 1-clip order only. It does not book credits, queue an order or
 * represent a working reference-image path. Callers MUST provide a real
 * receiver and accepted scope before promoting this to an allocation.
 */
export function planFlowTextVideoShot({catalog,shot,consumer,destination,maxCredits,aspect='9:16'}={}) {
  if(!record(shot))throw new TypeError('a shot is required');
  const shotId=requireText(shot.id,'shot id');
  const prompt=requireText(shot.prompt,'shot prompt');
  const requestedSeconds=safeInt(shot.minSeconds,'shot minimum seconds',1);
  const sourceRef=requireText(shot.sourceRef,'shot source revision');
  const owner=requireText(consumer,'receiving consumer');
  const delivery=requireText(destination,'intended destination');
  const ceiling=safeInt(maxCredits,'maximum credits');
  if(shot.referenceImages?.length||shot.requiresIdentityLock===true)
    return Object.freeze({type:'FlowShotPlan',status:'HELD_UNSUPPORTED_REFERENCE_CONDITIONING',
      shotId,sourceRef,reason:'Current Flow wire client only submits text-to-video; no honest identity-lock guarantee'});
  const possible=flowTextVideoOptions(catalog,{aspect}).filter(x=>x.seconds!==null&&x.seconds>=requestedSeconds);
  const qualified=possible.filter(x=>x.credits<=ceiling);
  if(qualified.length===0)return Object.freeze({type:'FlowShotPlan',
    status:possible.length?'HELD_CREDIT_CEILING':'HELD_NO_SUPPORTED_DURATION',
    shotId,sourceRef,observedOptions:possible.length,maximumCredits:ceiling});
  const offer=qualified[0];
  const order=Object.freeze({consumer:owner,destination:delivery,medium:'video',
    model:offer.model,prompt,aspect:offer.aspect,count:1,
    purpose:shotId,sourceRef});
  return Object.freeze({type:'FlowShotPlan',status:'PROPOSED_NOT_ADMITTED',shotId,sourceRef,
    preview:order,estimate:Object.freeze({units:offer.credits,currency:'flow-credit',
      billableSeconds:offer.seconds,requestedSeconds,unusedSeconds:offer.seconds-requestedSeconds}),
    caveats:Object.freeze(['no-reference-conditioning-in-current-wire-client',
      'no-credit-hold-or-provider-invocation','no-preauthorized-publishing',
      'model-and-price-must-be-rechecked-at-execution'])});
}
