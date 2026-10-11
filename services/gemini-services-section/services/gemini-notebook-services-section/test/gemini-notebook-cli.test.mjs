import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotebookAdapter, refreshNotebookAuthentication } from '../src/gemini-notebook-cli.mjs';
import {notebookStoragePath,readStorageState} from '../src/gemini-notebook-client.mjs';

test('cloud home and configured profile select the same persisted credentials for native reads',async t=>{
 const home=await mkdtemp(join(tmpdir(),'notebook-home-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'profiles','cloud'),{recursive:true});
 await writeFile(join(home,'config.json'),JSON.stringify({default_profile:'cloud'}));
 const path=join(home,'profiles/cloud/storage_state.json'),state={cookies:[{name:'SID',value:'cloud-session'}]};
 await writeFile(path,JSON.stringify(state));
 assert.equal(notebookStoragePath({env:{NOTEBOOKLM_HOME:home}}),path);
 assert.deepEqual(readStorageState({env:{NOTEBOOKLM_HOME:home}}),state);
 assert.throws(()=>notebookStoragePath({env:{NOTEBOOKLM_HOME:home,NOTEBOOKLM_PROFILE:'../../other-account'}}),/Invalid Notebook profile/);
});

test('the native SDK refresh keeps rotated cookies encrypted and does not replace the checkpoint on refusal',async t=>{
 const home=await mkdtemp(join(tmpdir(),'notebook-refresh-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'profiles/default');await mkdir(dir,{recursive:true});
 const path=join(dir,'storage_state.json'),seed=JSON.stringify({cookies:[{name:'SID',value:'original'}]});
 await writeFile(path,seed);await writeFile(join(dir,'cloud_auth_seed.json'),seed);
 let calls=0;
 const env={NOTEBOOKLM_HOME:home,GEMINI_NOTEBOOK_CLI:'native-sdk',NOTEBOOKLM_AUTH_JSON:seed};
 const result=await refreshNotebookAuthentication({env,execFile:async(command,args,options)=>{
  calls++;assert.equal(command,'native-sdk');assert.deepEqual(args.slice(2),['auth','refresh','--quiet']);assert.equal(args[0],'--storage');assert.notEqual(args[1],path);assert.equal(options.env.NOTEBOOKLM_AUTH_JSON,undefined);
  assert.equal(await readFile(path,'utf8'),seed);await writeFile(args[1],JSON.stringify({cookies:[{name:'SID',value:'rotated'}]}));return {stdout:''};
 }});
 assert.equal(result.status,'refreshed');assert.equal(calls,1);
 const sealedPath=join(dir,'cloud_auth.enc.json'),sealed=await readFile(sealedPath,'utf8');assert.ok(!sealed.includes('rotated'));
 const {transferAuthProfile}=await import('@red-cup-engineering/computer-inference-engine/authentication/profile-transfer');
 const restored=transferAuthProfile({mode:'restore',seed,profilePath:join(home,'restored.json'),sealedPath,namespace:'youtube-notebook',validate:value=>Array.isArray(value.cookies)});
 assert.equal(restored.cookies[0].value,'rotated');
 const refused=await refreshNotebookAuthentication({env,execFile:async(_command,args)=>{await writeFile(args[1],JSON.stringify({cookies:[]}));throw new Error('Session refused');}});
 assert.equal(refused.status,'notebook-authentication-unavailable');assert.equal(await readFile(sealedPath,'utf8'),sealed);assert.equal(JSON.parse(await readFile(path,'utf8')).cookies[0].value,'rotated');
 assert.equal(refused.credentialRequired,true);
 assert.equal((await refreshNotebookAuthentication({env,execFile:()=>assert.fail('Unchanged refused credentials must make no SDK request')})).credentialRequired,true);
 await writeFile(path,JSON.stringify({cookies:[{name:'SID',value:'new-credential'}]}));
 assert.equal((await refreshNotebookAuthentication({env,execFile:async()=>({stdout:''})})).status,'refreshed');
 await assert.rejects(access(join(dir,'auth_refresh_refusal.json')),{code:'ENOENT'});
});


test('temporary refresh failures back off across turns and admit a changed credential immediately',async t=>{
 const home=await mkdtemp(join(tmpdir(),'notebook-refresh-backoff-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'profiles/default');await mkdir(dir,{recursive:true});
 const path=join(dir,'storage_state.json');await writeFile(path,JSON.stringify({cookies:[{name:'SID',value:'original'}]}));
 let now=Date.parse('2026-10-08T00:00:00Z'),calls=0;
 const options={env:{NOTEBOOKLM_HOME:home,GEMINI_NOTEBOOK_CLI:'native-sdk'},clock:()=>now,execFile:async()=>{calls++;throw Object.assign(new Error('transport timed out'),{killed:true});}};
 const first=await refreshNotebookAuthentication(options);assert.equal(first.retryAt,'2026-10-08T01:00:00.000Z');assert.equal(calls,1);
 assert.equal((await refreshNotebookAuthentication(options)).retryAt,first.retryAt);assert.equal(calls,1);
 now+=3600001;const second=await refreshNotebookAuthentication(options);assert.equal(second.retryAt,'2026-10-08T03:00:00.001Z');assert.equal(calls,2);
 await writeFile(path,JSON.stringify({cookies:[{name:'SID',value:'replaced'}]}));
 const restored=await refreshNotebookAuthentication({...options,execFile:async()=>{calls++;return {stdout:''};}});
 assert.equal(restored.status,'refreshed');assert.equal(calls,3);
});

const notebookId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const secondSource = '33333333-3333-4333-8333-333333333333';
const artifactId = '44444444-4444-4444-8444-444444444444';
const ready = { source: { id: sourceId, title: 'episode-report-sha256', status: 'ready' } };
const video = { notebook_id: notebookId, id: artifactId, type: 'Video', title: 'Example', status: 'completed' };
function adapter(replies) {
  const calls = [];
  const api = createNotebookAdapter({ env: { ...process.env, GEMINI_NOTEBOOK_CLI: 'test-gemini-notebook' }, execFile: async (command, args, options) => {
    if(args[0]==='-c')throw new Error('Raw SDK metadata is unavailable in this CLI fixture');
    calls.push({ command, args, options });
    assert.ok(replies.length, `Unexpected call: ${args.join(' ')}`);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { stdout: JSON.stringify(typeof reply === 'function' ? await reply(args) : reply) };
  } });
  return { ...api, calls };
}

test('create returns a durable notebook ID without switching the active notebook', async () => {
  const api = adapter([{ notebook: { id: notebookId, title: '-A title' } }]);
  assert.deepEqual(await api.createNotebook('-A title'), { notebookId, title: '-A title' });
  assert.deepEqual(api.calls[0].args, ['create', '--json', '--', '-A title']);
});

test('ensureSource recovers an already uploaded report by exact title and checks readiness', async () => {
  const api = adapter([{ sources: [{ id: sourceId, title: ready.source.title }, { id: secondSource, title: 'another episode' }] }, ready]);
  const result = await api.ensureSource({ notebookId, title: ready.source.title, reportPath: '/not-needed-on-resume' });
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.ready, true);
  assert.equal(result.created, false);
  assert.deepEqual(api.calls.map(c => c.args.slice(0, 2)), [['source', 'list'], ['source', 'get']]);
});

test('ensureSource uploads a report once, then reports processing rather than inventing readiness', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'notebook-source-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reportPath = join(dir, 'report.md');
  await writeFile(reportPath, '# Evidence\nA cited report.');
  const api = adapter([{ sources: [] }, { source: { id: sourceId } }, { source: { ...ready.source, status: 'processing' } }]);
  const result = await api.ensureSource({ notebookId, reportPath, title: ready.source.title, onCheckpoint: async () => {} });
  assert.equal(result.ready, false);
  assert.equal(result.created, true);
  assert.ok(api.calls[1].args.includes(reportPath));
  assert.ok(api.calls[1].args.includes('--type'));
});

test('duplicate report titles refuse ambiguous recovery', async () => {
  const api = adapter([{ sources: [ready.source, { ...ready.source, id: secondSource }] }]);
  await assert.rejects(api.ensureSource({ notebookId, title: ready.source.title }), /Multiple Gemini Notebook sources/);
  assert.equal(api.calls.length, 1);
});

test('source upload refusal stays ambiguous because title assignment follows upload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'notebook-source-refusal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reportPath = join(dir, 'report.md');
  await writeFile(reportPath, '# Research report');
  const api = adapter([{ sources: [] }, { error: true, code: 'AUTH_ERROR', message: 'Title request refused' }]);
  await assert.rejects(api.ensureSource({ notebookId, reportPath, title: ready.source.title, onCheckpoint: async () => {} }), error => error.ambiguous === true && error.code === 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED');
  assert.equal(api.calls.length, 2);
});

test('a failed title assignment recovers the single new filename source without another upload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'notebook-orphan-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reportPath = join(dir, 'report.md');
  await writeFile(reportPath, '# Source-backed report');
  let checkpoint;
  const original = { id: secondSource, title: 'report.md' };
  const api = adapter([
    { sources: [original] }, async () => {
      assert.deepEqual(checkpoint.baselineSourceIds, [secondSource]);
      assert.equal(checkpoint.originalFilename, 'report.md');
      throw new Error('upload completed, title request lost');
    },
    { sources: [original, { id: sourceId, title: 'report.md' }] },
    async args => {
      assert.equal(checkpoint.sourceId, sourceId);
      assert.equal(checkpoint.created, true);
      assert.equal(args[1], 'rename'); assert.equal(args[2], sourceId);
      return { status: 'renamed' };
    }, ready,
  ]);
  const request = { notebookId, reportPath, title: ready.source.title, onCheckpoint: async value => { checkpoint = value; } };
  await assert.rejects(api.ensureSource(request), /title request lost/);
  const result = await api.ensureSource({ ...request, checkpoint });
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.created, true);
  assert.equal(api.calls.filter(call => call.args[1] === 'add').length, 1);
});

test('unresolved or non-unique orphan uploads never silently add another source', async () => {
  const checkpoint = { notebookId, title: ready.source.title, originalFilename: 'report.md', baselineSourceIds: [], started: true };
  for (const sources of [[], [{ id: sourceId, title: 'report.md' }, { id: secondSource, title: 'report.md' }]]) {
    const api = adapter([{ sources }]);
    await assert.rejects(api.ensureSource({ notebookId, title: ready.source.title, checkpoint, onCheckpoint: async () => {} }), error => error.ambiguous === true);
    assert.equal(api.calls.length, 1);
  }
});

test('source retirement deletes only exact tracked IDs and already absent IDs are idempotent', async () => {
  const original = { id: secondSource, title: 'Original notebook source' };
  const api = adapter([{ sources: [original, ready.source] }, { status: 'deleted' }, { sources: [original] }, { sources: [original] }]);
  const request = { notebookId, sourceIds: [sourceId, sourceId] };
  assert.deepEqual((await api.removeSources(request)).removedSourceIds, [sourceId]);
  assert.deepEqual((await api.removeSources(request)).removedSourceIds, [sourceId]);
  const deletes = api.calls.filter(call => call.args[1] === 'delete');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].args[2], sourceId);
  assert.ok(deletes[0].args.includes('--yes'));
});

