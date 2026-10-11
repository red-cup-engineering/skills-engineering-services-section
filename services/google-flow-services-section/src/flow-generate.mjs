#!/usr/bin/env node
/**
 * Generate an order of Google Flow media against the account's credits, and keep what comes back.
 *
 * An order is a JSON array (or JSON lines) of generations, each named for its consumer:
 *
 *   { "consumer": "ice-out-trailer", "medium": "video", "prompt": "...",
 *     "model": "veo_3_1_t2v_lite", "aspect": "16:9", "count": 2 }
 *   { "consumer": "persona-art", "medium": "image", "prompt": "...", "model": "GEM_PIX_2", "aspect": "3:4", "count": 4 }
 *
 * Prices are Flow's catalog's at the plan's tier, read at the start of each run. A generation that
 * spends credits is held in the host's allowance ledger before it is submitted, attempted at
 * submission, and settled as spent under its media ids when Flow accepts it (refused when Flow
 * declines for capacity, void otherwise), so concurrent jobs never both take the last credits and
 * a run cut short frees its holds when they lapse. The balance Flow answers with each submission
 * is recorded as evidence. A generation priced 0 (images, at Pro) goes straight through.
 *
 * Every output is stored content-addressed under the house's state directory, media/<sha256>.<ext>,
 * and journaled (generations.jsonl) as a media artifact work completion naming its consumer,
 * prompt, model, credits and Flow media id. Signed URLs lapse within hours; the stored bytes are
 * the record.
 *
 * A PUBLIC_ERROR_UNUSUAL_ACTIVITY refusal pauses new generation until the account owner
 * resolves it in Flow and explicitly resumes. Accepted clips and pending orders are retained;
 * polling and Drive publication remain available while generation is paused.
 *
 * `--adopt <media id>... --consumer <name>` keeps media already made in the project (by hand in
 * Flow, or by a run cut short) the same way: stored by digest and journaled for their consumer.
 * Their credits were spent when they were made and are in the balance's evidence already.
 *
 * Consumers queue orders rather than run them: `queueFlowOrder` writes one under orders/pending,
 * and `--queue` (a node job driven by demand, not a timer: `flowQueueDemand`) claims them and runs the oldest queued lines that fit the day's pace: the daily
 * grant, which lapses at the day's turn, plus the monthly balance spread evenly over the days to
 * renewal, when it lapses too. Lines that do not fit stay queued; budget no line claimed is
 * journaled (idle.jsonl) as capacity wanting a consumer.
 *
 * `--dry-run` reads the balance and the allowance and says which generations fit, spending nothing.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { completeMediaArtifactWork, createMediaArtifactWorkLot } from '@red-cup-engineering/computer-inference-engine/media/artifact-work';
import { DEFAULT_PROVIDERS as DEFAULT_IMAGE_PROVIDERS } from '@red-cup-engineering/computer-inference-engine/image/image-generation';
import { allowanceLedgerPath, attemptAllowance, holdAllowance, readAllowanceLedger, recordAllowanceEvidence, settleAllowance } from '@red-cup-engineering/computer-inference-engine/media/allowance-ledger';
import { openRecaptchaMinter } from '@red-cup-engineering/assisted-browser-services-section/recaptcha';
import { keepMediaInDrive, releaseMediaCache } from '@red-cup-engineering/google-drive-services-section/media';
import { openGoogleFlow, storageStatePath } from './google-flow-client.mjs';
import { videoModelKey } from './flow-protocol.mjs';
import { appendCreditReading, balanceEvidence, creditJournalPath, flowAllowance, loadFlowAllowanceConfig } from './flow-credits.mjs';

const PROVIDER = 'urn:ame:google-flow';
const EXTENSION = { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PACING = Object.freeze({ floorMs: 60_000, ceilingMs: 600_000, refused: 2, accepted: 0.98 });

/** Keep measured caution across idle periods; only accepted work gradually reduces it. */
export function readPacing(path = join(flowStateDir(), 'pacing.json')) {
  try {
    const { gapMs, at, verificationRequired } = JSON.parse(readFileSync(path, 'utf8'));
    const gap = Number.isFinite(gapMs) ? gapMs : PACING.floorMs;
    return { gapMs: Math.min(PACING.ceilingMs, Math.max(PACING.floorMs, Math.round(gap))), at, ...(verificationRequired ? { verificationRequired } : {}) };
  } catch { return { gapMs: PACING.floorMs, ...(existsSync(path)?{verificationRequired:{code:'FLOW_PACING_STATE_UNREADABLE',message:'Repair or explicitly resume the retained Flow pacing state before generating'}}:{}) }; }
}

