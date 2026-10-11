import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPacing, nextGap, runFlowQueue, flowQueueDemand, resumeFlowSubmissions} from '../src/flow-generate.mjs';

test('an empty queue does not open Flow or read its credits',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-empty-'));t.after(()=>rm(state,{recursive:true,force:true}));
 const result=await runFlowQueue({state,config:{},open:async()=>assert.fail('No work requires no provider requests')});
 assert.equal(result.queued,0);assert.deepEqual(result.results,[]);
});

test('a held queue resumes accepted media IDs without generating again',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-accepted-'));t.after(()=>rm(state,{recursive:true,force:true}));
 await mkdir(join(state,'in-flight'));const path=join(state,'in-flight/accepted.json');
 const job={order:{consumer:'accepted',medium:'video'},lot:{id:'retained-work'},projectId:'owned-project',mediaIds:['provider-media-one'],price:20,account:'owned',received:[],failed:[]};
 await writeFile(path,JSON.stringify(job));await writeFile(join(state,'pacing.json'),JSON.stringify({verificationRequired:{code:'PUBLIC_ERROR_UNUSUAL_ACTIVITY'}}));
 let observed=0;const result=await runFlowQueue({state,config:{},open:async()=>({videoStatus:async ids=>{assert.deepEqual(ids,job.mediaIds);observed++;return [{mediaId:ids[0],status:'unfinished'}];}}),run:async()=>assert.fail('Accepted media cannot generate again')});
 assert.equal(observed,1);assert.equal(result.verificationRequired.code,'PUBLIC_ERROR_UNUSUAL_ACTIVITY');assert.equal(result.received[0].kept[0].mediaId,job.mediaIds[0]);assert.deepEqual(JSON.parse(await readFile(path,'utf8')).mediaIds,job.mediaIds);
});

test('a crashed attempted submission is retained for review instead of returning to the generation queue',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-uncertain-'));t.after(()=>rm(state,{recursive:true,force:true}));
 const claim=join(state,'orders/claimed/2147483647-1');await mkdir(claim,{recursive:true});
 const safe=JSON.stringify({consumer:'not-attempted'}),uncertain=JSON.stringify({consumer:'response-lost'});
 await writeFile(join(claim,'old.jsonl.claimed'),safe+'\n'+uncertain+'\n');await writeFile(join(claim,'taken.jsonl'),safe+'\n'+uncertain+'\n');await writeFile(join(claim,'attempted.jsonl'),uncertain+'\n');
 await writeFile(join(state,'pacing.json'),JSON.stringify({verificationRequired:{code:'PUBLIC_ERROR_UNUSUAL_ACTIVITY'}}));
 await runFlowQueue({state,config:{},open:async()=>assert.fail('Recovery must not submit')});
 const pending=join(state,'orders/pending');assert.equal(await readFile(join(pending,(await readdir(pending))[0]),'utf8'),safe+'\n');
 const review=join(state,'orders/review');assert.equal(await readFile(join(review,(await readdir(review))[0]),'utf8'),uncertain+'\n');
});