test('cinematic generation selects exactly the supplied ready report IDs and returns immediately', async () => {
  const api = adapter([ready, { source: { id: secondSource, status: 'ready' } }, { task_id: artifactId, status: 'pending' }]);
  const result = await api.generateVideo({ notebookId, sourceIds: [sourceId, secondSource], format: 'cinematic', style: 'classic', prompt: '-A documentary', title: 'Math' });
  assert.equal(result.artifactId, artifactId);
  assert.equal(result.status, 'pending');
  const args = api.calls.at(-1).args;
  assert.deepEqual(args.flatMap((v, i) => v === '-s' ? [args[i + 1]] : []), [sourceId, secondSource]);
  assert.ok(args.includes('--no-wait'));
  assert.equal(args[args.indexOf('--retry') + 1], '0');
  assert.equal(args.includes('--style'), false);
  assert.equal(args.filter(v => v === '--json').length, 1);
  assert.equal(args.at(-2), '--');
  assert.equal(api.calls.at(-1).options.timeout, 45_000);
});

test('generation refuses implicit all-notebook scope or unready sources before submission', async () => {
  const api = adapter([{ source: { ...ready.source, status: 'preparing' } }]);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [], prompt: 'x' }), /explicitly select/);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), { code: 'GEMINI_NOTEBOOK_SOURCE_NOT_READY' });
  assert.equal(api.calls.length, 1);
});

