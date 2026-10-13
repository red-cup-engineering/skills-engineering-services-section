/**
 * Actual Gemini Developer API Veo 3.1 video provider for Red Cup's inference engine.
 * This is NOT Google Flow's browser-session/credit wallet: Google documents a
 * distinct paid API endpoint at https://ai.google.dev/gemini-api/docs/veo .
 *
 * Narrow contract: one provenance-bound original cinematic shot -> one paid
 * asynchronous request -> resumable operation -> verified generated MP4 bytes.
 * A separate authorized owner must receive the asset and decide its use.
 * Never replay an ambiguous POST: it could create a second paid generation.
 */
import { createHash } from 'node:crypto';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const DOC = 'https://ai.google.dev/gemini-api/docs/veo';
const PRICE_DOC = 'https://ai.google.dev/gemini-api/docs/pricing';
const CODECS = Object.freeze({
  'veo-3.1-generate-preview': Object.freeze({ '720p':0.40,'1080p':0.40,'4k':0.60 }),
  'veo-3.1-fast-generate-preview': Object.freeze({ '720p':0.10,'1080p':0.12,'4k':0.30 }),
  'veo-3.1-lite-generate-preview': Object.freeze({ '720p':0.05,'1080p':0.08 }),
});
const requireText = (x,label,max=8192) => {
  if(typeof x!=='string'||!x.trim()||x.length>max) throw new TypeError(`${label} requires bounded nonempty text`);
  return x;
};
const isRecord = x => x!==null&&typeof x==='object'&&!Array.isArray(x);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/u;
const IMAGE = new Set(['image/png','image/jpeg','image/webp']);
const roundUsd = n=>Math.round(n*100)/100;
const validOperation = n => typeof n==='string'&&/^(?:models\/[a-zA-Z0-9._-]+\/)?operations\/[a-zA-Z0-9._-]+$/u.test(n);
const encoded = name=>name.split('/').map(encodeURIComponent).join('/');
const jsonHeaders = key => ({'x-goog-api-key':key,'content-type':'application/json'});

/** Input frames and character references are actual owner-held bytes, not a URI promise. */
function imageAsset(raw,label){
  if(!isRecord(raw))throw new TypeError(`${label} must contain an actual image`);
  const id=requireText(raw.id,`${label} identity`,180);
  const rightsRef=requireText(raw.rightsRef,`${label} rights evidence`,2048);
  const mediaType=raw.mimeType;
  if(!IMAGE.has(mediaType))throw new TypeError(`${label} unsupported image MIME`);
  const bytes=raw.bytes;
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<4||bytes.byteLength>15*1024*1024)
    throw new TypeError(`${label} must contain bounded image bytes`);
  const sig=Buffer.from(bytes);
  if(mediaType==='image/png'&&!sig.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
     mediaType==='image/jpeg'&&!(sig[0]===255&&sig[1]===216&&sig[2]===255) ||
     mediaType==='image/webp'&&!(sig.subarray(0,4).toString('ascii')==='RIFF'&&sig.subarray(8,12).toString('ascii')==='WEBP'))
    throw new TypeError(`${label} bytes do not match declared image MIME`);
  const digest=sha(bytes);
  if(raw.sha256!==digest)throw new TypeError(`${label} SHA-256 mismatch`);
  return Object.freeze({id,rightsRef,mimeType:mediaType,sha256:digest,
    image:Object.freeze({inlineData:Object.freeze({mimeType:mediaType,data:Buffer.from(bytes).toString('base64')})})});
}

/**
 * Prepare one actual API request; the returned request body contains private
 * reference image bytes and MUST NOT be sent to public logs or GitHub files.
 * The small `publicPlan` deliberately excludes bytes/URLs/secrets.
 */
