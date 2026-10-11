import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInferenceScheduler, dispatchJobs, EndpointRefusal, invokeEndpoint, invokeHarness, inferenceRegistryFromCatalog } from '../../src/fabric/inference-fabric.mjs';
import { createInferenceBroker } from '../../src/fabric/inference-broker.mjs';
import { attachInferenceJsonlSession } from '../../src/fabric/inference-jsonl-session.mjs';

const job = (id, extra = {}) => ({ id, messages: [{ role: 'user', content: 'Review this work.' }], maxTokens: 32, ...extra });
const endpoint = (id, extra = {}) => ({ id, model: id, baseUrl: 'http://127.0.0.1:1', auth: {mode:'none'}, ...extra });
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const within = (promise, milliseconds = 500) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`operation exceeded ${milliseconds}ms`)), milliseconds);
  Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
const temporary = (t) => { const root = mkdtempSync(join(tmpdir(), 'inference-settling-')); t.after(() => rmSync(root, {recursive:true,force:true})); return root; };

test('eight endpoint roundtable jobs share global and per-provider capacity without losing any result', async () => {
  let active = 0, peak = 0; const perProvider = new Map();
  const endpoints = Array.from({length:8},(_,i)=>endpoint(`endpoint-${i}`));
  const jobs = endpoints.flatMap(e => [job(`${e.id}-a`, {preferEndpoints:[e.id]}), job(`${e.id}-b`, {preferEndpoints:[e.id]})]);
  const result = await dispatchJobs(jobs, {endpoints, concurrency:3}, {invoke:async (e,j)=>{
    active++; peak=Math.max(peak,active); perProvider.set(e.id,(perProvider.get(e.id)??0)+1);
    assert.equal(perProvider.get(e.id),1); await delay(5); active--; perProvider.set(e.id,0);
    return {text:j.id,usage:{prompt_tokens:2,completion_tokens:1},cost:null};
  }});
  assert.equal(peak,3); assert.equal(result.summary.completed,16);
  assert.deepEqual(new Set(result.records.map(r=>r.id)),new Set(jobs.map(j=>j.id)));
  assert.equal(Object.keys(result.summary.byEndpoint).length,8);
});

test('rate-limited providers fall back within the attempt budget and preserve attempt evidence', async () => {
  const result = await dispatchJobs([job('fallback')], {endpoints:[endpoint('a'),endpoint('b')]}, {attempts:2,invoke:async e=>{
    if(e.id==='a')throw new EndpointRefusal('HTTP 429',{status:429,retryable:true,retryAfterMs:5});
    return {text:'delivered',usage:null,cost:null};
  }});
  assert.equal(result.records[0].endpoint,'b'); assert.equal(result.summary.fallbackCompletions,1);
  assert.deepEqual(result.records[0].attempts.map(a=>a.outcome),['refusal','completion']);
});

test('the shared schema validator enforces numeric and nested constraints before accepting output', async () => {
  const result=await dispatchJobs([job('schema',{outputContract:{format:'json',schema:{type:'object',required:['count'],properties:{count:{type:'integer',minimum:2}},additionalProperties:false}}})],{endpoints:[endpoint('a',{capabilities:['json-output']})]}, {invoke:async()=>({text:'{"count":1}'})});
  assert.equal(result.summary.completed,0);assert.equal(result.summary.verificationFailures,1);
});

test('invalid capacities and duplicate endpoint identities refuse before scheduling',()=>{
  for(const bad of [{concurrency:0},{rpm:0},{minIntervalMs:-1},{cooldownMs:-1}]) assert.throws(()=>createInferenceScheduler({endpoints:[endpoint('a',bad)]}));
  assert.throws(()=>createInferenceScheduler({endpoints:[endpoint('a'),endpoint('a')]}),/unique/);
});

