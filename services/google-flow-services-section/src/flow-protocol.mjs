/**
 * Google Flow's generation calls, as its web application makes them (read off the wire,
 * 2026-10-02): what each call's arguments are, and what its answer says. Pure: no I/O.
 *
 * Every generation is made inside a project, under a client context naming Flow's tool (22,
 * "PINHOLE") and the project, and carrying a reCAPTCHA Enterprise token minted for the call's
 * action. Request and batch ids are minted by the caller, uppercase UUIDs as the page mints them.
 *
 * Video is asynchronous: the submission answers the new balance and one media id per clip, then
 * the status call is asked until each clip is done. Images are synchronous: the answer carries
 * each image's signed URL. Signed URLs are fetched without cookies and lapse within hours.
 */

export const RPC = Object.freeze({
  credits: 'nzlxg', // VideoFxService.GetCredits
  models: 'HTrJv', // FlowService.GetModels
  modelStatuses: 'yBhWQ', // FlowService.ListModelStatuses
  generateVideoText: 'YhhmEf', // VideoFxService.BatchAsyncGenerateVideoText
  videoStatus: 'jwpduf', // VideoFxService.BatchCheckAsyncVideoGenerationStatus
  generateImages: 'ogiZ0b', // FlowService.BatchGenerateImages
  media: 'as29s', // FlowService.GetMedia
  createProject: 'jHPbke', // AiSandbox.CreateProject
  listProjects: 'okjlg', // FlowService.ListProjects
});

/** The reCAPTCHA action each generation is minted for, as the page names it. */
export const ACTION = Object.freeze({ video: 'VIDEO_GENERATION', image: 'IMAGE_GENERATION' });

/** Flow's site key, read from the page's WIZ_global_data (field xZbWve). */
export const RECAPTCHA_SITE_KEY_FIELD = 'xZbWve';
const TOOL = 22;

export const IMAGE_ASPECT = Object.freeze({ '1:1': 1, '9:16': 2, '16:9': 3, '3:4': 4, '4:3': 5 });
export const VIDEO_ASPECT = Object.freeze({ '16:9': 2, '9:16': 1 });

/** Video status codes: a clip is waiting, being made, or done. Any other code is a failure. */
const VIDEO_STATUS = Object.freeze({ 6: 'pending', 2: 'running', 3: 'done' });

const clientContext = ({ projectId, token }) => [null, TOOL, null, null, null, projectId, null, null, null, null, [token, 1]];

function requireAspect(table, aspect, what) {
  if (!(aspect in table)) throw new TypeError(`Flow ${what} aspect must be one of ${Object.keys(table).join(', ')}, not ${aspect}`);
  return table[aspect];
}

/**
 * The model key a text-to-video generation goes under. A Veo family's portrait key is its
 * landscape key with `_portrait` (Flow's own catalog lists both); other families take the aspect
 * as an argument only.
 */
export function videoModelKey(model, aspect) {
  return aspect === '9:16' && model.startsWith('veo_') && !model.endsWith('_portrait') && !model.includes('_lite') ? `${model}_portrait` : model;
}

/** Arguments of a text-to-video submission: `count` clips of one prompt. */
export function videoTextRequest({ prompt, model, aspect = '16:9', count = 1, projectId, token, newId }) {
  const code = requireAspect(VIDEO_ASPECT, aspect, 'video');
  const key = videoModelKey(model, aspect);
  const one = () => [[null, null, [[[prompt]]]], key, code, null, [null, null, null, null, newId(), newId()]];
  return [Array.from({ length: count }, one), clientContext({ projectId, token }), [newId(), 2]];
}

/** Arguments of an image generation: `count` images of one prompt, each with its own seed. */
export function imageRequest({ prompt, model, aspect = '1:1', count = 1, projectId, token, newId, seed }) {
  const code = requireAspect(IMAGE_ASPECT, aspect, 'image');
  const context = clientContext({ projectId, token });
  const one = () => [null, null, null, seed(), code, model, null, context, [[[prompt]]], null, null, null, newId(), newId()];
  return [null, Array.from({ length: count }, one), 1, context, [newId()]];
}

