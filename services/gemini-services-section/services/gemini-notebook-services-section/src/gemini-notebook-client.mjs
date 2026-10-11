import {notebookLanguage} from './language.mjs';
/**
 * Gemini Notebook (Gemini Notebook) read client, in plain Node.
 *
 * The web application speaks Google's batchexecute protocol, through the house's
 * batchexecute session (http-services-section), under its LabsTailwindUi frontend.
 * The browser sign-in the notebooklm-py CLI keeps (`notebooklm login`, a
 * Playwright storage state) is the credential; this client only reads it.
 *
 * openGeminiNotebook resolves the application's current origin (notebook.google.com
 * now redirects to notebook.google.com), and answers:
 * - listNotebooks, getNotebook (with its sources), listArtifacts (Studio rows),
 *   sourceHtml (a source's HTML rendition), interactiveHtml (quiz, flashcards);
 * - createArtifact(notebookId, request): asks Studio for one artifact of any kind
 *   STUDIO_KINDS names, grounded in the named sources;
 * - fetchMedia(url, { method, range }): an authenticated GET or HEAD of a
 *   provider media URL, following Google's cross-host redirects with the jar.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { GOOGLE_HOST, openBatchExecuteSession } from '@red-cup-engineering/http-services-section/batchexecute';

export const HOME_URL = 'https://notebook.google.com/';
export const RPC = Object.freeze({
  listNotebooks: 'wXbhsf',
  getNotebook: 'rLM1Ne',
  getSource: 'hizoJc',
  listArtifacts: 'gArtLc',
  interactiveHtml: 'v9rmvd',
  createArtifact: 'R7cb6c',
});
// artifact_data[2] and [4] in LIST_ARTIFACTS rows.
export const ARTIFACT_KINDS = Object.freeze({ 1: 'audio', 2: 'report', 3: 'video', 4: 'quiz', 5: 'mind-map', 7: 'infographic', 8: 'slide-deck', 9: 'data-table', 10: 'file' });
export const ARTIFACT_STATUS = Object.freeze({ 1: 'in-progress', 2: 'pending', 3: 'completed', 4: 'failed' });
// A video row's generation config is artifact_data[8][2]; its [4] is the format the request named,
// coded as the create-artifact payload codes it. Short is the native vertical format;
// Brief is the older landscape summary and remains readable for accepted work.
export const VIDEO_FORMATS = Object.freeze({ 1: 'explainer', 2: 'brief', 3: 'cinematic', 4: 'short' });

/**
 * The Studio kinds the house asks for, each with its type code and the options its create payload
 * codes, by the names Studio's UI and the notebooklm CLI give them (notebooklm-py 0.7.3 payloads).
 * `defaults` is what Studio picks when an option is not named. A cinematic video takes no style.
 */
export const STUDIO_KINDS = Object.freeze({
  video: Object.freeze({
    type: 3, defaults: { format: 'explainer', style: 'auto' },
    options: { format: { explainer: 1, brief: 2, cinematic: 3, short: 4 }, style: { auto: 1, classic: 2, whiteboard: 3, heritage: 4, 'paper-craft': 5, watercolor: 6, anime: 7, 'retro-print': 8, kawaii: 9 } },
  }),
  audio: Object.freeze({
    type: 1, defaults: { format: 'deep-dive', length: 'default' },
    options: { format: { 'deep-dive': 1, brief: 2, critique: 3, debate: 4 }, length: { short: 1, default: 2, long: 3 } },
  }),
  infographic: Object.freeze({
    type: 7, defaults: { orientation: 'landscape', detail: 'standard', style: 'auto' },
    options: {
      orientation: { landscape: 1, portrait: 2, square: 3 }, detail: { concise: 1, standard: 2, detailed: 3 },
      style: { auto: 1, 'sketch-note': 2, professional: 3, 'bento-grid': 4, editorial: 5, instructional: 6, bricks: 7, clay: 8, anime: 9, kawaii: 10, scientific: 11 },
    },
  }),
  'slide-deck': Object.freeze({
    type: 8, defaults: { format: 'detailed', length: 'default' },
    options: { format: { detailed: 1, presenter: 2 }, length: { default: 1, short: 2 } },
  }),
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const rejected = (message) => Object.assign(new TypeError(message), { code: 'GEMINI_NOTEBOOK_REQUEST_REJECTED', ambiguous: false });

/** A Studio request with every option named and checked: { kind, sourceIds, language, instructions, options }. */
export function studioRequest({ kind, sourceIds, language = 'en', instructions = null, options = {} }) {
  const spec = STUDIO_KINDS[kind];
  if (!spec) throw rejected(`Studio kind ${kind} is not one of ${Object.keys(STUDIO_KINDS).join(', ')}`);
  if (!Array.isArray(sourceIds) || !sourceIds.length || !sourceIds.every((id) => typeof id === 'string' && uuid.test(id))) throw rejected('sourceIds must name at least one source by its UUID');
  if (typeof language !== 'string' || !/^[a-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/u.test(language)) throw rejected('language must be a language tag');
  if (instructions !== null && typeof instructions !== 'string') throw rejected('instructions must be text');
  const named = { ...spec.defaults, ...options };
  if (kind === 'video' && ['cinematic','short'].includes(named.format)) delete named.style;
  for (const [option, value] of Object.entries(named)) {
    if (!(option in spec.options)) throw rejected(`${kind} takes no option ${option}`);
    if (!(value in spec.options[option])) throw rejected(`${kind} ${option} ${value} is not one of ${Object.keys(spec.options[option]).join(', ')}`);
  }
  return { kind, sourceIds: [...sourceIds], language, instructions: instructions?.trim() || null, options: named };
}

// Every Studio create carries the web client's capability envelope.
const CLIENT_OPTIONS = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8, 2, 3, 6]]];