function writePacing(pacing, path = join(flowStateDir(), 'pacing.json')) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary=path+'.'+process.pid+'.tmp';
  writeFileSync(temporary, `${JSON.stringify(pacing)}\n`, {mode:0o600});
  renameSync(temporary,path);
}

/** The next gap after a call Flow accepted or refused for its token. */
export const nextGap = (gapMs, refused) => Math.round(Math.min(PACING.ceilingMs, Math.max(PACING.floorMs, gapMs * (refused ? PACING.refused : PACING.accepted))));
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The house's Flow state directory: the credit journal's, the media store's and the generation journal's. */
export const flowStateDir = (env = process.env) => dirname(creditJournalPath(env));

/** An order's generations, admitted: each names its consumer, medium, prompt and model. */
export function admitOrder(text) {
  const trimmed = text.trim();
  const rows = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return rows.map((row, index) => {
    for (const field of ['consumer', 'medium', 'prompt', 'model']) if (typeof row[field] !== 'string' || !row[field].trim()) throw new TypeError(`order line ${index + 1} needs ${field}`);
    if (!['video', 'image'].includes(row.medium)) throw new TypeError(`order line ${index + 1}: medium is video or image`);
    const count = row.count ?? 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 4) throw new TypeError(`order line ${index + 1}: count is 1 to 4, as Flow makes them`);
    const aspect = row.aspect ?? (row.medium === 'video' ? '16:9' : '1:1');
    return Object.freeze({ ...row, count, aspect, kind: row.medium === 'video' ? videoModelKey(row.model, aspect) : row.model });
  });
}

/** Keep `bytes` under their digest; answers the path and the digest. */
export function storeMedia(bytes, mimeType, { dir = join(flowStateDir(), 'media') } = {}) {
  const hex = createHash('sha256').update(bytes).digest('hex');
  const path = join(dir, `${hex}.${EXTENSION[mimeType] ?? 'bin'}`);
  if (!existsSync(path)) { mkdirSync(dir, { recursive: true }); writeFileSync(path, bytes, { mode: 0o644 }); }
  return { path, sha256: hex };
}

function journal(record, path = join(flowStateDir(), 'generations.jsonl')) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/** Whether Flow's refusal says capacity (credits, quota, rate) rather than anything else. */
const capacityRefusal = (error) => /credit|quota|RESOURCE_EXHAUSTED|rate.?limit|429/iu.test(`${error?.message ?? ''} ${error?.status ?? ''}`);

/** Whether Flow refused the call's reCAPTCHA token as automated: nothing was made or spent. */
const tokenRefusal = (error) => error?.reasons?.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') ?? false;

async function keep({ flow, order, lot, url, mediaId, credits, account }) {
  const { bytes, mimeType } = await flow.download(url);
  const stored = storeMedia(bytes, mimeType);
  const completion = completeMediaArtifactWork(lot, {
    providerIdentity: PROVIDER, product: 'google-flow', executionMode: 'asynchronous-artifact-provider', bytes, mimeType,
    providerArtifactId: mediaId, accountIdentity: account,
    resource: { model: order.kind, aspect: order.aspect, credits, path: stored.path, sha256: stored.sha256 },
  });
  journal({ ...completion, consumer: order.consumer });
  // Retain the received artifact even if Drive is temporarily unavailable; the publisher
  // can finish its transfer without regenerating or spending another provider request.
  let drive, drivePending;
  try { drive = await keepMediaInDrive(stored.path, { folder: `flow/${order.consumer}`, expectedSha256: stored.sha256 }); }
  catch { drivePending = true; } // The retained completion lets the independent publisher retry custody.
  if (drive) journal({ type: 'MediaDriveCustody', consumer: order.consumer, providerArtifactId: mediaId, sha256: stored.sha256, drive, recordedAt: new Date().toISOString() });
  if (drive && process.env.GOOGLE_FLOW_EVICT_MEDIA === '1') await releaseMediaCache(drive, stored.path);
  return { consumer: order.consumer, mediaId, path: stored.path, bytes: bytes.length, mimeType, ...(drive ? { drive } : {}), ...(drivePending ? { drivePending } : {}) };
}

