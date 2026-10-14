#!/usr/bin/env node
/**
 * Real one-shot Gemini Veo cinematic generation, with crash-safe paid request
 * admission. The shot spec is an input boundary from an owning production;
 * it is neither a story bible nor an authorization to spend or publish.
 *
 * preview SPEC.json
 * submit SPEC.json PRIVATE_JOB_DIR --approve-paid --max-usd 0.80 --operator REF [--provider-requalified PROVIDER-EVIDENCE-REF]
 * receive PRIVATE_JOB_DIR                 (read-only provider status)
 * receive PRIVATE_JOB_DIR --download      (retrieve and hash completed video)
 * verify PRIVATE_JOB_DIR                  (offline original-media integrity check)
 *
 * No automatic retries on a paid POST; the attempted record survives a crash.
 * Google Flow UI credits do NOT pay for this distinct Gemini Developer API.
 */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, openSync, closeSync, lstatSync} from 'node:fs';
import {dirname, resolve, relative, isAbsolute, sep, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {prepareGeminiVeoShot,submitGeminiVeoShot,readGeminiVeoOperation,receiveGeminiVeoVideo,
 assertGeminiVeoPreviewSubmissionWindow} from '../../src/media/gemini-veo-video.mjs';

const die=(msg)=>{throw new TypeError(msg)};
const text=x=>typeof x==='string'&&x.trim().length>0;
const sha=x=>createHash('sha256').update(x).digest('hex');
function localAsset(root,original,label){
 if(!original||!text(original.path)||isAbsolute(original.path)||original.path.includes('\\')||
    original.path.split('/').some(x=>!x||x==='.'||x==='..'))die(`${label}: only clean manifest-relative file paths permitted`);
 const abs=realpathSync(resolve(root,original.path)),sub=relative(root,abs);
 if(!sub||sub==='..'||sub.startsWith(`..${sep}`)||isAbsolute(sub))die(`${label}: image escapes owner source directory`);
 const bytes=readFileSync(abs);
 return {...original,bytes};
}
function loadSpecification(path){
 const resolved=realpathSync(resolve(path));
 const bytes=readFileSync(resolved);
 if(bytes.length>200_000)die('shot spec exceeds 200 KB');
 const shot=JSON.parse(bytes.toString('utf8'));
 const root=realpathSync(dirname(resolved));
 const selected={...shot,referenceImages:(shot.referenceImages??[]).map((a,i)=>localAsset(root,a,`reference ${i+1}`))};
 if(shot.firstFrame)selected.firstFrame=localAsset(root,shot.firstFrame,'firstFrame');
 if(shot.lastFrame)selected.lastFrame=localAsset(root,shot.lastFrame,'lastFrame');
 return {prepared:prepareGeminiVeoShot(selected),sourceSpecSha256:sha(bytes)};
}
function storeJSON(path,content){
 if(existsSync(path))die('record already exists; do not overwrite or repeat a paid submission');
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(content,null,2)+'\n');}finally{closeSync(fd)}
}
const HEX_256=/^[a-f0-9]{64}$/u;
/** Verify the original provider media at custody, not artistic quality or publication. */
function assertStoredMedia(file,digest,length){
 if(!HEX_256.test(digest)||!Number.isSafeInteger(length)||length<12)
   die('invalid original media digest or byte count');
 let info;
 try{info=lstatSync(file)}catch(error){
   if(error.code==='ENOENT')die('received video bytes are missing; receipt alone is not media');
   throw error;
 }
 if(!info.isFile()||info.isSymbolicLink())
   die('received video must be a regular locally stored file, not a link');
 if(info.size!==length)die('received video bytes differ from recorded size');
 if(sha(readFileSync(file))!==digest)die('received video SHA-256 differs from receipt');
}
/**
 * An offline local custody assay for post-production, including expired API
 * operations. Does not refresh, replace, or claim editorial acceptance.
 */
export function verifyCinematicVeoMedia(dir){
 const attempted=JSON.parse(readFileSync(join(dir,'attempted.json'),'utf8'));
 const submitted=JSON.parse(readFileSync(join(dir,'submitted.json'),'utf8'));
 const recorded=JSON.parse(readFileSync(join(dir,'received.json'),'utf8'));
 if(attempted.type!=='GeminiVeoSubmissionAttempt'||
    attempted.state!=='POST_OUTCOME_UNKNOWN_UNTIL_OPERATION_OBSERVED'||
    attempted.prepared?.type!=='GeminiVeoCinematicShot'||
    !HEX_256.test(submitted.requestSha256??'')||
    submitted.type!=='GeminiVeoSubmittedShot'||
    submitted.provider!=='urn:ame:google-gemini-developer-api'||
    attempted.prepared.requestSha256!==submitted.requestSha256||
    attempted.prepared.model!==submitted.model||
    attempted.prepared.shotId!==submitted.shotId||
    attempted.prepared.provider!==submitted.provider||
    recorded.type!=='GeminiVeoProviderByteReceipt'||
    recorded.state!=='RECEIVED_PROVIDER_BYTES_AWAITING_MEDIA_REVIEW'||
    !HEX_256.test(recorded.receivedVideoSha256??'')||
    recorded.mediaRelativePath!=='media/'+recorded.receivedVideoSha256+'.mp4'||
    recorded.sourceRequestSha256!==submitted.requestSha256||
    recorded.operationName!==submitted.operationName||
    recorded.model!==submitted.model||
    recorded.shotId!==submitted.shotId)
   die('video receipt does not match the original submitted operation and shot');
 assertStoredMedia(join(dir,recorded.mediaRelativePath),
   recorded.receivedVideoSha256,recorded.bytes);
 return Object.freeze({...recorded,localCustody:'VERIFIED_ORIGINAL_MP4_BYTES',
   custodyNote:'Local size and SHA-256 match submission-linked receipt. Not cinematic QA, rights approval, confirmed charge, or public publication.'});
}
const parseLimit=x=>{
 const value=Number(x);
 if(!text(x)||!Number.isFinite(value)||value<0||value>1000)die('bounded USD spend ceiling required');
 return value;
};

