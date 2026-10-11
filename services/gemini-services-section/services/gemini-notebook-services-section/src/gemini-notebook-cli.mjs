/**
 * The Gemini Notebook command line (notebooklm-py), run one way for every caller.
 *
 * geminiNotebookCommand resolves the executable once: GEMINI_NOTEBOOK_CLI, then
 * GEMINI_NOTEBOOK_PYTHON (run as `python -m notebooklm`), then the user install at
 * ~/.notebooklm/venv, then this section's .venv, then `python3 -m notebooklm`.
 * runGeminiNotebookSync and runGeminiNotebook run one command and return its exit,
 * output and parsed JSON; createNotebookAdapter is the operation set with
 * explicit mutation semantics: a creation, upload or generation whose outcome
 * is unknown is marked ambiguous so a caller reconciles instead of resubmitting.
 */
import { execFile as execFileCallback, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { stat, rename, rm, mkdir, mkdtemp, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFileCallback);
export const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** [executable, ...prefix arguments] for one Gemini Notebook invocation. */
export function geminiNotebookCommand({ env = process.env, root = SECTION_ROOT } = {}) {
  if (env.GEMINI_NOTEBOOK_CLI) return [env.GEMINI_NOTEBOOK_CLI];
  if (env.GEMINI_NOTEBOOK_PYTHON) return [env.GEMINI_NOTEBOOK_PYTHON, '-m', 'notebooklm'];
  const installed = join(homedir(), '.notebooklm', 'venv', 'bin', 'notebooklm');
  if (existsSync(installed)) return [installed];
  const local = join(root, '.venv', 'bin', 'python3');
  return [existsSync(local) ? local : 'python3', '-m', 'notebooklm'];
}

export function geminiNotebookPython({ env = process.env, root = SECTION_ROOT } = {}) {
  if (env.GEMINI_NOTEBOOK_PYTHON) return env.GEMINI_NOTEBOOK_PYTHON;
  if (env.GEMINI_NOTEBOOK_CLI) {
    try {
      const line = readFileSync(env.GEMINI_NOTEBOOK_CLI, 'utf8').split(/\r?\n/, 1)[0];
      const match = line.match(/^#!\s*(\S+)(?:\s+(\S+))?/);
      if (match) return match[1] === '/usr/bin/env' ? (match[2] || 'python3') : match[1];
    } catch { /* Use the normal installed interpreter below. */ }
  }
  const installed = join(homedir(), '.notebooklm', 'venv', 'bin', 'python');
  if (existsSync(installed)) return installed;
  const local = join(root, '.venv', 'bin', 'python');
  return existsSync(local) ? local : 'python3';
}

const RAW_VIDEO_LIST = String.raw`import asyncio,json,sys
from notebooklm import NotebookLMClient
from notebooklm.types import ArtifactType
async def main():
    path = sys.argv[2] or None
    async with NotebookLMClient.from_storage(path=path, profile=None) as client:
        artifacts, rows, _mind_maps = await client.artifacts._list_for_download(sys.argv[1], ArtifactType.VIDEO)
        created = {artifact.id: artifact.created_at.isoformat() if artifact.created_at else None for artifact in artifacts}
        print(json.dumps({"rows": rows, "createdAt": created}, separators=(",", ":"), default=str))
asyncio.run(main())`;

/** Fetch raw video records so reconciliation can compare the provider's exact submission inputs. */
export async function rawNotebookVideos(notebookId, { env = process.env, root = SECTION_ROOT, storagePath = null, execFile = execute, timeout = 45_000 } = {}) {
  const refusal=authenticationError({env,storagePath});if(refusal)throw refusal;
  const python = geminiNotebookPython({ env, root });
  const { stdout } = await execFile(python, ['-c', RAW_VIDEO_LIST, notebookId, storagePath || ''], { timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result.rows) || !result.createdAt || typeof result.createdAt !== 'object') throw new Error('Gemini Notebook raw artifact listing is not an array');
  return result.rows.filter(row => Array.isArray(row) && typeof row[0] === 'string').map(row => {
    const generation = row?.[8]?.[2];
    const sourceValue = generation?.[0];
    const sourceIds = Array.isArray(sourceValue?.[0]) ? sourceValue[0] : sourceValue;
    return { artifactId: row[0], title: row[1], statusId: row[4], createdAt: result.createdAt[row[0]] ?? null, sourceIds: Array.isArray(sourceIds) ? sourceIds : null,
      language: typeof generation?.[1] === 'string' ? generation[1] : null,
      prompt: typeof generation?.[2] === 'string' ? generation[2] : null,
      formatId: Number.isInteger(generation?.[4]) ? generation[4] : null };
  });
}

import {notebookLanguage} from './language.mjs';
import {openGeminiNotebook,readStorageState,notebookStoragePath} from './gemini-notebook-client.mjs';

function commandArguments(args, { json = true, storagePath = null } = {}) {
  return [...(storagePath ? ['--storage', storagePath] : []), ...args, ...(json && !args.includes('--json') ? ['--json'] : [])];
}
function parsed(stdout) { try { return JSON.parse(stdout); } catch { return undefined; } }

/** Run one Gemini Notebook command synchronously: { status, signal, errorCode, stdout, stderr, value }. */
export function runGeminiNotebookSync(args, { json = true, storagePath = null, timeout, maxBuffer = 64 * 1024 * 1024, env = process.env, root = SECTION_ROOT } = {}) {
  const refusal=authenticationError({env,storagePath});
  if(refusal)return {status:1,signal:null,errorCode:refusal.code,stdout:JSON.stringify(refusal.value),stderr:refusal.message,value:refusal.value};
  const [command, ...prefix] = geminiNotebookCommand({ env, root });
  const run = spawnSync(command, [...prefix, ...commandArguments(args, { json, storagePath })], { cwd: root, encoding: 'utf8', env, maxBuffer, ...(timeout ? { timeout } : {}) });
  return { status: run.status, signal: run.signal, errorCode: run.error?.code ?? null, stdout: run.stdout ?? '', stderr: run.stderr ?? '', value: parsed(run.stdout ?? '') };
}

/** Run one Gemini Notebook command and resolve its parsed JSON; rejects with the process failure (stdout, stderr, code, killed, signal). */
export async function runGeminiNotebook(args, { json = true, storagePath = null, timeout = 45_000, maxBuffer = 2 * 1024 * 1024, env = process.env, root = SECTION_ROOT, execFile = execute } = {}) {
  const refusal=authenticationError({env,storagePath});if(refusal)throw refusal;
  const [command, ...prefix] = geminiNotebookCommand({ env, root });
  const { stdout } = await execFile(command, [...prefix, ...commandArguments(args, { json, storagePath })], { timeout, killSignal: 'SIGKILL', maxBuffer, encoding: 'utf8', env });
  return json ? JSON.parse(stdout) : stdout;
}

/** Every SDK entry point honors the same retained credential refusal. */
function authenticationState({env=process.env,storagePath=null,clock=Date.now}={}) {
  const profilePath=notebookStoragePath({env,storagePath});
  if(!existsSync(profilePath)&&!(!storagePath&&env.NOTEBOOKLM_AUTH_JSON))return {blocked:{status:'notebook-authentication-unavailable',reason:'profile-missing',credentialRequired:true}};
  const original=!storagePath&&env.NOTEBOOKLM_AUTH_JSON?env.NOTEBOOKLM_AUTH_JSON:readFileSync(profilePath,'utf8');
  const fingerprint=createHash('sha256').update(JSON.stringify([original,...['cloud_auth_seed.json','cloud_auth.enc.json'].map(name=>{const path=join(dirname(profilePath),name);return existsSync(path)?readFileSync(path,'utf8'):null;})])).digest('hex');
  const refusalPath=join(dirname(profilePath),'auth_refresh_refusal.json');let retained;
  if(existsSync(refusalPath)) {
    try {retained=JSON.parse(readFileSync(refusalPath,'utf8'));}
    catch {return {blocked:{status:'notebook-authentication-unavailable',reason:'invalid-retained-refusal'}};}
    if(retained.fingerprint===fingerprint&&(retained.credentialRequired||clock()<Date.parse(retained.retryAt)))return {fingerprint,retained,blocked:{status:'notebook-authentication-unavailable',reason:retained.reason,...(retained.credentialRequired?{credentialRequired:true}:{retryAt:retained.retryAt})}};
  }
  return {fingerprint,retained};
}
function authenticationError(options) {
  const {blocked}=authenticationState(options);
  return blocked?Object.assign(new Error('Notebook authentication pending: '+blocked.reason),{code:'NOTEBOOK_AUTHENTICATION_PENDING',value:blocked}):null;
}

/** Renew the saved SDK session once and retain its refreshed encrypted checkpoint.
 * A refused credential waits for replacement; transient failures back off. Renewal never
 * opens a login browser or replaces a session with an unverified backup.
 */
export async function refreshNotebookAuthentication({env=process.env,storagePath=null,execFile=execute,timeout=45_000,clock=Date.now}={}) {
  const profilePath=notebookStoragePath({env,storagePath});
  if(!existsSync(profilePath))return {status:'notebook-authentication-unavailable',reason:'profile-missing'};
  const original=readFileSync(profilePath,'utf8');
  const seedPath=join(dirname(profilePath),'cloud_auth_seed.json'),sealedPath=join(dirname(profilePath),'cloud_auth.enc.json');
  const refusalPath=join(dirname(profilePath),'auth_refresh_refusal.json');
  const {fingerprint,retained,blocked}=authenticationState({env,storagePath,clock});
  if(blocked)return blocked;
  const directory=await mkdtemp(join(dirname(profilePath),'.auth-refresh-'));
  const candidate=join(directory,'storage_state.json');
  const sessionEnv={...env};delete sessionEnv.NOTEBOOKLM_AUTH_JSON;
  const {transferAuthProfile}=await import('@red-cup-engineering/computer-inference-engine/authentication/profile-transfer');
  const {writeFileAtomic}=await import('@red-cup-engineering/computer-system-engine/filesystem');
  const unavailable=(reason,error)=>{
    const diagnostic=[error?.message,error?.stderr,error?.stdout].filter(Boolean).join(' ');
    const credentialRequired=!error?.killed&&/csrf|not authenticated|unauthorized|sign[ -]?in|log[ -]?in|session refused|(?:authentication|session|cookies?).*(?:expired|invalid|refused)/iu.test(diagnostic);
    const failures=retained?.fingerprint===fingerprint?(retained.failures??0)+1:1;
    const retryAt=new Date(clock()+Math.min(24,2**Math.min(failures-1,5))*3600000).toISOString();
    writeFileAtomic(refusalPath,JSON.stringify({fingerprint,reason,failures,credentialRequired,observedAt:new Date(clock()).toISOString(),...(credentialRequired?{}:{retryAt})})+'\n',{mode:0o600});
    return {status:'notebook-authentication-unavailable',reason,...(credentialRequired?{credentialRequired:true}:{retryAt})};
  };
  const valid=value=>Array.isArray(value.cookies)&&value.cookies.length>0;
  const renew=()=>runGeminiNotebook(['auth','refresh','--quiet'],{json:false,storagePath:candidate,env:sessionEnv,execFile,timeout});
  const cookies=value=>JSON.stringify(value.cookies.map(({name,domain,path,value})=>({name,domain,path,value})).sort((a,b)=>(a.domain+a.path+a.name).localeCompare(b.domain+b.path+b.name)));
  let recovered=false;
  try {
    writeFileAtomic(candidate,original,{mode:0o600});
    try {await renew();}
    catch(error) {
      // Only a different, previously verified checkpoint can justify one normal SDK recovery.
      if(!existsSync(seedPath)||!existsSync(sealedPath))return unavailable(error.killed?'refresh-timeout':'refresh-failed',error);
      let prior;
      try {prior=transferAuthProfile({mode:'restore',seed:readFileSync(seedPath,'utf8'),profilePath:candidate,sealedPath,namespace:'youtube-notebook',validate:valid});}
      catch {return unavailable('checkpoint-unavailable',error);}
      if(cookies(prior)===cookies(JSON.parse(original)))return unavailable('refresh-failed',error);
      try {await renew();recovered=true;}
      catch(recoveryError) {return unavailable('checkpoint-refresh-failed',recoveryError);}
    }
    const refreshed=JSON.parse(readFileSync(candidate,'utf8'));
    if(!valid(refreshed))return unavailable('invalid-refreshed-profile');
    if(!existsSync(seedPath))writeFileAtomic(seedPath,original,{mode:0o600});
    const sealedCandidate=join(directory,'cloud_auth.enc.json');
    transferAuthProfile({mode:'save',seed:readFileSync(seedPath,'utf8'),profilePath:candidate,sealedPath:sealedCandidate,namespace:'youtube-notebook',validate:valid});
    await chmod(candidate,0o600);
    await rename(candidate,profilePath);
    await rename(sealedCandidate,sealedPath);
    await rm(refusalPath,{force:true});
    return {status:'refreshed',...(recovered?{recovered:true}:{})};
  }finally {await rm(directory,{recursive:true,force:true});}
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message) {
  return Object.assign(new Error(message), { ambiguous: false, retryable: false, code: 'GEMINI_NOTEBOOK_REQUEST_REJECTED' });
}
function id(value, label) {
  if (typeof value !== 'string' || !uuid.test(value)) throw invalid(`${label} must be a complete Gemini Notebook UUID`);
  return value;
}
function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${label} is required`);
  return value;
}
function videoStatus(value) {
  if (!['pending', 'in_progress', 'completed', 'failed'].includes(value)) {
    throw new Error(`Unknown Gemini Notebook artifact status: ${value}`);
  }
  return value;
}

/** The Gemini Notebook operation set. Inject execFile(command, args, options) for tests. */
export function createNotebookAdapter({ execFile = execute, timeoutMs = 45_000, downloadTimeoutMs = 300_000, env = process.env, storagePath = null } = {}) {
  async function call(args, { mutation = false, timeout = timeoutMs, acceptObservation = null } = {}) {
    try {
      const result = await runGeminiNotebook(args, { timeout, env, storagePath, execFile });
      if (result.error) {
        throw Object.assign(new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result)), { response: result });
      }
      return result;
    } catch (cause) {
      if(cause.code==='NOTEBOOK_AUTHENTICATION_PENDING')throw Object.assign(cause,{ambiguous:false});
      let response = cause.response;
      if (!response && cause.stdout) { try { response = JSON.parse(cause.stdout); } catch { /* Unknown output never proves rejection. */ } }
      // The SDK's artifact get exits 1 for pending and failed artifacts. Its
      // exact, well-formed observation is authoritative; an exit is not a provider failure.
      if (!mutation && cause.code === 1 && !cause.killed && !cause.signal && !response?.error && acceptObservation?.(response)) return response;
      // Artifact creation can return RATE_LIMITED while still creating an artifact
      // (observed with 0.7.3). Its missing task_id does not prove rejection.
      // Preserve the checkpoint until exact artifact inputs are reconciled.
      // source add is multi-step (upload then title): keep its errors ambiguous.
      const singleCreation = args[0] === 'create' || (args[0] === 'generate' && args[1] === 'video');
      const rejectionCodes = new Set(['RATE_LIMITED', 'AUTH_ERROR', 'VALIDATION_ERROR', 'CONFIG_ERROR', 'NOTEBOOK_LIMIT']);
      const rejected = singleCreation && !cause.killed && !cause.signal && response?.error === true
        && rejectionCodes.has(response.code) && !response.task_id && !response.artifact_id
        && !(args[0] === 'generate' && response.code === 'RATE_LIMITED');
      const notStarted = ['ENOENT', 'EACCES', 'ENOEXEC'].includes(cause.code);
      // The CLI logs RPC diagnostics to stderr even when stdout carries its
      // authoritative JSON refusal. Preserve that code and message for operators.
      const providerDetail = typeof response?.message === 'string' && response.message.trim()
        ? `${response.code ? `[${response.code}] ` : ''}${response.message.trim()}` : null;
      const detail = providerDetail || cause.stderr?.trim() || cause.stdout?.trim() || cause.message;
      const error = new Error(`Gemini Notebook ${args.slice(0, 2).join(' ')} failed: ${detail}`, { cause });
      // A timed-out create may already exist remotely. The orchestrator must
      // preserve its submission checkpoint and reconcile, never resubmit blind.
      error.ambiguous = mutation && !rejected && !notStarted;
      error.code = rejected || notStarted ? 'GEMINI_NOTEBOOK_REQUEST_REJECTED' : mutation ? 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED' : 'GEMINI_NOTEBOOK_COMMAND_FAILED';
      if (response?.code) error.providerCode = response.code;
      error.retryable = rejected && response.code === 'RATE_LIMITED';
      if (rejected && Number.isFinite(response.retry_after) && response.retry_after > 0) error.retryAfterSeconds = response.retry_after;
      throw error;
    }
  }
  function returnedId(value, label) {
    try { return id(value, label); }
    catch (error) { error.ambiguous = true; error.code = 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED'; throw error; }
  }
  async function sourceStatus(notebookId, sourceId) {
    const result = await call(['source', 'get', id(sourceId, 'sourceId'), '-n', notebookId]);
    const source = result.source;
    if (!source || source.id !== sourceId) throw invalid('Gemini Notebook returned a different source');
    if (source.status === 'error') {
      throw invalid(`Gemini Notebook source ${sourceId} failed processing`);
    }
    if (!['ready', 'processing', 'preparing'].includes(source.status)) throw invalid(`Unknown Gemini Notebook source status: ${source.status}`);
    return { sourceId, title: source.title, status: source.status === 'ready' ? 'ready' : 'processing', ready: source.status === 'ready' };
  }
  async function createNotebook(title) {
    required(title, 'title');
    const result = await call(['create', '--json', '--', title], { mutation: true });
    return { notebookId: returnedId(result.notebook?.id, 'returned notebookId'), title: result.notebook.title };
  }
  async function ensureSource({ notebookId, reportPath, title, checkpoint = {}, onCheckpoint }) {
    id(notebookId, 'notebookId'); required(title, 'title');
    const state = structuredClone(checkpoint);
    if ((state.notebookId && state.notebookId !== notebookId) || (state.title && state.title !== title)) throw invalid('Source checkpoint belongs to a different notebook or report');
    const save = async () => {
      if (typeof onCheckpoint !== 'function') throw invalid('Source upload requires an onCheckpoint persistence callback');
      await onCheckpoint(structuredClone(state));
    };
    const uncertain = message => Object.assign(new Error(message), { ambiguous: true, code: 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED' });
    const listed = await call(['source', 'list', '-n', notebookId]);
    if (!Array.isArray(listed.sources)) throw new Error('Gemini Notebook source list is missing sources');
    const matches = listed.sources.filter(source => source.title === title);
    if (matches.length > 1) throw new Error(`Multiple Gemini Notebook sources have the unique report title ${title}`);
    let source = state.sourceId ? listed.sources.find(source => source.id === state.sourceId) : matches[0];
    if (state.sourceId && !source) throw uncertain('Previously acknowledged report source is absent; reconcile before uploading again');
    let created = state.created === true;
    if (source && state.started && Array.isArray(state.baselineSourceIds)) created = !state.baselineSourceIds.includes(source.id);
    if (!source && state.started) {
      if (!Array.isArray(state.baselineSourceIds) || !state.originalFilename) throw uncertain('Source upload outcome lacks a recovery snapshot; reconcile before retry');
      const orphans = listed.sources.filter(source => !state.baselineSourceIds.includes(source.id) && source.title === state.originalFilename);
      if (orphans.length !== 1) throw uncertain(`Source upload outcome is unknown (${orphans.length} matching new files); reconcile before retry`);
      source = orphans[0]; created = true;
    }
    if (!source) {
      const path = resolve(required(reportPath, 'reportPath'));
      const file = await stat(path);
      if (!file.isFile() || file.size === 0) throw new Error('reportPath must be a nonempty file');
      Object.assign(state, { notebookId, title, originalFilename: basename(path), baselineSourceIds: listed.sources.map(source => source.id), started: true });
      await save();
      let result;
      try {
        result = await call(['source', 'add', path, '-n', notebookId, '--type', 'file', '--title', title, '--request-timeout', '30'], { mutation: true });
      } catch (error) {
        if (error.ambiguous === false) { state.started = false; await save(); }
        throw error;
      }
      source = result.source;
      returnedId(source?.id, 'returned sourceId');
      created = true;
    }
    if (state.started) {
      Object.assign(state, { sourceId: source.id, created });
      await save();
    }
    if (created && source.title && source.title !== title) {
      // The file upload can succeed while its subsequent title RPC fails.
      // Rename the acknowledged/recovered ID, never upload another file.
      await call(['source', 'rename', source.id, '-n', notebookId, '--json', '--', title], { mutation: true });
    }
    // Addition merely acknowledges receipt; check actual provider readiness.
    return { notebookId, ...await sourceStatus(notebookId, source.id), created, checkpoint: state };
  }
  async function removeSources({ notebookId, sourceIds }) {
    id(notebookId, 'notebookId');
    if (!Array.isArray(sourceIds)) throw invalid('sourceIds must explicitly list the owned sources to remove');
    const requested = [...new Set(sourceIds.map(sourceId => id(sourceId, 'sourceId')))];
    if (!requested.length) return { notebookId, removedSourceIds: [] };
    const listed = await call(['source', 'list', '-n', notebookId]);
    if (!Array.isArray(listed.sources)) throw new Error('Gemini Notebook source list is missing sources');
    const present = new Set(listed.sources.map(source => source.id));
    for (const sourceId of requested) if (present.has(sourceId)) {
      await call(['source', 'delete', sourceId, '-n', notebookId, '--yes'], { mutation: true });
    }
    if (requested.some(sourceId => present.has(sourceId))) {
      const verified = await call(['source', 'list', '-n', notebookId]);
      if (!Array.isArray(verified.sources) || verified.sources.some(source => requested.includes(source.id))) throw new Error('Gemini Notebook did not confirm removal of the requested sources');
    }
    return { notebookId, removedSourceIds: requested };
  }
  async function generateVideo({ notebookId, sourceIds, format = 'explainer', style = 'auto', language = 'en', prompt, title }) {
    id(notebookId, 'notebookId'); required(prompt, 'prompt');
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) throw invalid('sourceIds must explicitly select at least one report');
    if (new Set(sourceIds).size !== sourceIds.length) throw invalid('sourceIds must not contain duplicates');
    if (!['explainer', 'brief', 'cinematic', 'short'].includes(format)) throw invalid(`Unsupported video format: ${format}`);
    if (!['auto', 'classic', 'whiteboard', 'kawaii', 'anime', 'watercolor', 'retro-print', 'heritage', 'paper-craft'].includes(style)) throw invalid(`Unsupported video style: ${style}`);
    required(language, 'language');
    for (const sourceId of sourceIds) {
      const source = await sourceStatus(notebookId, id(sourceId, 'sourceId'));
      if (!source.ready) {
        const error = invalid(`Gemini Notebook source ${sourceId} is not ready`);
        error.code = 'GEMINI_NOTEBOOK_SOURCE_NOT_READY'; error.retryable = true; throw error;
      }
    }
    if (format === 'short') {
      const client=await openGeminiNotebook({readState:()=>readStorageState({env,storagePath})});
      const artifact=await client.createArtifact(notebookId,{kind:'video',sourceIds,language,instructions:title?`Title: ${title}\n\n${prompt}`:prompt,options:{format:'short'}});
      return {notebookId,artifactId:returnedId(artifact.artifactId,'returned artifactId'),status:videoStatus(artifact.status.replaceAll('-','_')),title:title||null};
    }
    const args = ['generate', 'video', '-n', notebookId, '--format', format, '--language', notebookLanguage(language), '--no-wait', '--retry', '0'];
    if (format !== 'cinematic') args.push('--style', style);
    for (const sourceId of sourceIds) args.push('-s', sourceId);
    // `--` keeps a prompt beginning with a dash from becoming a CLI option.
    // --json is inserted before it because Click ends option parsing at --.
    args.push('--json', '--', title ? `Title: ${title}\n\n${prompt}` : prompt);
    const result = await call(args, { mutation: true });
    return { notebookId, artifactId: returnedId(result.task_id, 'returned artifactId'), status: videoStatus(result.status), title: title || null };
  }
  async function getVideo({ notebookId, artifactId }) {
    id(notebookId, 'notebookId'); id(artifactId, 'artifactId');
    const result = await call(['artifact', 'get', artifactId, '-n', notebookId], {
      acceptObservation: value => value?.id === artifactId && value.notebook_id === notebookId
        && String(value.type).toLowerCase() === 'video' && ['pending','in_progress','completed','failed'].includes(value.status),
    });
    if (result.id !== artifactId || result.notebook_id !== notebookId) throw new Error('Gemini Notebook returned a different artifact or notebook');
    if (String(result.type).toLowerCase() !== 'video') throw new Error(`Gemini Notebook artifact ${artifactId} is not a video`);
    let submission = null;
    try { submission = (await rawNotebookVideos(notebookId, { env, storagePath, execFile })).find(video => video.artifactId === artifactId) ?? null; }
    catch { /* Known artifact status remains useful if raw SDK metadata is unavailable. */ }
    return { notebookId, artifactId, title: result.title, status: videoStatus(result.status), ...(submission ?? {}) };
  }
  async function listVideos({ notebookId }) {
    id(notebookId, 'notebookId');
    const result = await call(['artifact', 'list', '-n', notebookId, '--type', 'video']);
    if (result.notebook_id !== notebookId || !Array.isArray(result.artifacts)) throw new Error('Gemini Notebook returned an invalid artifact listing');
    // Titles are generated by Gemini Notebook and are not reliable submission keys.
    // This is an explicit adoption list, never an automatic retry/reconciliation.
    let submissions = [];
    try { submissions = await rawNotebookVideos(notebookId, { env, storagePath, execFile }); }
    catch { /* Listing identities and statuses still work without reconciliation metadata. */ }
    return result.artifacts.map(artifact => {
      id(artifact.id, 'listed artifactId');
      if (String(artifact.type).toLowerCase() !== 'video') throw new Error('Gemini Notebook video listing contained a different artifact type');
      const status = videoStatus(artifact.status);
      const submission = submissions.find(video => video.artifactId === artifact.id);
      return { notebookId, artifactId: artifact.id, title: artifact.title,
        status,
        createdAt: artifact.created_at || null,
        ...(submission ?? {}) };
    });
  }
  async function findVideo({ notebookId, sourceIds, prompt, title, format = 'explainer', language = 'en', startedAt }) {
    id(notebookId, 'notebookId'); required(prompt, 'prompt');
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) throw invalid('sourceIds must explicitly select at least one report');
    for (const sourceId of sourceIds) id(sourceId, 'sourceId');
    const submittedPrompt = title ? `Title: ${title}\n\n${prompt}` : prompt;
    const formatIds = { explainer: 1, brief: 2, cinematic: 3, short: 4 };
    if (!(format in formatIds)) throw invalid(`Unsupported video format: ${format}`);
    let candidates = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rows = await rawNotebookVideos(notebookId, { env, storagePath, execFile });
      candidates = rows.filter(row => row.sourceIds && row.sourceIds.length === sourceIds.length
        && row.sourceIds.every((sourceId, index) => sourceId === sourceIds[index])
        && row.prompt === submittedPrompt
        && row.language === notebookLanguage(language)
        && row.formatId === formatIds[format]
        && (!startedAt || (Number.isFinite(Date.parse(row.createdAt)) && Date.parse(row.createdAt) >= Date.parse(startedAt) - 90_000))
        && row.statusId !== 4);
      if (candidates.length) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (candidates.length > 1) throw new Error(`Gemini Notebook has ${candidates.length} videos with the exact submitted source IDs and prompt`);
    if (!candidates.length) return null;
    const result = await call(['artifact', 'get', candidates[0].artifactId, '-n', notebookId]);
    if (result.id !== candidates[0].artifactId || result.notebook_id !== notebookId || String(result.type).toLowerCase() !== 'video') {
      throw new Error('Gemini Notebook returned a different artifact while reconciling a video submission');
    }
    return { notebookId, artifactId: candidates[0].artifactId, title: result.title, status: videoStatus(result.status), ...candidates[0] };
  }
  async function downloadVideo({ notebookId, artifactId, outputPath }) {
    const artifact = await getVideo({ notebookId, artifactId });
    if (artifact.status !== 'completed') throw new Error(`Gemini Notebook video ${artifactId} is ${artifact.status}`);
    const path = resolve(required(outputPath, 'outputPath'));
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${artifactId}.part`;
    try {
      // The installed client streams 64 KiB chunks to disk; no video enters stdout.
      const result = await call(['download', 'video', temporary, '-n', notebookId, '-a', artifactId, '--force'], { timeout: downloadTimeoutMs });
      if (result.status !== 'downloaded' || result.artifact?.id !== artifactId) throw new Error('Gemini Notebook did not confirm the requested download');
      const file = await stat(temporary);
      if (!file.isFile() || file.size === 0) throw new Error(`Gemini Notebook downloaded an empty video`);
      await rename(temporary, path);
      return { notebookId, artifactId, outputPath: path, bytes: file.size };
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return { authenticationAdmission:()=>authenticationState({env,storagePath}).blocked??null, createNotebook, ensureSource, removeSources, generateVideo, getVideo, listVideos, findVideo, downloadVideo };
}