/** CREATE_ARTIFACT's arguments for one checked Studio request: the kind's config sits at its own slot. */
export function studioCreateParams(notebookId, request) {
  const { kind, sourceIds, language: requestedLanguage, instructions, options } = studioRequest(request);
  const language=notebookLanguage(requestedLanguage);
  const spec = STUDIO_KINDS[kind];
  const code = (option) => spec.options[option][options[option]];
  const triple = sourceIds.map((id) => [[id]]);
  const double = sourceIds.map((id) => [id]);
  const slots = [null, null, spec.type, triple];
  if (kind === 'audio') slots[6] = [null, [instructions, code('length'), null, double, language, null, code('format')]];
  if (kind === 'video') slots[8] = [null, null, [double, language, instructions, null, code('format'), ...(options.style ? [code('style')] : [])]];
  if (kind === 'infographic') slots[14] = [[instructions, language, null, code('orientation'), code('detail'), code('style')]];
  if (kind === 'slide-deck') slots[16] = [[instructions, language, code('format'), code('length')]];
  return [CLIENT_OPTIONS, notebookId, Array.from(slots, (slot) => slot ?? null)];
}

/** Match the pinned SDK's home, configured default profile and legacy storage path. */
export function notebookStoragePath({env=process.env,storagePath}={}) {
  if(storagePath)return storagePath;
  const home=env.NOTEBOOKLM_HOME||join(homedir(),'.notebooklm');
  let configured;
  try {const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8'));if(typeof config.default_profile==='string')configured=config.default_profile;}catch{/* The SDK ignores missing or invalid global configuration. */}
  const profile=env.NOTEBOOKLM_PROFILE||configured||'default',root=resolve(home,'profiles'),directory=resolve(root,profile),within=relative(root,directory);
  if(!within||within==='..'||within.startsWith('..'+sep))throw new Error('Invalid Notebook profile name');
  const path=join(directory,'storage_state.json'),legacy=join(home,'storage_state.json');
  return profile==='default'&&!existsSync(path)&&existsSync(legacy)?legacy:path;
}

/** The storage state `notebooklm login` keeps: NOTEBOOKLM_AUTH_JSON, else the SDK profile's file. */
export function readStorageState({ env = process.env, storagePath } = {}) {
  if (!storagePath && env.NOTEBOOKLM_AUTH_JSON) return JSON.parse(env.NOTEBOOKLM_AUTH_JSON);
  const path = notebookStoragePath({env,storagePath});
  return JSON.parse(readFileSync(path, 'utf8'));
}

const seconds = (stamp) => (Array.isArray(stamp) && Number.isFinite(stamp[0]) ? new Date(stamp[0] * 1000).toISOString() : null);
const url = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : null);

/** One LIST_NOTEBOOKS / GET_NOTEBOOK row. */
export function notebookRow(row) {
  const meta = Array.isArray(row[5]) ? row[5] : [];
  return { id: row[2], title: String(row[0] ?? '').replace('thought\n', '').trim(), emoji: row[3] ?? null, isOwner: meta[1] === false, createdAt: seconds(meta[5]), sources: Array.isArray(row[1]) ? row[1].map(sourceRow) : [] };
}