async function generateImages({ flow, order, lot, projectId, account, price, ask, onAttempt, onSpent, state }) {
  const images = await ask(() => {onAttempt(order);return flow.generateImages({ ...order, projectId });});
  if (!images.length || images.some(image=>!image.mediaId)) throw new Error('Flow image submission has no acknowledged media IDs; retain the attempted order for review');
  const job={order,lot,projectId,account,price:price/images.length,mediaIds:images.map(image=>image.mediaId),images,acceptedAt:new Date().toISOString(),received:[],failed:[]};
  const path=submissionPath(state,lot);writeJob(path,job);
  onSpent(order);
  return receiveSubmission(flow,job,path);
}

/** Observe accepted clips once; durable submissions outlive this worker turn. */
async function awaitClips(flow, mediaIds, projectId) {
  const rows = new Map((await flow.videoStatus(mediaIds,{projectId})).map(row=>[row.mediaId,row]));
  return mediaIds.map((id) => rows.get(id) ?? { mediaId: id, status: 'unfinished' });
}

function writeJob(path,job){mkdirSync(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(job),{mode:0o600});renameSync(temp,path);}
function submissionPath(state,lot){return join(state,'in-flight',createHash('sha256').update(lot.id).digest('hex')+'.json');}

async function receiveSubmission(flow,job,path) {
  const kept=[];job.received??=[];job.failed??=[];
  const pending=job.mediaIds.filter(id=>!job.received.includes(id)&&!job.failed.includes(id));
  const observations=job.order.medium==='image'
    ? pending.map(id=>({mediaId:id,status:'done',imageUrl:job.images?.find(image=>image.mediaId===id)?.imageUrl}))
    : pending.length?await awaitClips(flow,pending,job.projectId):[];
  for(const row of observations) {
    if(row.status==='failed'){job.failed.push(row.mediaId);writeJob(path,job);kept.push({consumer:job.order.consumer,mediaId:row.mediaId,status:'failed'});continue;}
    if(row.status!=='done'){kept.push({consumer:job.order.consumer,mediaId:row.mediaId,status:row.status});continue;}
    const media=row.videoUrl||row.imageUrl?row:await flow.media(row.mediaId,{projectId:job.projectId});
    const url=media.videoUrl??media.imageUrl;
    if(!url)throw new Error('Acknowledged Flow media has no downloadable URL yet');
    kept.push(await keep({flow,order:job.order,lot:job.lot,url,mediaId:row.mediaId,credits:job.price,account:job.account}));
    job.received.push(row.mediaId);writeJob(path,job);
  }
  if(job.mediaIds.every(id=>job.received.includes(id)||job.failed.includes(id))) {
    const dir=join(dirname(path),'done');mkdirSync(dir,{recursive:true,mode:0o700});renameSync(path,join(dir,path.split('/').pop()));
  }
  return kept;
}

/** Retrieve acknowledged media even while new generations are held. */
export async function resumeFlowSubmissions({state=flowStateDir(),open=openGoogleFlow}={}) {
  const dir=join(state,'in-flight');const files=existsSync(dir)?readdirSync(dir).filter(name=>name.endsWith('.json')):[];
  if(!files.length)return [];
  let flow;
  try {flow=await open();} catch(error) {return [{status:'received-media-pending',code:error.code??'FLOW_SESSION_UNAVAILABLE'}];}
  const results=[];
  for(const name of files){
    const path=join(dir,name);let job;
    try {
      job=JSON.parse(readFileSync(path,'utf8'));
      if(!job.order?.consumer||!job.lot?.id||!job.projectId||!Array.isArray(job.mediaIds)||!job.mediaIds.length||job.mediaIds.some(id=>typeof id!=='string'||!id))throw new Error('Invalid retained Flow submission');
      results.push({consumer:job.order.consumer,kept:await receiveSubmission(flow,job,path)});
    }catch(error){results.push({consumer:job?.order?.consumer,status:'received-media-pending',code:error.code??'FLOW_RECEIPT_PENDING'});}
  }
  return results;
}