test('generation timeout is explicitly ambiguous and is never retried', async () => {
  const api = adapter([ready, new Error('Command timed out')]);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => error.ambiguous === true && error.code === 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED');
  assert.equal(api.calls.length, 2);
});

test('structured video quota response remains uncertain even with a retry delay', async () => {
  const refusal = Object.assign(new Error('CLI exited 1'), { code: 1,
    stdout: JSON.stringify({ error: true, code: 'RATE_LIMITED', message: 'Video generation rate limited by Google.', retry_after: 3600 }) });
  const api = adapter([ready, refusal]);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => {
    assert.equal(error.ambiguous, true);
    assert.equal(error.retryable, false);
    assert.equal(error.code, 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED');
    assert.equal(error.providerCode, 'RATE_LIMITED');
    assert.equal(error.retryAfterSeconds, undefined);
    return true;
  });
  assert.equal(api.calls.length, 2);
});

test('installed 0.7.3 video quota response preserves uncertainty and its diagnostic detail', async () => {
  // This exact live response coincided with a newly created video artifact.
  // cli/error_handler.py omits task_id, so never automatically retry it.
  const stderr = '11:26:27 ERROR [notebooklm._rpc_executor] [req=3cf99134] RPC CREATE_ARTIFACT failed after 0.942s: RateLimitError rpc_code=USER_DISPLAYABLE_ERROR';
  const refusal = Object.assign(new Error('Command failed'), { code: 1, stderr,
    stdout: JSON.stringify({ error: true, code: 'RATE_LIMITED', message: 'Error: Rate limited.' }, null, 2) });
  const api = adapter([ready, refusal]);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => {
    assert.equal(error.ambiguous, true);
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, 'RATE_LIMITED');
    assert.equal(error.message, 'Gemini Notebook generate video failed: [RATE_LIMITED] Error: Rate limited.');
    return true;
  });
  assert.equal(api.calls.length, 2);
  const uncertain = adapter([ready, Object.assign(new Error('Command failed'), { code: 1, stderr })]);
  await assert.rejects(uncertain.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => error.ambiguous === true);
});