test('scheduler close drains admitted work and rejects late or duplicate submissions',async()=>{
  const scheduler=createInferenceScheduler({endpoints:[endpoint('a')]},{invoke:async()=>{await delay(5);return {text:'result'};}});
  const first=scheduler.submit(job('first'));
  assert.equal((await scheduler.submit(job('first'))).refusal.type,'duplicate-id');
  const closing=scheduler.close();
  assert.equal((await scheduler.submit(job('late'))).refusal.type,'scheduler-closed');
  await closing;assert.equal((await first).text,'result');assert.equal(scheduler.snapshot().active,0);
});

test('catalog projection admits unauthenticated local and exact free cloud models without storing credentials',()=>{
  const row={providerId:'local',keyed:true,chatCompletionsUrl:'http://127.0.0.1:11434/v1/chat/completions',defaultModel:'model',auth:{mode:'none'},pricePerMillionTokensMicroUsd:{input:0,output:0},entitlement:{model:'model',cashCost:'zero',paidOverage:'forbidden'}};
  const cloud={...row,providerId:'cloud',chatCompletionsUrl:'https://example.invalid/v1/chat/completions',auth:{mode:'bearer'},apiKeyEnvVar:'KEY'};
  const catalog={rows:[row,cloud,{...cloud,providerId:'paid',entitlement:undefined}],routingPolicy:{freeFirstOrder:['local','cloud','paid']}};
  const result=inferenceRegistryFromCatalog(catalog,{env:{KEY:'secret'}});
  assert.equal(result.endpoints.length,2);assert.equal(result.excluded[0].reason,'zero-cash-not-established');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(inferenceRegistryFromCatalog(catalog,{env:{}}).endpoints.length,1);
});

test('shared transport retains timeout and retry-after refusal and verifies successful JSON',async()=>{
  await assert.rejects(invokeEndpoint(endpoint('a'),job('a'),{request:async()=>new Response('',{status:429,headers:{'retry-after':'3'}})}),e=>e instanceof EndpointRefusal&&e.status===429&&e.retryAfterMs===3000);
  let calls=0;
  const dry=await invokeEndpoint(endpoint('a'),job('dry'),{dryRun:true,request:()=>{calls++;throw Error();}});
  assert.equal(calls,0);assert.equal(dry.text,'');
  const result=await invokeEndpoint(endpoint('a'),job('valid',{outputContract:{format:'json',schema:{type:'integer',minimum:2}}}),{request:async()=>Response.json({choices:[{message:{content:'3'}}],usage:{prompt_tokens:1,completion_tokens:1}})});
  assert.deepEqual(result.verification,{format:'json',schema:true});
});

test('durable broker replays settlements and refuses changed payloads after restart',async t=>{
  const root=temporary(t), registryPath=join(root,'registry.json'),journalPath=join(root,'results.jsonl');
  writeFileSync(registryPath,JSON.stringify({endpoints:[endpoint('a')]}));
  let calls=0;const invoke=async()=>{calls++;return {text:'persisted',usage:null,cost:null};};
  const broker=createInferenceBroker({registryPath,journalPath,invoke});
  try {const receipt=broker.admit(job('durable'));assert.equal(receipt.receipt.status,'admitted');assert.equal((await receipt.result).text,'persisted');}finally{await broker.close();}
  const reopened=createInferenceBroker({registryPath,journalPath,invoke});
  try {
    assert.equal((await reopened.submit(job('durable'))).text,'persisted');
    assert.equal((await reopened.submit(job('durable',{maxTokens:64}))).refusal.type,'id-payload-conflict');
    assert.equal(reopened.marketSnapshot().settlements.usefulCompletions,1);assert.equal(calls,1);
  } finally {await reopened.close();}
});

test('JSONL session handles split frames, receipt-only submission and malformed lines',async()=>{
  const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',chunk=>text+=chunk);
  const broker={submit:async value=>({id:value.id,text:'done'}),admit:value=>({receipt:{type:'receipt',id:value.id},result:Promise.resolve({text:'done'})})};
  const session=attachInferenceJsonlSession({readable:input,writable:output,broker});
  input.write('{"id":"spl');input.write('it"}\nno-json\n');input.end(JSON.stringify({type:'InferenceSubmission',delivery:'receipt-only',job:job('receipt')})+'\n');
  await session.inputEnded;await session.drain();
  const records=text.trim().split('\n').map(JSON.parse);
  assert.ok(records.some(r=>r.id==='split'&&r.text==='done'));
  assert.ok(records.some(r=>r.refusal?.type==='invalid-json-line'));
  assert.ok(records.some(r=>r.type==='receipt'&&r.id==='receipt'));
});

