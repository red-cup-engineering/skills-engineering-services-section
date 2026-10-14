import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {cinematicVeoCli} from '../../scripts/media/gemini-veo-shot.mjs';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const hash=x=>createHash('sha256').update(x).digest('hex');
const BEFORE=Date.parse('2026-10-13T12:00:00Z');
const response=(status,body,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},json:async()=>body,arrayBuffer:async()=>Buffer.from(body)});
const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'redcup-veo-test-'));
 writeFileSync(join(root,'character.png'),png);
 const spec={shotId:'shot-in-world',sourceRef:'git:561-tv-episode-revision',
  consumer:'causeway-original-fiction',mediaNeed:'urn:media-need:5656:1',
  prompt:'Cinematic video of two original marine agents in a luminous glass-sponge temple, precise original performances, vibrant underwater lighting and moving camera.',
  referenceImages:[{id:'char',path:'character.png',mimeType:'image/png',sha256:hash(png),rightsRef:'source:original-art-authorized'}],
  model:'veo-3.1-fast-generate-preview',durationSeconds:8};
 const path=join(root,'shot.json');writeFileSync(path,JSON.stringify(spec));
 return {root,path,job:join(root,'private-job')};
};
const out=(messages=[])=>({messages,print:value=>messages.push(JSON.parse(value))});

test('preview is truly credentialless: resolves real image bytes and outputs only hashes and USD estimate',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 const {messages,print}=out();
 await cinematicVeoCli(['preview',f.path],{env:{},print});
 assert.equal(messages[0].estimatedMaximumUsd,0.80);
 assert.equal(messages[0].referenceAssets[0].sha256,hash(png));
 assert.equal(JSON.stringify(messages).includes(png.toString('base64')),false);
 assert.equal(existsSync(f.job),false);
});
test('a low USD budget cannot poison one-time paid submission state',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 await assert.rejects(()=>cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','0.40','--operator','owner'],{env:{GEMINI_API_KEY:'key'},print:()=>{}}),/ceiling is below/u);
 assert.equal(existsSync(f.job),false);
 await assert.rejects(()=>cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','1.00','--operator','owner'],{env:{},print:()=>{}}),/GEMINI_API_KEY/u);
 assert.equal(existsSync(f.job),false);
});
test('actual submit -> poll -> download can resume with exact receipt and NEVER double-buy on restart',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 const film=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(22)]);
 let calls=0;
 const fetch=async (url,req)=>{
  calls++;
  if(req.method==='POST')return response(200,{name:'operations/once'});
  if(url.endsWith('/operations/once'))return response(200,{name:'operations/once',done:true,
   response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://generativelanguage.googleapis.com/v1beta/files/clip:download'}}]}}});
  return response(200,film,{'content-type':'video/mp4'});
 };
 const env={GEMINI_API_KEY:'unlogged-api-key'};
 const created=out();
 await cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','0.80','--operator','cinema-director'],{env,fetch,print:created.print,nowMs:BEFORE});
 assert.equal(calls,1);
 assert.equal(created.messages[0].operationName,'operations/once');
 assert.ok(existsSync(join(f.job,'attempted.json')));
 assert.ok(existsSync(join(f.job,'submitted.json')));
 assert.equal(JSON.stringify(created.messages).includes('unlogged-api-key'),false);
 await assert.rejects(()=>cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','0.80','--operator','cinema-director'],{env,fetch,print:()=>{},nowMs:BEFORE}),/do not overwrite/u);
 assert.equal(calls,1,'not a single additional paid POST');
 const received=out();
 await cinematicVeoCli(['receive',f.job,'--download'],{env,fetch,print:received.print});
 assert.equal(received.messages[0].receivedVideoSha256,hash(film));
 assert.equal(received.messages[0].state,'RECEIVED_PROVIDER_BYTES_AWAITING_MEDIA_REVIEW');
 assert.ok(existsSync(join(f.job,received.messages[0].mediaRelativePath)));
 assert.equal(readFileSync(join(f.job,received.messages[0].mediaRelativePath)).equals(film),true);
 const before=calls;
 await cinematicVeoCli(['receive',f.job,'--download'],{env,fetch,print:()=>{}});
 assert.equal(calls,before+1,'a harmless status GET only; no second download after durable receiving');
 const offline=out();
 await cinematicVeoCli(['verify',f.job],{env:{},fetch:()=>{throw Error('offline verification must not call provider')},print:offline.print});
 assert.equal(offline.messages[0].localCustody,'VERIFIED_ORIGINAL_MP4_BYTES');
 assert.equal(calls,before+1,'offline custody does not need the Gemini API');
 const stored=join(f.job,received.messages[0].mediaRelativePath);
 writeFileSync(stored,Buffer.alloc(film.length));
 await assert.rejects(()=>cinematicVeoCli(['verify',f.job],{env:{},print:()=>{}}),/SHA-256 differs/u);
 writeFileSync(stored,film);
 const receiptPath=join(f.job,'received.json');
 const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
 writeFileSync(receiptPath,JSON.stringify({...receipt,operationName:'operations/other'}));
 await assert.rejects(()=>cinematicVeoCli(['verify',f.job],{env:{},print:()=>{}}),/does not match/u);
 writeFileSync(receiptPath,JSON.stringify(receipt));
 const attemptPath=join(f.job,'attempted.json');
 const attempt=JSON.parse(readFileSync(attemptPath,'utf8'));
 writeFileSync(attemptPath,JSON.stringify({...attempt,
  prepared:{...attempt.prepared,requestSha256:'0'.repeat(64)}}));
 await assert.rejects(()=>cinematicVeoCli(['verify',f.job],{env:{},print:()=>{}}),/does not match/u);
 writeFileSync(attemptPath,JSON.stringify(attempt));
 writeFileSync(receiptPath,JSON.stringify({...receipt,state:'PUBLISHED'}));
 await assert.rejects(()=>cinematicVeoCli(['verify',f.job],{env:{},print:()=>{}}),/does not match/u);
 writeFileSync(receiptPath,JSON.stringify(receipt));
 rmSync(stored);
 await assert.rejects(()=>cinematicVeoCli(['verify',f.job],{env:{},print:()=>{}}),/bytes are missing/u);
});
test('ambiguous paid POST remains locked to one attempted request; no generated-operation receipt is invented',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 let called=0;
 const env={GEMINI_API_KEY:'secret'};
 await assert.rejects(()=>cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','1.00','--operator','owner'],{
  env,fetch:async()=>{called++;throw Error('lost connection after POST')},print:()=>{},nowMs:BEFORE}),e=>e.code==='VEO_SUBMISSION_UNCERTAIN');
 assert.equal(called,1);
 assert.equal(existsSync(join(f.job,'attempted.json')),true);
 assert.equal(existsSync(join(f.job,'submitted.json')),false);
 await assert.rejects(()=>cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','1.00','--operator','owner'],{
  env,fetch:async()=>{called++;return response(200,{name:'operations/double-billed'})},print:()=>{},nowMs:BEFORE}),/do not overwrite/u);
 assert.equal(called,1);
});