test('an account challenge survives pacing decay and preserves queued work without provider calls', async t => {
  const state = await mkdtemp(join(tmpdir(), 'flow-challenge-'));
  t.after(() => rm(state, {recursive: true, force: true}));
  const pending = join(state, 'orders/pending'), pacing = join(state, 'pacing.json');
  await mkdir(pending, {recursive: true});
  const bytes = '{"consumer":"retained-order","prompt":"source-grounded scene"}\n';
  await writeFile(join(pending, 'order.jsonl'), bytes);
  const interrupted = join(state, 'orders/claimed/2147483647-0');
  await mkdir(interrupted, {recursive: true});
  const unspent = '{"consumer":"recoverable","prompt":"accepted source"}\n';
  const spent = '{"consumer":"already-spent","prompt":"completed submission"}\n';
  await writeFile(join(interrupted, 'old.jsonl.claimed'), unspent + spent);
  await writeFile(join(interrupted, 'taken.jsonl'), unspent + spent);
  await writeFile(join(interrupted, 'spent.jsonl'), spent);
  await writeFile(pacing, JSON.stringify({gapMs: 10000, at: '2020-01-01T00:00:00Z', verificationRequired: {code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY'}}));
  assert.equal(readPacing(pacing).verificationRequired.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
  const unexpected = async () => assert.fail('Paused generation must not contact the provider');
  const result = await runFlowQueue({state, config: {}, open: unexpected, run: unexpected});
  assert.equal(result.verificationRequired.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
  assert.equal(await readFile(join(pending, 'order.jsonl'), 'utf8'), bytes);
  assert.equal(await readFile(join(pending, 'old.1-taken.jsonl'), 'utf8'), unspent);
  assert.equal(result.queued, 2);
  const demand = flowQueueDemand(result, {state, config: {}});
  assert.equal(demand.nextAt, undefined);
  assert(demand.watch.includes(pacing));
  await writeFile(pacing,'{interrupted');
  assert.equal((await runFlowQueue({state,config:{},open:unexpected,run:unexpected})).verificationRequired.code,'FLOW_PACING_STATE_UNREADABLE');
});


test('idle time does not erase caution and accepted calls recover pace gradually',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-pace-'));t.after(()=>rm(state,{recursive:true,force:true}));
 const path=join(state,'pacing.json');await writeFile(path,JSON.stringify({gapMs:360000,at:'2020-01-01T00:00:00Z'}));
 assert.equal(readPacing(path).gapMs,360000);assert.equal(nextGap(360000,false),352800);
 assert.equal(nextGap(60000,false),60000);assert.equal(nextGap(360000,true),600000);
});

test('a credit-rich queue leaves excess clips pending instead of spending the whole backlog',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-burst-'));t.after(()=>rm(state,{recursive:true,force:true}));
 const pending=join(state,'orders/pending');await mkdir(pending,{recursive:true});
 const line={consumer:'bounded-order',medium:'video',model:'veo_3_1_t2v_lite',aspect:'9:16',count:4,prompt:'A source-grounded scene'};
 await writeFile(join(pending,'order.jsonl'),Array.from({length:3},(_,i)=>JSON.stringify({...line,consumer:'bounded-order-'+i})).join('\n')+'\n');
 let submitted;
 const result=await runFlowQueue({state,config:{tier:'pro',meters:[{id:'daily',budget:10000}]},open:async()=>({credits:async()=>({balance:10000,renewsAt:new Date(Date.now()+86400000).toISOString()}),models:async()=>[{key:'veo_3_1_t2v_lite',credits:20}]}),run:async order=>{submitted=order;return {results:order.map(row=>({consumer:row.consumer,kept:[]}))};}});
 assert.equal(submitted.reduce((sum,row)=>sum+row.count,0),3);
 const {readdir}=await import('node:fs/promises');const remaining=(await readdir(pending)).filter(name=>name.endsWith('.jsonl'));
 assert.equal(remaining.length,1);assert.equal((await readFile(join(pending,remaining[0]),'utf8')).trim().split('\n').map(row=>JSON.parse(row)).reduce((sum,row)=>sum+row.count,0),9);
 assert(submitted.every(row=>row.count===1));
 const now=new Date();const demand=flowQueueDemand(result,{state,now,config:{meters:[]}});
 assert.equal(demand.nextAt,new Date(now.getTime()+20*60_000).toISOString());
});


test('a missing session retains acknowledged media while keeping new generation held',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-session-'));t.after(()=>rm(state,{recursive:true,force:true}));
 await mkdir(join(state,'in-flight'));const path=join(state,'in-flight/accepted.json');
 const bytes=JSON.stringify({order:{consumer:'accepted'},lot:{id:'retained'},projectId:'owned',mediaIds:['accepted']});await writeFile(path,bytes);
 await writeFile(join(state,'pacing.json'),JSON.stringify({verificationRequired:{code:'PUBLIC_ERROR_UNUSUAL_ACTIVITY'}}));
 const result=await runFlowQueue({state,config:{},open:async()=>{throw Object.assign(new Error('session unavailable'),{code:'SIGNED_OUT'});}});
 assert.equal(result.received[0].code,'SIGNED_OUT');assert.equal(result.verificationRequired.code,'PUBLIC_ERROR_UNUSUAL_ACTIVITY');assert.equal(await readFile(path,'utf8'),bytes);
});

test('failed receipt of an acknowledged image preserves its identity without regeneration',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-image-receipt-'));t.after(()=>rm(state,{recursive:true,force:true}));
 await mkdir(join(state,'in-flight'));const path=join(state,'in-flight/accepted.json');
 const bytes=JSON.stringify({order:{consumer:'accepted',medium:'image'},lot:{id:'retained'},projectId:'owned',mediaIds:['accepted'],images:[{mediaId:'accepted',imageUrl:'https://media.invalid/authorized-image'}]});await writeFile(path,bytes);
 let downloads=0;
 const result=await resumeFlowSubmissions({state,open:async()=>({generateImages:async()=>assert.fail('No new image'),download:async url=>{downloads++;assert.equal(url,'https://media.invalid/authorized-image');throw new Error('temporary download failure');}})});
 assert.equal(downloads,1);assert.equal(result[0].status,'received-media-pending');assert.equal(await readFile(path,'utf8'),bytes);
});

test('a custody failure after acknowledged spending cannot requeue the generation',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-spent-'));t.after(()=>rm(state,{recursive:true,force:true}));
 const pending=join(state,'orders/pending');await mkdir(pending,{recursive:true});
 const line={consumer:'accepted',medium:'video',model:'veo_3_1_t2v_lite',aspect:'9:16',count:1,prompt:'An owned scene'};
 await writeFile(join(pending,'order.jsonl'),JSON.stringify(line)+'\n');
 await runFlowQueue({state,config:{tier:'pro',meters:[{id:'daily',budget:100}]},open:async()=>({credits:async()=>({balance:100,renewsAt:new Date(Date.now()+86400000).toISOString()}),models:async()=>[{key:line.model,credits:20}]}),run:async(order,{onAttempt,onSpent})=>{onAttempt(order[0]);onSpent(order[0]);return {results:[{consumer:'accepted',failed:'Drive quota temporarily exhausted'}]};}});
 assert.equal((await readdir(pending)).filter(name=>name.endsWith('.jsonl')).length,0);
});


test('interruption between claim-file renames restores every original order',async t=>{
 const state=await mkdtemp(join(tmpdir(),'flow-claim-commit-'));t.after(()=>rm(state,{recursive:true,force:true}));
 const claim=join(state,'orders/claimed/2147483647-1');await mkdir(claim,{recursive:true});
 await writeFile(join(claim,'claim.json'),JSON.stringify({format:2}));
 await writeFile(join(claim,'first.jsonl.claimed'),'{"consumer":"first"}\n');
 await writeFile(join(claim,'second.jsonl'),'{"consumer":"second"}\n');
 await writeFile(join(claim,'taken.jsonl'),'{"consumer":"first"}\n{"consumer":"second"}\n');
 await writeFile(join(state,'pacing.json'),JSON.stringify({verificationRequired:{code:'PUBLIC_ERROR_UNUSUAL_ACTIVITY'}}));
 await runFlowQueue({state,config:{},open:async()=>assert.fail('Recovery must not submit')});
 const pending=join(state,'orders/pending');assert.deepEqual((await readdir(pending)).sort(),['first.jsonl','second.jsonl']);
 assert.equal(await readFile(join(pending,'first.jsonl'),'utf8'),'{"consumer":"first"}\n');
});
