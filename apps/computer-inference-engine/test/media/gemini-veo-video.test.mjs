import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 prepareGeminiVeoShot,submitGeminiVeoShot,readGeminiVeoOperation,receiveGeminiVeoVideo
} from '../../src/media/gemini-veo-video.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const BEFORE=Date.parse('2026-10-13T12:00:00Z');
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const asset=(id,b=png)=>({id,bytes:b,mimeType:'image/png',sha256:sha(b),rightsRef:'proof:original-generated-image-accepted-by-fiction-editor'});
const input=()=>({shotId:'shot-001',sourceRef:'git:accepted-story-revision-1',
 consumer:'causeway-original-fiction',mediaNeed:'urn:media-need:fiction:cinematic-audition-1',
 prompt:'Cinematic close shot: original glass-sponge temple, a shrimp hero speaks while an amphipod friend listens; theatrical performances, original voices, shallow depth of field, camera push-in, luminous moving water and coherent film lighting. One 8-second take.',
 referenceImages:[asset('rill'),asset('temple')],model:'veo-3.1-fast-generate-preview',
 durationSeconds:8,resolution:'720p',aspectRatio:'9:16'});
const response=(status,json,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},json:async()=>json,arrayBuffer:async()=>Buffer.from(json)});
const submission=()=>prepareGeminiVeoShot(input());