async function generateVideos({ flow, order, lot, projectId, account, price, allowance, storePath, ask, onSpent, onAttempt, state }) {
  const principal = `google-flow:${order.consumer}`;
  const held = holdAllowance(allowance, { id: randomUUID(), kind: order.kind, count: order.count, principal, reference: lot.id }, { storePath });
  if (held.disposition !== 'held') return { refused: held.reason };
  const attempt = attemptAllowance(allowance, held.hold.id, { storePath });
  if (attempt.disposition !== 'attempted') return { refused: attempt.reason };
  let submission;
  try {
    submission = await ask(() => {onAttempt(order);return flow.generateVideos({ ...order, projectId });});
  } catch (error) {
    settleAllowance(allowance, held.hold.id, { outcome: capacityRefusal(error) ? 'refused' : 'void', storePath });
    throw error;
  }
  const mediaIds = submission.clips.map(({ mediaId }) => mediaId);
  if(!mediaIds.length||mediaIds.some(id=>!id))throw new Error('Flow video submission has no acknowledged media IDs; retain the attempted order for review');
  const job={order,lot,projectId,account,price,mediaIds,acceptedAt:new Date().toISOString(),received:[],failed:[]};
  const path=submissionPath(state,lot);writeJob(path,job);
  onSpent(order);
  settleAllowance(allowance, held.hold.id, { outcome: 'spent', source: `google-flow:media/${[...mediaIds].sort().join(',')}`, storePath });
  if (Number.isFinite(submission.balance)) recordAllowanceEvidence(allowance, [balanceEvidence({ at: new Date().toISOString(), balance: submission.balance })], { storePath });
  const kept=await receiveSubmission(flow,job,path);
  return { kept, balance: submission.balance };
}

/**
 * Run `order` (admitted generations) on the account. `projectId` is the Flow project the media are
 * made in; `onSpent(line)` hears each line as Flow charges for it. Answers what was kept, refused
 * or failed per generation, and the balance after.
 */