test('explicit authentication and validation refusal have known no-submission outcomes', async () => {
  for (const code of ['AUTH_ERROR', 'VALIDATION_ERROR', 'CONFIG_ERROR']) {
    const api = adapter([ready, { error: true, code, message: 'Request refused' }]);
    await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => error.ambiguous === false && error.retryable === false && error.providerCode === code);
  }
  const api = adapter([]);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [], prompt: 'x' }), error => error.ambiguous === false);
});

test('unstructured quota text, network failure, and errors carrying an artifact ID remain ambiguous', async () => {
  for (const refusal of [
    Object.assign(new Error('quota maybe exceeded'), { stdout: 'quota maybe exceeded' }),
    { error: true, code: 'NETWORK_ERROR', message: 'Connection closed' },
    { error: true, code: 'RATE_LIMITED', message: 'Later request refused', task_id: artifactId },
    Object.assign(new Error('killed after output'), { killed: true, signal: 'SIGKILL', stdout: JSON.stringify({ error: true, code: 'RATE_LIMITED' }) }),
  ]) {
    const api = adapter([ready, refusal]);
    await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => error.ambiguous === true && error.code === 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED');
    assert.equal(api.calls.length, 2);
  }
});

test('failure to start the executable is known not to have submitted a notebook', async () => {
  const api = adapter([Object.assign(new Error('executable missing'), { code: 'ENOENT' })]);
  await assert.rejects(api.createNotebook('Example'), error => error.ambiguous === false && error.code === 'GEMINI_NOTEBOOK_REQUEST_REJECTED');
});