export function prepareGeminiVeoShot(input){
  if(!isRecord(input))throw new TypeError('cinematic source shot required');
  const shotId=requireText(input.shotId,'shot id',180);
  const sourceRef=requireText(input.sourceRef,'exact source reference',2048);
  const consumer=requireText(input.consumer,'receiving enterprise',256);
  const mediaNeed=requireText(input.mediaNeed,'admitted media need',2048);
  const prompt=requireText(input.prompt,'authored dramatic/camera/audio prompt',7000);
  const model=input.model??'veo-3.1-fast-generate-preview';
  if(!(model in CODECS))throw new TypeError('unknown or unsupported Veo API model');
  const aspectRatio=input.aspectRatio??'9:16';
  if(!['9:16','16:9'].includes(aspectRatio))throw new TypeError('unsupported Veo aspect ratio');
  const resolution=input.resolution??'720p';
  const unitPrice=CODECS[model][resolution];
  if(!Number.isFinite(unitPrice))throw new TypeError('model does not support requested resolution');
  const durationSeconds=input.durationSeconds??8;
  if(![4,6,8].includes(durationSeconds))throw new TypeError('only 4, 6, or 8 seconds supported');
  const originalRefs=input.referenceImages??[];
  if(!Array.isArray(originalRefs)||originalRefs.length>3)throw new TypeError('maximum three reference images');
  if(originalRefs.length&&model.includes('-lite-'))throw new TypeError('Veo Lite cannot use asset reference images');
  const refs=originalRefs.map((v,i)=>imageAsset(v,`reference ${i+1}`));
  if(new Set(refs.map(x=>x.id)).size!==refs.length)throw new TypeError('duplicate reference identity');
  if(refs.length&&('firstFrame' in input||'lastFrame' in input))
    throw new TypeError('mixed reference and frame modes are not qualified by this adapter');
  const first=input.firstFrame===undefined?null:imageAsset(input.firstFrame,'first frame');
  const last=input.lastFrame===undefined?null:imageAsset(input.lastFrame,'last frame');
  if(last&&!first)throw new TypeError('last frame requires a first frame');
  if((refs.length||resolution!=='720p')&&durationSeconds!==8)
    throw new TypeError('reference images or high resolution require eight-second clips');
  if(input.seed!==undefined&&(!Number.isSafeInteger(input.seed)||input.seed<0||input.seed>2147483647))
    throw new TypeError('seed must be a positive bounded integer');
  const instance={prompt};
  if(refs.length)instance.referenceImages=refs.map(ref=>({image:ref.image,referenceType:'asset'}));
  if(first)instance.image=first.image;
  if(last)instance.lastFrame=last.image;
  const parameters={aspectRatio,durationSeconds:String(durationSeconds),resolution,numberOfVideos:1};
  if(input.seed!==undefined)parameters.seed=input.seed;
  const body=Object.freeze({instances:Object.freeze([Object.freeze(instance)]),parameters:Object.freeze(parameters)});
  const quote=roundUsd(durationSeconds*unitPrice);
  // Hash the *exact* wire request including referenced image bytes, never
  // persist those bytes in any public plan or receipt.
  const requestSha256=sha(Buffer.from(JSON.stringify(body)));
  const imageSources=[...refs,...(first?[first]:[]),...(last?[last]:[])].map(v=>
    Object.freeze({id:v.id,sha256:v.sha256,rightsRef:v.rightsRef,mimeType:v.mimeType}));
  const publicPlan=Object.freeze({type:'GeminiVeoCinematicShot',state:'PREPARED_UNSUBMITTED',
    provider:'urn:ame:google-gemini-developer-api',shotId,sourceRef,consumer,mediaNeed,
    model,mode:refs.length?'reference-to-video':first?'frames-to-video':'text-to-video',
    aspectRatio,resolution,durationSeconds,referenceAssets:Object.freeze(imageSources),
    requestSha256,estimatedMaximumUsd:quote,
    priceBasis:Object.freeze({observedDate:'2026-10-12',url:PRICE_DOC,currency:'USD',perOutputSecond:unitPrice}),
    note:'Paid Gemini Developer API, NOT Google Flow credits; estimate only. Non-deterministic model output even with seed.'});
  return Object.freeze({publicPlan,request:Object.freeze({
    method:'POST',url:`${API}/models/${model}:predictLongRunning`,body
  })});
}

function requireKey(value){return requireText(value,'Gemini Developer API key',4096)}
function opUrl(name){
 if(!validOperation(name))throw new TypeError('unsafe or invalid Gemini operation name');
 return `${API}/${encoded(name)}`;
}
async function readJson(response){
  const body=await response.json().catch(()=>null);
  if(!isRecord(body))throw new TypeError('Gemini provider returned invalid JSON');
  return body;
}

