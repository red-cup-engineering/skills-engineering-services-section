/**
 * Google Flow's web application (flow.google.com), read in plain Node through the house's
 * batchexecute session under its AiSandboxAngularFrontend.
 *
 * The credential is the Google account's browser storage state: GOOGLE_FLOW_STORAGE_STATE names
 * a file, else the one `notebooklm login` keeps fresh for the same account is used, since Flow
 * and Gemini Notebook are both of the account's Google AI plan.
 *
 * credits() answers the balance the profile menu shows ("1,050 Google Flow credits") and the
 * instant the plan's monthly grant renews, from the call the page makes on load. models() answers
 * the catalog with each model's price at the plan's tier.
 *
 * Generation calls carry a reCAPTCHA Enterprise token minted for their action on Flow's origin;
 * `mint(action)` is the caller's (assisted-browser's openRecaptchaMinter serves it), and `siteKey`
 * is read from the signed-in page. Without `mint`, the client reads but cannot generate.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openBatchExecuteSession } from '@red-cup-engineering/http-services-section/batchexecute';
import {
  ACTION, RECAPTCHA_SITE_KEY_FIELD, RPC, imageAnswer, imageRequest, mediaRequest, modelCatalog,
  videoRow, videoStatusRequest, videoStatuses, videoSubmission, videoTextRequest,
} from './flow-protocol.mjs';

export { RPC };
export const HOME_URL = 'https://flow.google.com/';

/** The account's storage state file: GOOGLE_FLOW_STORAGE_STATE, else notebooklm's profile's. */
export const storageStatePath = (env = process.env) => env.GOOGLE_FLOW_STORAGE_STATE
  ?? join(env.HOME || homedir(), '.notebooklm', 'profiles', env.NOTEBOOKLM_PROFILE ?? 'default', 'storage_state.json');

export function readStorageState({ env = process.env, storagePath } = {}) {
  return JSON.parse(readFileSync(storagePath ?? storageStatePath(env), 'utf8'));
}

/**
 * The credits answer, `[balance, ?, ?, ?, null, balance, [renewsAtSeconds, nanos]]`: [0] is the
 * balance the menu shows. [6] is an instant about a month ahead, the monthly grant's renewal.
 * The rest is kept as `codes`, unread.
 */
export function creditsRow(row) {
  if (!Array.isArray(row) || !Number.isFinite(row[0])) throw new TypeError('Google Flow credits answer has no balance');
  const renews = Array.isArray(row[6]) && Number.isFinite(row[6][0]) ? new Date(row[6][0] * 1000 + Math.floor((row[6][1] ?? 0) / 1e6)).toISOString() : null;
  return Object.freeze({ balance: row[0], renewsAt: renews, codes: Object.freeze(row.slice(1, 6)) });
}

const upperId = () => crypto.randomUUID().toUpperCase();
const seed = () => Math.floor(Math.random() * 2 ** 31);
const projectPath = (projectId) => {
  if (typeof projectId !== 'string' || !projectId) throw new TypeError('a Flow generation needs the project it is made in');
  return `/project/${projectId}`;
};

export async function openGoogleFlow({ storageState, readState = () => storageState ?? readStorageState(), mint, fetch = globalThis.fetch, now } = {}) {
  const google = await openBatchExecuteSession({ home: HOME_URL, frontend: 'AiSandboxAngularFrontend', label: 'Google Flow', readState, fetch, now });
  const token = async (action) => {
    if (typeof mint !== 'function') throw new TypeError('Flow generation needs a reCAPTCHA mint(action)');
    return mint(action);
  };
  return {
    get origin() { return google.origin; },
    /** Flow's reCAPTCHA Enterprise site key, from the signed-in page. */
    get siteKey() { return google.field(RECAPTCHA_SITE_KEY_FIELD); },
    async credits() { return creditsRow(await google.rpc(RPC.credits, [])); },
    async models(tier) { return modelCatalog(await google.rpc(RPC.models, []), tier); },
    /** Submit `count` clips of one prompt; answers the balance after and each clip's row. */
    async generateVideos({ prompt, model, aspect, count = 1, projectId }) {
      const args = videoTextRequest({ prompt, model, aspect, count, projectId, token: await token(ACTION.video), newId: upperId });
      return videoSubmission(await google.rpc(RPC.generateVideoText, args, projectPath(projectId), { mutation: true }));
    },
    async videoStatus(mediaIds, { projectId } = {}) {
      return videoStatuses(await google.rpc(RPC.videoStatus, videoStatusRequest(mediaIds), projectId ? projectPath(projectId) : '/'));
    },
    /** One clip's row with its signed video and thumbnail URLs. */
    async media(mediaId, { projectId } = {}) {
      const answer = await google.rpc(RPC.media, mediaRequest(mediaId), projectId ? projectPath(projectId) : '/');
      return videoRow(Array.isArray(answer?.[0]) && typeof answer[0][0] === 'string' ? answer[0] : answer);
    },
    /** `count` images of one prompt, made synchronously; answers each image's signed URL. */
    async generateImages({ prompt, model, aspect, count = 1, projectId }) {
      const args = imageRequest({ prompt, model, aspect, count, projectId, token: await token(ACTION.image), newId: upperId, seed });
      return imageAnswer(await google.rpc(RPC.generateImages, args, projectPath(projectId), { mutation: true }));
    },
    /** A signed media URL's bytes and type. Signed URLs carry their own authority: no cookies. */
    async download(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Flow media answered HTTP ${response.status}`);
      return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0] };
    },
    rpc: google.rpc,
  };
}