export async function runFlowOrder(order, { projectId, dryRun = false, config = loadFlowAllowanceConfig(), storePath = allowanceLedgerPath(), log = (line) => process.stderr.write(`${line}\n`), patienceMs = Infinity, onSpent = () => {}, onAttempt=()=>{}, state=flowStateDir() } = {}) {
  const pacingPath=join(state, 'pacing.json');
  let pacing = readPacing(pacingPath);
  if (pacing.verificationRequired && !dryRun) return { verificationRequired: pacing.verificationRequired, results: order.map(line => ({ consumer: line.consumer, kind: line.kind, refused: 'withheld: Flow unusual-activity refusal needs review before resuming' })) };
  let minter = null;
  const flow = await openGoogleFlow({ mint: async (action) => {
    minter ??= await openRecaptchaMinter({ origin: flow.origin, siteKey: flow.siteKey, storageStatePath: storageStatePath() });
    return minter.mint(action);
  } });
  let lastCall = 0;
  let withheld = null;
  const paced = (refused) => {
    pacing = { ...pacing, gapMs: nextGap(pacing.gapMs, refused), at: new Date().toISOString() };
    if (!dryRun) writePacing(pacing,pacingPath);
  };
  const ask = async (call) => {
    const wait = Math.max(0, (lastCall || Date.parse(pacing.at ?? 0) || 0) + pacing.gapMs - Date.now());
    if (wait > patienceMs) throw new Error(`Flow is paced ${Math.ceil(wait / 1000)}s out, past this caller's patience`);
    await pause(wait);
    lastCall = Date.now();
    try {
      const answer = await call();
      paced(false);
      return answer;
    } catch (error) {
      if (!tokenRefusal(error)) {
        if(capacityRefusal(error)){withheld=error.message;paced(true);}
        throw error;
      }
      withheld = error.message;
      pacing.verificationRequired = { code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', observedAt: new Date().toISOString() };
      paced(true);
      log(JSON.stringify({ verificationRequired: pacing.verificationRequired, message: 'New Flow generations paused; review the unusual-activity refusal in Flow, then use --resume' }));
      throw error;
    }
  };
  try {
    const at = new Date().toISOString();
    const { balance, renewsAt } = await flow.credits();
    appendCreditReading({ at, balance, renewsAt });
    const catalog = await flow.models(config.tier);
    const prices = Object.fromEntries(catalog.map(({ key, credits }) => [key, credits]));
    const allowance = flowAllowance(config, { renewsAt, catalog });
    recordAllowanceEvidence(allowance, [balanceEvidence({ at, balance })], { storePath });
    const results = [];
    for (const line of order) {
      if (withheld) { results.push({ consumer: line.consumer, kind: line.kind, refused: `withheld: ${withheld}` }); continue; }
      if (!(line.kind in prices)) { results.push({ consumer: line.consumer, kind: line.kind, refused: 'not in the catalog at this tier' }); continue; }
      const price = prices[line.kind] * line.count;
      if (dryRun) {
        const { reading } = readAllowanceLedger(allowance, { storePath });
        results.push({ consumer: line.consumer, kind: line.kind, credits: price, fit: price === 0 ? 'free' : reading.fits[line.kind], fitting: price === 0 ? null : reading.counts[line.kind] });
        continue;
      }
      const lot = createMediaArtifactWorkLot({ workLot: `google-flow:${line.consumer}:${randomUUID()}`, principal: line.consumer, capability: line.medium === 'video' ? 'text-to-video' : 'text-to-image', prompt: line.prompt, sources: [], outputMimeType: line.medium === 'video' ? 'video/mp4' : 'image/*' });
      try {
        if (line.medium === 'image' && price === 0) {
          const kept = await generateImages({ flow, order: line, lot, projectId, account: config.account, price, ask, onAttempt, onSpent, state });
          results.push({ consumer: line.consumer, kind: line.kind, credits: 0, kept });
        } else if (line.medium === 'video') {
          const outcome = await generateVideos({ flow, order: line, lot, projectId, account: config.account, price: prices[line.kind], allowance, storePath, ask, onSpent, onAttempt, state });
          results.push({ consumer: line.consumer, kind: line.kind, credits: outcome.refused ? 0 : price, ...outcome });
        } else {
          results.push({ consumer: line.consumer, kind: line.kind, refused: 'priced images are not held yet' });
        }
      } catch (error) {
        results.push({ consumer: line.consumer, kind: line.kind, failed: error.message, ...(error.code?{code:error.code}:{}) });
      }
      log(JSON.stringify(results.at(-1)));
    }
    const after = await flow.credits();
    appendCreditReading({ at: new Date().toISOString(), balance: after.balance, renewsAt: after.renewsAt });
    return { before: balance, after: after.balance, renewsAt: after.renewsAt, results };
  } finally {
    await minter?.close();
  }
}

/**
 * Keep `mediaIds`, clips already made in the project, for `consumer`: each finished one is stored
 * and journaled as a generation's output is. Answers what was kept or why not.
 */
export async function adoptFlowMedia(mediaIds, { consumer, projectId, config = loadFlowAllowanceConfig() } = {}) {
  if (typeof consumer !== 'string' || !consumer.trim()) throw new TypeError('adopted media need the consumer they are kept for');
  const flow = await openGoogleFlow();
  const kept = [];
  for (const mediaId of mediaIds) {
    try {
      const row = await flow.media(mediaId, { projectId });
      if (row.status !== 'done' || !row.videoUrl) { kept.push({ consumer, mediaId, status: row.status }); continue; }
      const kind = row.model ?? 'unknown';
      const lot = createMediaArtifactWorkLot({ workLot: `google-flow:${consumer}:${mediaId}`, principal: consumer, capability: 'text-to-video', prompt: row.prompt ?? '', sources: [], outputMimeType: 'video/mp4' });
      kept.push(await keep({ flow, order: { consumer, kind, aspect: null }, lot, url: row.videoUrl, mediaId, credits: null, account: config.account }));
    } catch (error) {
      kept.push({ consumer, mediaId, failed: error.message });
    }
  }
  return kept;
}

/**
 * An image provider for the inference engine's image generation (image/image-generation's
 * `providers`): one free Flow image of the prompt, made as an order line for `consumer`, so it is
 * paced, stored by digest and journaled like any order's. It neither waits out a pace longer than
 * `patienceMs` nor asks again after a refused token, and throws when Flow keeps nothing, letting
 * the next provider answer.
 */
export function flowImageProvider({ consumer, model = 'GEM_PIX_2', aspect = '16:9', patienceMs = 60_000, run = runFlowOrder, config } = {}) {
  if (typeof consumer !== 'string' || !consumer.trim()) throw new TypeError('a Flow image provider needs the consumer its images are made for');
  return async function callGoogleFlowImage(prompt) {
    const resolved = config ?? loadFlowAllowanceConfig();
    const projectId = process.env.GOOGLE_FLOW_PROJECT ?? resolved.project;
    const [line] = admitOrder(JSON.stringify([{ consumer, medium: 'image', prompt, model, aspect, count: 1 }]));
    const { results: [result] } = await run([line], { projectId, config: resolved, patienceMs });
    const image = result?.kept?.find(({ path }) => path);
    if (!image) throw new Error(`Flow made no image: ${result?.failed ?? result?.refused ?? 'nothing kept'}`);
    const resultImage = { provider: PROVIDER, model, base64: readFileSync(image.path).toString('base64'), mimeType: image.mimeType, providerArtifactId: image.mediaId };
    if (image.drive) await releaseMediaCache(image.drive, image.path);
    return resultImage;
  };
}

/**
 * The house's image providers for `consumer`, best first: a free Flow image at `aspect` (one of
 * Flow's: 1:1, 9:16, 16:9, 3:4, 4:3), then the engine's own (Workers AI). What a consumer passes
 * as `providers` to the engine's image generation.
 */
export const imageProviders = ({ consumer, aspect = '1:1', ...flow }) => [flowImageProvider({ consumer, aspect, ...flow }), ...DEFAULT_IMAGE_PROVIDERS];

const ordersDir = (state = flowStateDir()) => join(state, 'orders');

/** Queue `lines` (an order's generations) for the daily run; answers the queued file. */
export function queueFlowOrder(lines, { name = 'order', state = flowStateDir(), now = new Date() } = {}) {
  const admitted = admitOrder(JSON.stringify(lines));
  const dir = join(ordersDir(state), 'pending');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${now.toISOString().replace(/[:.]/gu, '-')}-${name.replace(/[^a-z0-9-]/giu, '-')}.jsonl`);
  writeFileSync(`${path}.part`, `${admitted.map(({ kind, ...line }) => JSON.stringify(line)).join('\n')}\n`);
  renameSync(`${path}.part`, path);
  return path;
}

/** The credits today's run may spend: the daily grant plus the monthly balance's even share of the days left. */
export function dailyPace({ balance, renewsAt, daily, now = new Date() }) {
  const days = Math.max(1, Math.ceil((Date.parse(renewsAt) - now.getTime()) / 86_400_000));
  return Math.min(balance, daily + Math.floor(Math.max(0, balance - daily) / days));
}

/** Whether process `pid` on this host is still running. */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
const strip = ({ kind, ...line }) => line;
/**
 * The name a claim's requeued lines go back under: its oldest order's, so they keep their place,
 * the lines it took (`.1-taken`) before those it left (`.2-left`).
 */
const oldest = (files) => [...files].sort()[0]?.replace(/(\.\d-(taken|left))*\.jsonl(\.claimed)?$/u, '') ?? 'order';

/**
 * A claim a run left when its process died, put right. Before the claim was committed (its
 * orders still under their own names) nothing was spent and the orders go back whole. After, the
 * leftover goes back whole and the taken lines go back less those the run spent (spent.jsonl), so
 * a cut-short run spends a line at most once; a spent line's media can be adopted.
 */
function recoverClaim(claim, state) {
  const names=readdirSync(claim);
  const meta=['taken.jsonl','left.jsonl','spent.jsonl','attempted.jsonl','refused.jsonl'];
  const own=names.filter(file=>file.endsWith('.jsonl')&&!meta.includes(file));
  const preparing=existsSync(join(claim,'claim.json'))&&!existsSync(join(claim,'committed'));
  if (preparing || own.length) {
    const originals=preparing?names.filter(file=>(file.endsWith('.jsonl')&&!meta.includes(file))||file.endsWith('.jsonl.claimed')):own;
    for (const file of originals) renameSync(join(claim, file), join(ordersDir(state), 'pending', file.replace(/\.claimed$/u,'')));
  } else {
    const base = oldest(readdirSync(claim).filter((file) => file.endsWith('.jsonl.claimed')));
    if (existsSync(join(claim, 'left.jsonl'))) renameSync(join(claim, 'left.jsonl'), join(ordersDir(state), 'pending', `${base}.2-left.jsonl`));
    const spent = new Set(lines(join(claim, 'spent.jsonl')));
    const unspent = lines(join(claim, 'taken.jsonl')).filter((line) => !spent.has(line));
    const refused=new Set(lines(join(claim,'refused.jsonl'))),attempted=new Set(lines(join(claim,'attempted.jsonl')).filter(line=>!refused.has(line)));
    const uncertain=unspent.filter(line=>attempted.has(line)),safe=unspent.filter(line=>!attempted.has(line));
    if(safe.length)writeFileSync(join(ordersDir(state),'pending',`${base}.1-taken.jsonl`),safe.join('\n')+'\n',{mode:0o600});
    if(uncertain.length){const review=join(ordersDir(state),'review');mkdirSync(review,{recursive:true,mode:0o700});writeFileSync(join(review,claim.split('/').pop()+'.jsonl'),uncertain.join('\n')+'\n',{mode:0o600});}
  }
  renameSync(claim, join(ordersDir(state), 'done', `cut-short-${claim.split('/').pop()}`));
}

/**
 * Run the queued orders within today's pace, oldest first. A line priced past what is left stays
 * queued for a later day; images (free) always run.
 *
 * The pending orders are claimed (moved under orders/claimed/<pid>-<ms>) before anything runs, so
 * two runs never take the same line. The claim is committed once what will run (taken.jsonl) and
 * what will not (left.jsonl) are written, and each line Flow charges for is noted (spent.jsonl) as
 * it is spent, so a run cut short leaves a claim the next run puts right. Answers the run's
 * outcome and the idle budget.
 */
export async function runFlowQueue({ projectId, config = loadFlowAllowanceConfig(), state = flowStateDir(), now = new Date(), log, run = runFlowOrder, open = openGoogleFlow } = {}) {
  const pending = join(ordersDir(state), 'pending');
  const claims = join(ordersDir(state), 'claimed');
  const done = join(ordersDir(state), 'done');
  for (const dir of [pending, claims, done]) mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(claims)) if (!alive(Number(name.split('-')[0]))) recoverClaim(join(claims, name), state);
  const received=await resumeFlowSubmissions({state,open});
  const held = readPacing(join(state, 'pacing.json')).verificationRequired;
  if (held) return { verificationRequired: held, results: [], received, queued: readdirSync(pending).filter(name => name.endsWith('.jsonl')).flatMap(name => lines(join(pending, name))).length };
  if(!readdirSync(pending).some(name=>name.endsWith('.jsonl')))return {results:[],received,queued:0};
  const claim = join(claims, `${process.pid}-${now.getTime()}`);
  mkdirSync(claim);
  writeJob(join(claim,'claim.json'),{format:2});
  const files = [];
  for (const file of readdirSync(pending).filter((name) => name.endsWith('.jsonl')).sort()) {
    try { renameSync(join(pending, file), join(claim, file)); files.push(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if(!files.length){renameSync(claim,join(done,claim.split('/').pop()));return {results:[],received,queued:0};}
  const flow = await open();
  const { balance, renewsAt } = await flow.credits();
  const prices = Object.fromEntries((await flow.models(config.tier)).map(({ key, credits }) => [key, credits]));
  const daily = config.meters.find(({ id }) => id === 'daily')?.budget ?? 0;
  let budget = dailyPace({ balance, renewsAt, daily, now });
  const take = [], leave = [];
  // Our operational limit, not a claimed Google quota. Spread bursts across hosted turns.
  let submissionsLeft=3, deferredForPacing=false;
  for (const file of files) {
    for (const [index,row] of admitOrder(readFileSync(join(claim, file), 'utf8')).entries()) {
      const line={...row,orderId:row.orderId??createHash('sha256').update(file+':'+index).digest('hex')};
      // A line is divisible by its count: the clips that fit the pace run, the rest stay queued.
      const unit = prices[line.kind] ?? Infinity;
      const fits = Math.min(1, submissionsLeft, unit > 0 ? Math.min(line.count, Math.floor(budget / unit)) : line.count);
      if (fits > 0) { take.push({ ...line, count: fits }); budget -= unit * fits; submissionsLeft-=fits; }
      if (fits < line.count) {
        leave.push({ ...line, count: line.count - fits });
        if(unit<=budget)deferredForPacing=true;
      }
    }
  }
  const idle = budget;
  journal({ at: now.toISOString(), balance, renewsAt, pace: dailyPace({ balance, renewsAt, daily, now }), idle, queued: take.length, left: leave.length }, join(state, 'idle.jsonl'));
  const jsonl = (rows) => rows.map((row) => `${JSON.stringify(strip(row))}\n`).join('');
  writeFileSync(join(claim, 'taken.jsonl'), jsonl(take));
  if (leave.length) writeFileSync(join(claim, 'left.jsonl'), jsonl(leave));
  // The commit: the claimed orders give way to what was taken and left.
  for (const file of files) renameSync(join(claim, file), join(claim, `${file}.claimed`));
  writeFileSync(join(claim,'committed'),'committed\n',{mode:0o600});
  if (leave.length) renameSync(join(claim, 'left.jsonl'), join(pending, `${oldest(files)}.2-left.jsonl`));
  const onSpent = (line) => appendFileSync(join(claim, 'spent.jsonl'), jsonl([line]));
  const onAttempt=line=>appendFileSync(join(claim,'attempted.jsonl'),jsonl([line]),{mode:0o600});
  const outcome = take.length ? await run(take, { projectId, config, log, onSpent, onAttempt, state }) : { results: [] };
  writeJob(join(claim,'outcome.json'),outcome);
  // Keep refused work pending. Account challenges hold it until explicit resume;
  // capacity refusals remain eligible when the allowance returns.
  const spent=new Set(lines(join(claim,'spent.jsonl')));
  const refused = outcome.results.flatMap((result, index) => (!spent.has(jsonl([take[index]]).trim())&&/UNUSUAL_ACTIVITY|credit|quota|RESOURCE_EXHAUSTED|rate.?limit|withheld/iu.test(`${result.failed ?? ''} ${result.refused ?? ''}`) ? [take[index]] : []));
  if (refused.length) queueFlowOrder(refused.map(strip), { name: 'retry', state });
  if(refused.length)writeFileSync(join(claim,'refused.jsonl'),jsonl(refused),{mode:0o600});
  const unresolved=outcome.results.flatMap((result,index)=>result.failed&&!refused.includes(take[index])&&!spent.has(jsonl([take[index]]).trim())?[take[index]]:[]);
  if(unresolved.length){const review=join(ordersDir(state),'review');mkdirSync(review,{recursive:true,mode:0o700});writeFileSync(join(review,claim.split('/').pop()+'.jsonl'),jsonl(unresolved),{mode:0o600});}
  renameSync(claim, join(done, claim.split('/').pop()));
  return { balance, ...outcome, received, idle, deferredForPacing };
}

/**
 * What a queue run leaves, as its node job's demand reading: account challenges wait for explicit
 * resume; lines today's credits could not take run again when the
 * daily grant returns (the daily meter's next turn); with nothing left, nothing is due until a
 * consumer queues an order, which changes orders/pending, the directory the reading watches.
 */
export function flowQueueDemand(outcome, { config = loadFlowAllowanceConfig(), state = flowStateDir(), now = new Date() } = {}) {
  const pending = join(ordersDir(state), 'pending');
  const queued = existsSync(pending) ? readdirSync(pending).filter((name) => name.endsWith('.jsonl')).flatMap((name) => lines(join(pending, name))).length : 0;
  if (outcome.verificationRequired || readPacing(join(state, 'pacing.json')).verificationRequired) return { pending: 0, watch: [pending, join(state, 'pacing.json')] };
  const refused = (outcome.results ?? []).some((result) => /UNUSUAL_ACTIVITY|withheld|token/iu.test(`${result.failed ?? ''} ${result.refused ?? ''}`));
  const daily = config.meters.find(({ id }) => id === 'daily');
  const nextDay = daily ? (() => {
    const anchor = Date.parse(daily.anchor);
    const turns = Math.floor((now.getTime() - anchor) / 86_400_000) + 1;
    return new Date(anchor + turns * 86_400_000).toISOString();
  })() : undefined;
  const nextAt = queued === 0 ? undefined : refused ? new Date(now.getTime() + readPacing(join(state,'pacing.json')).gapMs).toISOString() : outcome.deferredForPacing ? new Date(now.getTime()+20*60_000).toISOString() : nextDay;
  return { pending: 0, ...(nextAt === undefined ? {} : { nextAt }), watch: [pending] };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { project: { type: 'string' }, 'dry-run': { type: 'boolean' }, adopt: { type: 'boolean' }, consumer: { type: 'string' }, queue: { type: 'boolean' }, resume: { type: 'boolean' } } });
  if (values.resume) {
    const { verificationRequired, ...pacing } = readPacing();
    writePacing({ ...pacing, at: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify({ resumed: true })}\n`);
    process.exit(0);
  }
  if (values.queue) {
    const config = loadFlowAllowanceConfig();
    const outcome = await runFlowQueue({ projectId: values.project ?? process.env.GOOGLE_FLOW_PROJECT ?? config.project, config });
    process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
    // The node job's demand reading (node-runtime-release-promotion-service writeNodeJobDemand's file).
    if (process.env.NODE_JOB_DEMAND) writeFileSync(process.env.NODE_JOB_DEMAND, `${JSON.stringify({ ...flowQueueDemand(outcome, { config }), at: new Date().toISOString() })}\n`);
    process.exit(0);
  }
  if (!positionals[0]) throw new TypeError('usage: flow-generate <order.json|-> [--project <id>] [--dry-run] | --queue | --resume | --adopt <media id>... --consumer <name>');
  const config = loadFlowAllowanceConfig();
  const projectId = values.project ?? process.env.GOOGLE_FLOW_PROJECT ?? config.project;
  if (values.adopt) {
    process.stdout.write(`${JSON.stringify(await adoptFlowMedia(positionals, { consumer: values.consumer, projectId, config }), null, 2)}\n`);
    process.exit(0);
  }
  const order = admitOrder(readFileSync(positionals[0] === '-' ? 0 : positionals[0], 'utf8'));
  const outcome = await runFlowOrder(order, { projectId, dryRun: values['dry-run'], config });
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
}