/** One source of a notebook: its id, title, kind code, and the uploaded file's download URL when it has one. */
export function sourceRow(row) {
  const meta = Array.isArray(row[2]) ? row[2] : [];
  return { id: Array.isArray(row[0]) ? row[0][0] : row[0], title: row[1] ?? '', typeCode: meta[4] ?? null, url: url(meta[7]?.[0]) ?? null, createdAt: seconds(meta[2]), downloadUrl: url(row[5]) };
}

// Audio and video renditions are [url, kind, mediaType]: kind 1 is the progressive
// file, whose ranged answers carry its total length; kind 4 (the download
// rendition) streams without one; 2 and 3 are the HLS and DASH manifests.
const progressive = (items, mediaType) => {
  const files = items.filter((item) => Array.isArray(item) && url(item[0]) && item[2] === mediaType);
  return files.find((item) => item[1] === 1) ?? files[0];
};

/** The media a Studio row carries: [{ url, mediaType, role }] or inline text. */
export function artifactMedia(row) {
  const kind = ARTIFACT_KINDS[row[2]] ?? `type-${row[2]}`;
  if (kind === 'audio') {
    const best = progressive(Array.isArray(row[6]?.[5]) ? row[6][5] : [], 'audio/mp4');
    return best ? [{ url: best[0], mediaType: 'audio/mp4' }] : [];
  }
  if (kind === 'video') {
    const best = progressive((Array.isArray(row[8]) ? row[8] : []).flatMap((variant) => (Array.isArray(variant) ? variant : [])), 'video/mp4');
    return best ? [{ url: best[0], mediaType: 'video/mp4' }] : [];
  }
  if (kind === 'infographic') {
    for (const item of row) {
      const image = Array.isArray(item) && Array.isArray(item[2]) ? item[2][0]?.[1] : undefined;
      if (Array.isArray(image) && url(image[0])) return [{ url: image[0], mediaType: 'image/png' }];
    }
    return [];
  }
  if (kind === 'slide-deck') {
    const meta = Array.isArray(row[16]) ? row[16] : [];
    return [
      ...(url(meta[3]) ? [{ url: meta[3], mediaType: 'application/pdf' }] : []),
      ...(url(meta[4]) ? [{ url: meta[4], mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }] : []),
    ];
  }
  if (kind === 'report') {
    const markdown = typeof row[7] === 'string' ? row[7] : Array.isArray(row[7]) && typeof row[7][0] === 'string' ? row[7][0] : null;
    return markdown === null ? [] : [{ text: markdown, mediaType: 'text/markdown' }];
  }
  if (kind === 'file' && Array.isArray(row[24]) && url(row[24][3])) return [{ url: row[24][3], mediaType: row[24][1] ?? 'application/octet-stream' }];
  if (kind === 'quiz') return [{ interactive: true, mediaType: 'text/html' }];
  return [];
}

/**
 * One Studio row: id, title, kind, status, creation time, the sources it was grounded in, its
 * media, and a video's format and the instructions it was asked with (Studio echoes no other
 * kind's instructions).
 */
export function artifactRow(row) {
  const kind = ARTIFACT_KINDS[row[2]] ?? `type-${row[2]}`;
  const generation = kind === 'video' ? row[8]?.[2] : undefined;
  const formatCode = generation?.[4];
  const sourceIds = (Array.isArray(row[3]) ? row[3] : []).map((source) => source?.[0]?.[0]).filter((id) => typeof id === 'string');
  return {
    id: row[0], title: row[1] ?? '', kind, status: ARTIFACT_STATUS[row[4]] ?? 'unknown', createdAt: seconds(row[15]), sourceIds, media: artifactMedia(row),
    ...(Number.isInteger(formatCode) ? { videoFormat: VIDEO_FORMATS[formatCode] ?? `format-${formatCode}` } : {}),
    ...(typeof generation?.[2] === 'string' ? { instructions: generation[2] } : {}),
  };
}

/**
 * Why a Studio create failed, as the house's Notebook errors say it. A UserDisplayableError status
 * is Studio declining for quota (RATE_LIMITED), but Studio has been seen to make the artifact
 * anyway, so it stays ambiguous until the rows are read; another status, or no artifact id, is a
 * refusal; anything else (a dropped connection, a server error) may have created it.
 */