test('missing provider ID after submission is also ambiguous', async () => {
  const api = adapter([ready, { status: 'pending' }]);
  await assert.rejects(api.generateVideo({ notebookId, sourceIds: [sourceId], prompt: 'x' }), error => error.ambiguous === true);
});

test('poll preserves failed and rendering provider status and rejects mismatched artifact identity', async () => {
  const api = adapter([{ ...video, status: 'failed' }, { ...video, status: 'in_progress' }, { ...video, id: secondSource }]);
  assert.equal((await api.getVideo({ notebookId, artifactId })).status, 'failed');
  assert.equal((await api.getVideo({ notebookId, artifactId })).status, 'in_progress');
  await assert.rejects(api.getVideo({ notebookId, artifactId }), /different artifact/);
});

test('lists video candidates for explicit adoption without matching generated titles', async () => {
  const api = adapter([{ notebook_id: notebookId, artifacts: [
    { ...video, title: 'A provider-chosen title', status: 'in_progress', created_at: '2026-09-20T10:00:00Z' },
    { ...video, id: secondSource, title: 'A provider-chosen title', status: 'completed' },
  ] }]);
  const videos = await api.listVideos({ notebookId });
  assert.equal(videos.length, 2);
  assert.deepEqual(videos[0], { notebookId, artifactId, title: 'A provider-chosen title', status: 'in_progress', createdAt: '2026-09-20T10:00:00Z' });
  assert.equal(videos[1].artifactId, secondSource);
  assert.deepEqual(api.calls[0].args, ['artifact', 'list', '-n', notebookId, '--type', 'video', '--json']);
});

test('download targets exact artifact and atomically places bytes from a streamed file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'notebook-video-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'video.mp4');
  const bytes = Buffer.from('a small stand-in for streamed mp4 bytes');
  const api = adapter([video, async args => {
    assert.equal(args[args.indexOf('-a') + 1], artifactId);
    await writeFile(args[2], bytes);
    return { status: 'downloaded', artifact: { id: artifactId } };
  }]);
  assert.equal((await api.downloadVideo({ notebookId, artifactId, outputPath })).bytes, bytes.length);
  assert.deepEqual(await readFile(outputPath), bytes);
  await assert.rejects(access(`${outputPath}.${artifactId}.part`));
});

test('download errors preserve the existing finished file and remove partial output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'notebook-failed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outputPath = join(dir, 'video.mp4');
  await writeFile(outputPath, 'old complete file');
  const api = adapter([video, async args => {
    await writeFile(args[2], 'partial');
    return { error: 'connection interrupted' };
  }]);
  await assert.rejects(api.downloadVideo({ notebookId, artifactId, outputPath }), /connection interrupted/);
  assert.equal(await readFile(outputPath, 'utf8'), 'old complete file');
  await assert.rejects(access(`${outputPath}.${artifactId}.part`));
});


test('SDK exit 1 with an exact pending or failed artifact remains a provider observation',async()=>{
 for(const status of ['pending','in_progress','failed']){
  const api=adapter([Object.assign(new Error('SDK nonterminal exit'),{code:1,stdout:JSON.stringify({...video,status})})]);
  assert.equal((await api.getVideo({notebookId,artifactId})).status,status);assert.equal(api.calls.length,1);
 }
});

test('a wrong artifact identity, timeout or explicit error cannot be accepted as a nonzero observation',async()=>{
 for(const reply of [
  Object.assign(new Error('wrong identity'),{code:1,stdout:JSON.stringify({...video,id:secondSource,status:'pending'})}),
  Object.assign(new Error('terminated'),{code:1,killed:true,stdout:JSON.stringify({...video,status:'pending'})}),
  Object.assign(new Error('refused'),{code:1,stdout:JSON.stringify({...video,status:'pending',error:true})}),
 ])await assert.rejects(adapter([reply]).getVideo({notebookId,artifactId}),{code:'GEMINI_NOTEBOOK_COMMAND_FAILED'});
});