export async function cinematicVeoCli(args,{env=process.env,fetch=globalThis.fetch,print=msg=>process.stdout.write(msg+'\n'),nowMs=Date.now()}={}){
 const [command,argument,other,...options]=args;
 if(command==='preview'){
  if(!argument||other!==undefined)die('usage: preview SHOT.json');
  const source=loadSpecification(argument);
  return print(JSON.stringify({...source.prepared.publicPlan,sourceSpecSha256:source.sourceSpecSha256},null,2));
 }
 if(command==='submit'){
  if(!argument||!other)die('usage: submit SHOT.json PRIVATE_JOB_DIR --approve-paid --max-usd USD --operator REF');
  if(![5,7].includes(options.length)||options[0]!=='--approve-paid'||options[1]!=='--max-usd'||options[3]!=='--operator'||
     (options.length===7&&(options[5]!=='--provider-requalified'||!text(options[6]))))
    die('explicit paid approval, USD ceiling and operator required');
  const maxUsd=parseLimit(options[2]),operatorRef=options[4];
  const providerRequalificationRef=options.length===7?options[6]:null;
  if(!text(operatorRef)||!text(env.GEMINI_API_KEY))die('spending operator and GEMINI_API_KEY are required');
  const source=loadSpecification(argument),dir=resolve(other);
  if(maxUsd<source.prepared.publicPlan.estimatedMaximumUsd)die('USD ceiling is below observed cinematic shot price');
  // Admission before creating a one-time irreversible paid-attempt record.
  assertGeminiVeoPreviewSubmissionWindow(source.prepared.publicPlan.model,{nowMs,providerRequalificationRef});
  mkdirSync(dir,{recursive:true,mode:0o700});
  // All durable effects for an ambiguous POST are protected by one exclusive
  // claim file. Even HTTP failure does not magically make retry safe.
  storeJSON(join(dir,'attempted.json'),{type:'GeminiVeoSubmissionAttempt',
    state:'POST_OUTCOME_UNKNOWN_UNTIL_OPERATION_OBSERVED',at:new Date().toISOString(),
    sourceSpecSha256:source.sourceSpecSha256,prepared:source.prepared.publicPlan,
    spendingOperator:operatorRef,spendLimitUsd:maxUsd,
    providerRequalificationClaimRef:providerRequalificationRef});
  const submitted=await submitGeminiVeoShot(source.prepared,{apiKey:env.GEMINI_API_KEY,
    spendAuthorized:true,maxUsd,operatorRef,fetch,nowMs,providerRequalificationRef});
  storeJSON(join(dir,'submitted.json'),submitted);
  return print(JSON.stringify(submitted,null,2));
 }
 if(command==='verify'){
  if(!argument||other!==undefined||options.length)die('usage: verify PRIVATE_JOB_DIR');
  return print(JSON.stringify(verifyCinematicVeoMedia(resolve(argument)),null,2));
 }
 if(command==='receive'){
  if(!argument|| (other!==undefined&&other!=='--download')||options.length)die('usage: receive PRIVATE_JOB_DIR [--download]');
  if(!text(env.GEMINI_API_KEY))die('GEMINI_API_KEY required to receive an existing operation');
  const dir=resolve(argument),submitted=JSON.parse(readFileSync(join(dir,'submitted.json'),'utf8'));
  if(submitted.type!=='GeminiVeoSubmittedShot')die('not a genuine Veo submitted-operation record');
  const operation=await readGeminiVeoOperation(submitted.operationName,{apiKey:env.GEMINI_API_KEY,fetch});
  if(other!=='--download'||operation.status!=='generated')return print(JSON.stringify({status:operation.status,operationName:operation.operationName,note:operation.note??null}));
  const completion=join(dir,'received.json');
  if(existsSync(completion))return print(JSON.stringify(verifyCinematicVeoMedia(dir),null,2));
  const video=await receiveGeminiVeoVideo(operation.videoUri,{apiKey:env.GEMINI_API_KEY,fetch});
  const media=join(dir,'media');mkdirSync(media,{recursive:true,mode:0o700});
  const file=join(media,video.sha256+'.mp4');
  // Refuse damaged existing bytes even when the provider just returned a
  // valid fresh copy: never create a false receipt for a corrupt local MP4.
  try{
    const fd=openSync(file,'wx',0o600);
    try{writeFileSync(fd,video.bytes)}finally{closeSync(fd)}
  }catch(error){if(error.code!=='EEXIST')throw error}
  assertStoredMedia(file,video.sha256,video.bytes.length);
  const output={type:'GeminiVeoProviderByteReceipt',
    state:video.state,sourceRequestSha256:submitted.requestSha256,operationName:submitted.operationName,
    receivedVideoSha256:video.sha256,mediaRelativePath:'media/'+video.sha256+'.mp4',
    bytes:video.bytes.length,model:submitted.model,shotId:submitted.shotId,
    note:'Provider bytes received only. Editorial/character-identity/rights/quality, fee settlement and publication require independent receiving.'};
  storeJSON(completion,output);
  return print(JSON.stringify(output,null,2));
 }
 die('usage: gemini-veo-shot.mjs preview|submit|receive|verify ...');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await cinematicVeoCli(process.argv.slice(2));}catch(error){
   process.stderr.write((error?.code??'ERROR')+': '+error.message+'\n');process.exitCode=1;
 }
}