export function createFailure(error) {
  if (error?.code === 'BATCHEXECUTE_RPC_STATUS' && error.details?.includes('UserDisplayableError')) {
    return Object.assign(new Error('Gemini Notebook declined the Studio request for quota'), { code: 'GEMINI_NOTEBOOK_REQUEST_REJECTED', providerCode: 'RATE_LIMITED', ambiguous: true, cause: error });
  }
  if (error?.code === 'BATCHEXECUTE_RPC_STATUS' || error?.code === 'BATCHEXECUTE_RPC_REFUSED' || error?.code === 'GEMINI_NOTEBOOK_REQUEST_REJECTED') {
    return Object.assign(new Error(`Gemini Notebook refused the Studio request: ${error.message}`), { code: 'GEMINI_NOTEBOOK_REQUEST_REJECTED', providerCode: error.reasons?.[0] ?? `STATUS_${error.rpcCode ?? 'UNKNOWN'}`, ambiguous: false, cause: error });
  }
  return Object.assign(new Error(`Gemini Notebook may have taken the Studio request: ${error?.message ?? error}`), { code: 'GEMINI_NOTEBOOK_MUTATION_UNCONFIRMED', ambiguous: true, cause: error });
}

/**
 * A signed-in client. The page tokens it signs requests with last hours,
 * not days, so it signs in again, re-reading the storage state (which the
 * notebooklm CLI keeps fresh), every refreshMs and whenever a call is refused.
 */
export async function openGeminiNotebook({ storageState, readState = () => storageState ?? readStorageState(), fetch = globalThis.fetch, language = 'en', refreshMs = 30 * 60_000, now = () => Date.now() } = {}) {
  let google;
  try {
    google = await openBatchExecuteSession({ home: HOME_URL, frontend: 'LabsTailwindUi', label: 'Gemini Notebook', readState, fetch, language, refreshMs, now });
  } catch (error) {
    if (error.code === 'BATCHEXECUTE_AUTH_EXPIRED') throw Object.assign(new Error('Gemini Notebook sign-in has expired; run `notebooklm login`'), { code: 'GEMINI_NOTEBOOK_AUTH_EXPIRED' });
    throw error;
  }
  const { rpc } = google;
  const unwrapRows = (result) => (Array.isArray(result) && result.length === 1 && Array.isArray(result[0]) && (result[0].length === 0 || Array.isArray(result[0][0])) ? result[0] : Array.isArray(result) ? result : []);

  return {
    get origin() { return google.origin; },
    async listNotebooks() { return ((await rpc(RPC.listNotebooks, [null, 1, null, [2]]))?.[0] ?? []).map(notebookRow); },
    async getNotebook(notebookId) {
      const result = await rpc(RPC.getNotebook, [notebookId, null, [2], null, 0], `/notebook/${notebookId}`);
      return Array.isArray(result?.[0]) ? notebookRow(result[0]) : null;
    },
    async listArtifacts(notebookId) {
      return unwrapRows(await rpc(RPC.listArtifacts, [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'], `/notebook/${notebookId}`)).filter(Array.isArray).map(artifactRow);
    },
    /** Ask Studio for one artifact; answers { artifactId, status }, or throws createFailure's error. */
    async createArtifact(notebookId, request) {
      let result;
      try {
        result = await rpc(RPC.createArtifact, studioCreateParams(notebookId, request), `/notebook/${notebookId}`, { mutation: true });
      } catch (error) { throw createFailure(error); }
      const artifactId = result?.[0]?.[0];
      if (typeof artifactId !== 'string' || !artifactId) throw createFailure(rejected(`Studio answered no artifact for ${request.kind}`));
      return { artifactId, status: ARTIFACT_STATUS[result[0][4]] ?? 'pending' };
    },
    async sourceHtml(notebookId, sourceId) {
      const result = await rpc(RPC.getSource, [[sourceId], [3], [3]], `/notebook/${notebookId}`);
      return typeof result?.[4]?.[1] === 'string' ? result[4][1] : null;
    },
    async interactiveHtml(notebookId, artifactId) {
      const result = await rpc(RPC.interactiveHtml, [artifactId], `/notebook/${notebookId}`);
      return typeof result?.[0]?.[9]?.[0] === 'string' ? result[0][9][0] : null;
    },
    async fetchMedia(mediaUrl, { method = 'GET', range } = {}) {
      if (new URL(mediaUrl).protocol !== 'https:' || !GOOGLE_HOST.test(new URL(mediaUrl).hostname)) throw new Error('Gemini Notebook media URL is not a Google host');
      if (now() - google.signedAt > refreshMs) await google.signIn();
      // A HEAD is asked as the first byte, so the provider still answers the total length.
      const response = await google.request(mediaUrl, { method: 'GET', headers: range ? { range } : method === 'HEAD' ? { range: 'bytes=0-0' } : {} });
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error(`Gemini Notebook media refused (HTTP ${response.status})`), { code: 'GEMINI_NOTEBOOK_AUTH_EXPIRED' });
      if ((response.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error('Gemini Notebook answered a sign-in page instead of media');
      return response;
    },
    rpc,
  };
}