test('preview retirement hold leaves no poisoned attempt and accepts explicit operator requalification',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 const nowMs=Date.parse('2026-10-22T00:00:00Z');
 let posts=0;const fetch=async()=>{posts++;return response(200,{name:'operations/qualified'})};
 const args=['submit',f.path,f.job,'--approve-paid','--max-usd','0.80','--operator','director'];
 const ctx={env:{GEMINI_API_KEY:'secret'},fetch,nowMs,print:()=>{}};
 await assert.rejects(()=>cinematicVeoCli(args,ctx),
  e=>e.code==='VEO_PREVIEW_REQUALIFICATION_REQUIRED');
 assert.equal(posts,0);
 assert.equal(existsSync(f.job),false,'blocked work cannot poison one-time paid attempt custody');
 const seen=out();
 await cinematicVeoCli([...args,'--provider-requalified','provider:verified-current-api-price'],
  {...ctx,print:seen.print});
 assert.equal(posts,1);
 assert.equal(seen.messages[0].providerRequalificationClaimRef,'provider:verified-current-api-price');
 assert.equal(existsSync(join(f.job,'attempted.json')),true);
});

test('first media receipt refuses pre-existing corrupt MP4 without inventing accepted custody',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));
 const film=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(22)]);
 const fetch=async(url,req)=>{
  if(req.method==='POST')return response(200,{name:'operations/once'});
  if(url.endsWith('/operations/once'))return response(200,{name:'operations/once',done:true,
   response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://generativelanguage.googleapis.com/v1beta/files/clip:download'}}]}}});
  return response(200,film,{'content-type':'video/mp4'});
 };
 const env={GEMINI_API_KEY:'secret'};
 await cinematicVeoCli(['submit',f.path,f.job,'--approve-paid','--max-usd','0.80','--operator','cinema-director'],
  {env,fetch,print:()=>{},nowMs:BEFORE});
 const stored=join(f.job,'media',hash(film)+'.mp4');
 mkdirSync(join(f.job,'media'));
 writeFileSync(stored,Buffer.alloc(film.length));
 await assert.rejects(()=>cinematicVeoCli(['receive',f.job,'--download'],{env,fetch,print:()=>{}}),/SHA-256 differs/u);
 assert.equal(existsSync(join(f.job,'received.json')),false,'never attest corrupt bytes');
 assert.equal(readFileSync(stored).equals(Buffer.alloc(film.length)),true,'do not destroy original evidence');
});