/** A LIVE billable submission. The caller retains attempt state BEFORE calling this. */
export async function submitGeminiVeoShot(prepared,{apiKey,fetch=globalThis.fetch,
  spendAuthorized=false,maxUsd=0,operatorRef}={}){
  if(!prepared?.publicPlan||!prepared?.request)throw new TypeError('prepared cinematic shot required');
  requireText(operatorRef,'authorized spending operator',256);
  if(spendAuthorized!==true||!Number.isFinite(maxUsd)||maxUsd<prepared.publicPlan.estimatedMaximumUsd)
    throw new TypeError('a separately approved USD spend limit must cover the proposed shot');
  const key=requireKey(apiKey);
  if(typeof fetch!=='function')throw new TypeError('provider fetch required');
  let response;
  try{response=await fetch(prepared.request.url,{
    method:'POST',headers:jsonHeaders(key),body:JSON.stringify(prepared.request.body),redirect:'error'});
  }catch{
    const e=new Error('Gemini submission outcome unknown; inspect provider before any retry');
    e.code='VEO_SUBMISSION_UNCERTAIN';throw e;
  }
  if(!response.ok){
    // No raw provider body: it could echo prompt, image or account material.
    const e=new Error(`Gemini video submission answered HTTP ${response.status}; do not replay automatically`);
    e.code='VEO_SUBMISSION_REFUSED_OR_UNCERTAIN';throw e;
  }
  const answer=await readJson(response).catch(()=>null);
  if(!validOperation(answer?.name)){
    const e=new Error('Gemini submission reply had no usable operation; reconcile before retry');
    e.code='VEO_SUBMISSION_UNCERTAIN';throw e;
  }
  return Object.freeze({type:'GeminiVeoSubmittedShot',status:'PROVIDER_OPERATION_PENDING',
    operationName:answer.name,operatorRef,provider:prepared.publicPlan.provider,
    model:prepared.publicPlan.model,shotId:prepared.publicPlan.shotId,
    requestSha256:prepared.publicPlan.requestSha256,
    estimatedMaximumUsd:prepared.publicPlan.estimatedMaximumUsd,
    chargedAmountUsd:null,
    note:'Submission accepted into provider queue; not finished/settled media or confirmed final charge.'});
}

/** READ ONLY: no second paid POST, safe for repeated receiving passes. */
export async function readGeminiVeoOperation(operationName,{apiKey,fetch=globalThis.fetch}={}){
  const key=requireKey(apiKey),url=opUrl(operationName);
  const response=await fetch(url,{method:'GET',headers:{'x-goog-api-key':key},redirect:'error'});
  if(!response.ok)throw new Error(`Gemini video operation read answered HTTP ${response.status}`);
  const status=await readJson(response);
  if(status.name!==operationName)throw new TypeError('provider returned a different operation identity');
  if(status.done!==true)return Object.freeze({status:'pending',operationName});
  if(status.error)return Object.freeze({status:'failed',operationName,code:status.error.code??null,
    note:'Provider failure; no media accepted. Do not infer an uncharged result.'});
  const outputs=status.response?.generateVideoResponse?.generatedSamples;
  const uri=outputs?.[0]?.video?.uri;
  if(!Array.isArray(outputs)||outputs.length!==1||typeof uri!=='string')
    throw new TypeError('completed video operation has no single usable media reference');
  requireSafeVideoUrl(uri);
  return Object.freeze({status:'generated',operationName,videoUri:uri,
    note:'Provider completed; independently download, hash and inspect media before acceptance.'});
}

function requireSafeVideoUrl(uri){
 let url;
 try{url=new URL(uri)}catch{throw new TypeError('invalid provider video URI')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||
   !['generativelanguage.googleapis.com','storage.googleapis.com'].includes(url.hostname))
   throw new TypeError('provider video URI host not allowlisted');
 return url;
}
/** READ ONLY: accept only Google's documented download domains, no arbitrary redirects. */
export async function receiveGeminiVeoVideo(videoUri,{apiKey,fetch=globalThis.fetch,maxBytes=80_000_000}={}){
 const key=requireKey(apiKey);
 if(!Number.isSafeInteger(maxBytes)||maxBytes<4||maxBytes>200_000_000)throw new TypeError('invalid video byte ceiling');
 let u=requireSafeVideoUrl(videoUri),response;
 for(let redirect=0;redirect<=3;redirect++){
   response=await fetch(u.href,{method:'GET',redirect:'manual',headers:u.hostname==='generativelanguage.googleapis.com'?{'x-goog-api-key':key}:{}});
   if([301,302,303,307,308].includes(response.status)){
     const location=response.headers.get('location');
     if(!location||redirect===3)throw new TypeError('unsupported video download redirect');
     u=requireSafeVideoUrl(new URL(location,u).href);continue;
   }
   break;
 }
 if(!response.ok)throw new Error(`Gemini video download answered HTTP ${response.status}`);
 const len=Number(response.headers.get('content-length'));
 if(Number.isFinite(len)&&len>maxBytes)throw new TypeError('provider video exceeded receiving capacity');
 const mimeType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(mimeType!=='video/mp4'&&mimeType!=='application/octet-stream')
   throw new TypeError('provider did not return MP4 media');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length<12||bytes.length>maxBytes||bytes.subarray(4,8).toString('ascii')!=='ftyp')
   throw new TypeError('provider video is not a bounded ISO base media file');
 return Object.freeze({bytes,mimeType:'video/mp4',sha256:sha(bytes),
   state:'RECEIVED_PROVIDER_BYTES_AWAITING_MEDIA_REVIEW',
   note:'Hash and MP4 signature received; ffprobe, performance QA, source rights and customer review are separate.'});
}
export const GEMINI_VEO_API_DOCUMENTATION=DOC;