test('harness execution retains provider-local completion and cleanup',async t=>{
  const root=temporary(t),command=join(root,'provider.mjs');
  writeFileSync(command,'import {readFileSync} from "node:fs"; const packet=JSON.parse(readFileSync(process.argv[2],"utf8")); console.log(JSON.stringify({outcome:"completion",completion:{text:packet.messages[0].content},cost:{denomination:"local", "fuel-consumed":1}}));');
  const result=await invokeHarness({id:'harness',model:'test',command,cwd:root},job('harness'));
  assert.equal(result.text,'Review this work.');assert.equal(result.cost.denomination,'local');
});

test('harness startup failure settles and releases scheduler capacity during drain', async t => {
  const root = temporary(t), scheduler = createInferenceScheduler({ endpoints: [endpoint('broken', { type: 'harness', command: 'never-started.mjs', cwd: join(root, 'missing') })] });
  const first = scheduler.submit(job('startup-failure')), second = scheduler.submit(job('startup-failure-next'));
  await within(scheduler.close());
  const records = await Promise.all([first, second]);
  assert.ok(records.every((record) => record.refusal?.type === 'all-quoted-endpoints-refused'));
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().pending, 0);
  assert.equal(scheduler.snapshot().endpoints.broken.inFlight, 0);
});

test('harness cancellation kills a child that ignores SIGTERM after the grace period', async t => {
  const root = temporary(t), command = join(root, 'ignore-term.mjs'), ready = join(root, 'ready');
  writeFileSync(command, `import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`);
  const controller = new AbortController();
  const invocation = invokeHarness({ id: 'ignores-term', model: 'test', command, cwd: root }, job('abort-harness'), { signal: controller.signal, timeoutMs: 2000, timeoutGraceMs: 10 });
  const rejection = assert.rejects(within(invocation, 1500), /cancelled/);
  try {
    await within((async () => { while (!existsSync(ready)) await delay(5); })(), 1000);
    const pid = Number(readFileSync(ready, 'utf8'));
    controller.abort();
    await rejection;
    await within((async () => { for (;;) { try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); return; } await delay(5); } })(), 250);
  } finally { controller.abort(); }
});

test('a custom invocation deadline aborts the hung work, falls back, and drains capacity', async () => {
  let aborted = 0;
  const scheduler = createInferenceScheduler({ endpoints: [endpoint('a'), endpoint('b')] }, { concurrency: 1, timeoutMs: 15, attempts: 2, invoke: async (target, value, { signal }) => {
    if (target.id === 'a') return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(new Error('cancelled by deadline')); }, { once: true }));
    return { text: value.id };
  } });
  const record = await within(scheduler.submit(job('deadline')));
  assert.equal(record.endpoint, 'b');
  assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['refusal', 'completion']);
  assert.equal(record.attempts[0].retryable, true);
  assert.equal(aborted, 1);
  await within(scheduler.close());
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().endpoints.a.inFlight, 0);
});

test('cancelling during scheduler pacing releases its lease and lets close drain', async () => {
  let calls = 0;
  const controller = new AbortController();
  const scheduler = createInferenceScheduler({ endpoints: [endpoint('paced', { concurrency: 2, minIntervalMs: 100 })] }, { concurrency: 2, signal: controller.signal, invoke: async () => { calls++; return { text: 'settled' }; } });
  await scheduler.submit(job('first-paced'));
  const pending = scheduler.submit(job('cancelled-paced'));
  setTimeout(() => controller.abort(), 5);
  const result = await within(pending);
  assert.equal(result.refusal?.type, 'cancelled');
  await within(scheduler.close());
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().endpoints.paced.inFlight, 0);
  assert.equal(calls, 1);
});
