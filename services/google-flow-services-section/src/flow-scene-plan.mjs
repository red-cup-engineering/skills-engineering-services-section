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