/**
 * An answer that is not what its call makes, kept for its error: its structure with every string
 * longer than a short code, and every URL, replaced by its length, so a signed URL or token never
 * reaches a log.
 */
export const answerShape = (answer) => JSON.stringify(answer ?? null, (_, value) => (typeof value === 'string' && (value.length > 40 || /^https?:/u.test(value)) ? `<${value.length}>` : value)).slice(0, 600);

const unanswered = (message, answer) => Object.assign(new TypeError(`${message}: ${answerShape(answer)}`), { answer: answerShape(answer) });

const instant = (pair) => (Array.isArray(pair) && Number.isFinite(pair[0]) ? new Date(pair[0] * 1000 + Math.floor((pair[1] ?? 0) / 1e6)).toISOString() : null);

/** A video media row (status answer, submission answer, or media answer) read. */
export function videoRow(row) {
  const detail = row[5] ?? [];
  const code = detail[8]?.[0] ?? null;
  const spec = row[7]?.[0] ?? [];
  return Object.freeze({
    mediaId: row[0],
    projectId: row[1],
    workflowId: row[2],
    createdAt: instant(detail[0]),
    prompt: detail[1] ?? null,
    status: VIDEO_STATUS[code] ?? 'failed',
    statusCode: code,
    model: spec[12] ?? null,
    seconds: row[7]?.[1]?.[2]?.[0] ?? null,
    bytes: detail[13] ?? null,
    thumbnailUrl: detail[10] || null,
    videoUrl: spec[8] || null,
  });
}

/** A submission's answer: the balance after it and each clip's media row. */
export function videoSubmission(answer) {
  if (!Array.isArray(answer) || !Array.isArray(answer[3])) throw unanswered('Flow video submission answered no media', answer);
  return Object.freeze({ balance: answer[1] ?? null, clips: Object.freeze(answer[3].map(videoRow)) });
}

export const videoStatusRequest = (mediaIds) => [null, null, mediaIds.map((id) => [id])];

/** A status answer's rows; a clip not yet known answers none ("Media not found"). */
export const videoStatuses = (answer) => Object.freeze((answer?.[2] ?? []).map(videoRow));

export const mediaRequest = (mediaId) => [mediaId];

/** An image generation's answer: each image's media id, signed URL and size. */
export function imageAnswer(answer) {
  if (!Array.isArray(answer?.[0])) throw unanswered('Flow image generation answered no images', answer);
  return Object.freeze(answer[0].map((row) => {
    const made = row[6]?.[0] ?? [];
    const [width, height] = row[6]?.[2] ?? [];
    return Object.freeze({ mediaId: row[0], workflowId: row[2], seed: made[1] ?? null, prompt: made[7] ?? null, imageUrl: made[13] ?? null, width: width ?? null, height: height ?? null });
  }));
}

/**
 * Flow's model catalog (GetModels), read for the account's plan `tier`: each model key's family,
 * length and credit price. A model the tier cannot use has no price and is left out. Sections:
 * [4] video families, [5] image families, [7] speech.
 */
export function modelCatalog(answer, tier) {
  const root = answer?.[0];
  if (!Array.isArray(root)) throw new TypeError('Flow model catalog has no families');
  const models = [];
  for (const [section, medium] of [[4, 'video'], [5, 'image'], [7, 'speech']]) {
    for (const [family, keys] of root[section] ?? []) {
      for (const model of keys ?? []) {
        const price = (model[4] ?? []).find(([t]) => t === tier)?.[1]?.[0]?.[1];
        if (!Number.isFinite(price)) continue;
        models.push(Object.freeze({ key: model[0], family, medium, credits: price, seconds: medium === 'video' && Number.isFinite(model[16]) ? model[16] : null }));
      }
    }
  }
  return Object.freeze(models);
}