test('actual Gemini Veo REST packet binds original reference bytes, source and cost without reporting the bytes in summary',()=>{
 const a=submission(),b=submission();
 assert.equal(a.request.method,'POST');
 assert.match(a.request.url,/models\/veo-3.1-fast-generate-preview:predictLongRunning$/u);
 assert.equal(a.publicPlan.mode,'reference-to-video');
 assert.equal(a.publicPlan.estimatedMaximumUsd,0.80);
 assert.equal(a.request.body.parameters.aspectRatio,'9:16');
 assert.equal(a.request.body.parameters.durationSeconds,'8');
 assert.equal(a.request.body.instances[0].referenceImages.length,2);
 assert.equal(a.request.body.instances[0].referenceImages[1].referenceType,'asset');
 assert.equal(a.request.body.instances[0].referenceImages[0].image.inlineData.data,png.toString('base64'));
 assert.equal(a.publicPlan.requestSha256,b.publicPlan.requestSha256);
 assert.equal(JSON.stringify(a.publicPlan).includes(png.toString('base64')),false);
 assert.equal(a.publicPlan.priceBasis.currency,'USD');
 assert.equal(a.publicPlan.modelLifecycle.earliestPossibleShutdownDate,'2026-10-22');
 assert.equal(a.publicPlan.modelLifecycle.exactShutdownDateConfirmed,false);
 assert.match(a.publicPlan.note,/NOT Google Flow credits/u);
});
test('provider model capability, bounded duration and true rights/custody references are enforced before any API call',()=>{
 assert.throws(()=>prepareGeminiVeoShot({...input(),model:'veo-3.1-lite-generate-preview'}),/Lite cannot use/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),referenceImages:[asset('a'),asset('b'),asset('c'),asset('d')]}),/maximum three/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),referenceImages:[asset('a'),asset('a')]}),/duplicate reference identity/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),durationSeconds:6}),/require eight-second/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),referenceImages:[{...asset('rill'),sha256:'a'.repeat(64)}]}),/SHA-256 mismatch/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),referenceImages:[{...asset('rill'),rightsRef:''}]}),/rights evidence/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),mediaNeed:''}),/media need/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),resolution:'4k',durationSeconds:4}),/require eight-second/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),aspectRatio:'4:3'}),/aspect ratio/u);
 const fast=prepareGeminiVeoShot({...input(),model:'veo-3.1-generate-preview'});
 assert.equal(fast.publicPlan.estimatedMaximumUsd,3.20);
});
test('first+last frames submit as the official REST fields and never leak frame base64 in plan',()=>{
 const x=prepareGeminiVeoShot({...input(),referenceImages:[],firstFrame:asset('first'),lastFrame:asset('last'),durationSeconds:6});
 assert.equal(x.publicPlan.mode,'frames-to-video');
 assert.equal(x.request.body.instances[0].lastFrame.inlineData.mimeType,'image/png');
 assert.equal(x.request.body.instances[0].referenceImages,undefined);
 assert.throws(()=>prepareGeminiVeoShot({...input(),lastFrame:asset('last')}),/mixed reference and frame modes/u);
 assert.throws(()=>prepareGeminiVeoShot({...input(),referenceImages:[],lastFrame:asset('last')}),/requires a first frame/u);
});
test('live submission is blocked without spending approval and a separately bounded USD ceiling',async()=>{
 let calls=0;
 const fetch=async()=>{calls++;return response(200,{name:'operations/ok'})};
 for(const opts of [{},{spendAuthorized:true,maxUsd:0.79},{spendAuthorized:true,maxUsd:0.80,operatorRef:''}])
   await assert.rejects(()=>submitGeminiVeoShot(submission(),{apiKey:'do-not-log',fetch,...opts}),/operator|approved USD/u);
 assert.equal(calls,0);
 const result=await submitGeminiVeoShot(submission(),{apiKey:'private-test-key',fetch,operatorRef:'cinema-chief',spendAuthorized:true,maxUsd:0.80,nowMs:BEFORE});
 assert.equal(calls,1);
 assert.equal(result.status,'PROVIDER_OPERATION_PENDING');
 assert.equal(result.operationName,'operations/ok');
 assert.equal(result.chargedAmountUsd,null);
 assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('provider POST uses exact documented API and 4xx or lost reply never silently trigger another paid request',async()=>{
 let count=0,seen;
 const opts={apiKey:'private-test-key',operatorRef:'cinema-chief',spendAuthorized:true,maxUsd:1,nowMs:BEFORE};
 const fetch=async(url,req)=>{count++;seen={url,req};return response(200,{name:'models/veo-3.1-fast-generate-preview/operations/paid-1'})};
 const out=await submitGeminiVeoShot(submission(),{...opts,fetch});
 assert.equal(out.operationName,'models/veo-3.1-fast-generate-preview/operations/paid-1');
 assert.equal(seen.req.headers['x-goog-api-key'],'private-test-key');
 assert.equal(seen.req.redirect,'error');
 assert.equal(JSON.parse(seen.req.body).instances[0].referenceImages.length,2);
 assert.equal(count,1);
 await assert.rejects(()=>submitGeminiVeoShot(submission(),{...opts,fetch:async()=>{throw Error('socket went away with account token')}}),e=>e.code==='VEO_SUBMISSION_UNCERTAIN'&&!String(e).includes('account token'));
 await assert.rejects(()=>submitGeminiVeoShot(submission(),{...opts,fetch:async()=>response(403,{error:{message:'sensitive'}})}),e=>e.code==='VEO_SUBMISSION_REFUSED_OR_UNCERTAIN'&&!String(e).includes('sensitive'));
});
test('polls only the existing operation, reports provider failures, and refuses foreign names/URLs',async()=>{
 let url;
 const fetch=async(x)=>{url=x;return response(200,{name:'operations/abc',done:false})};
 assert.equal((await readGeminiVeoOperation('operations/abc',{apiKey:'secret',fetch})).status,'pending');
 assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/operations/abc');
 const fail=await readGeminiVeoOperation('operations/abc',{apiKey:'secret',fetch:async()=>response(200,{name:'operations/abc',done:true,error:{code:429,message:'private prompt'}})});
 assert.equal(fail.status,'failed');
 assert.equal(fail.code,429);
 assert.equal(JSON.stringify(fail).includes('private prompt'),false);
 const done=await readGeminiVeoOperation('operations/abc',{apiKey:'secret',fetch:async()=>response(200,{name:'operations/abc',done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://generativelanguage.googleapis.com/v1beta/files/film:download?alt=media'}}]}}})});
 assert.equal(done.status,'generated');
 await assert.rejects(()=>readGeminiVeoOperation('https://attacker.test/operations/a',{apiKey:'secret',fetch}),/invalid Gemini operation/u);
 await assert.rejects(()=>readGeminiVeoOperation('operations/abc',{apiKey:'secret',fetch:async()=>response(200,{name:'operations/wrong',done:false})}),/different operation/u);
});
test('receives only allowlisted video bytes, verifies ISO media signature, and never sends API key to storage redirect',async()=>{
 const movie=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(48)]);
 let urls=[],headers=[];
 const fetch=async(url,options)=>{
   urls.push(url);headers.push(options.headers);
   if(urls.length===1)return response(302,null,{location:'https://storage.googleapis.com/signed/media.mp4'});
   return response(200,movie,{'content-type':'video/mp4','content-length':String(movie.length)});
 };
 const rec=await receiveGeminiVeoVideo('https://generativelanguage.googleapis.com/v1beta/files/test:download',{apiKey:'private-key',fetch});
 assert.equal(rec.sha256,sha(movie));
 assert.equal(rec.state,'RECEIVED_PROVIDER_BYTES_AWAITING_MEDIA_REVIEW');
 assert.equal(urls.length,2);
 assert.equal(headers[0]['x-goog-api-key'],'private-key');
 assert.equal(headers[1]['x-goog-api-key'],undefined);
 let unsafeCalls=0;
 await assert.rejects(()=>receiveGeminiVeoVideo('https://127.0.0.1/local',{apiKey:'private-key',fetch:async()=>{unsafeCalls++;}}),/not allowlisted/u);
 assert.equal(unsafeCalls,0);
 await assert.rejects(()=>receiveGeminiVeoVideo('https://generativelanguage.googleapis.com/file',{apiKey:'private-key',fetch:async()=>response(302,null,{location:'http://evil.test/steal'})}),/not allowlisted/u);
 await assert.rejects(()=>receiveGeminiVeoVideo('https://generativelanguage.googleapis.com/file',{apiKey:'private-key',fetch:async()=>response(200,Buffer.alloc(18),{'content-type':'video/mp4'})}),/ISO base media/u);
});

test('announced earliest Veo preview shutdown holds new paid requests, not old receiving',async()=>{
 const prepared=submission();let posts=0;
 const fetch=async()=>{posts++;return response(200,{name:'operations/requalified'})};
 const paid={apiKey:'private-test-key',operatorRef:'owner',spendAuthorized:true,
  maxUsd:0.80,nowMs:Date.parse('2026-10-22T00:00:00Z'),fetch};
 await assert.rejects(()=>submitGeminiVeoShot(prepared,paid),
  err=>err.code==='VEO_PREVIEW_REQUALIFICATION_REQUIRED'&&
   /gemini-omni-1.1-flash/u.test(err.message));
 assert.equal(posts,0,'no paid API request without a recent model/price witness');
 const admitted=await submitGeminiVeoShot(prepared,{...paid,
  providerRequalificationRef:'provider:live-gemini-api-model-and-price-observation'});
 assert.equal(posts,1);
 assert.equal(admitted.status,'PROVIDER_OPERATION_PENDING');
 assert.equal(admitted.providerRequalificationClaimRef,
  'provider:live-gemini-api-model-and-price-observation');
 const prior=await readGeminiVeoOperation('operations/old-paid',{apiKey:'test',
  fetch:async()=>response(200,{name:'operations/old-paid',done:false})});
 assert.equal(prior.status,'pending','read-only recovery outlives paid model admission');
});
