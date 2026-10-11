/**
 * What the 561 Group's Gemini Notebook account may make, as one allowance of organizing's allowance
 * algebra (content/config/allowances.json), held against in the inference engine's allowance ledger.
 *
 * Gemini Notebook meters compute: every Studio kind draws on one pool, refreshed by a five-hour
 * window opened at first use, under a weekly limit. Work is admitted while the window is not
 * exhausted (`admits: open`). Prices are in explainers. The founder's estimate (a cinematic and a
 * bit, or a short and two explainers and a bit) enters as fits/exceeds priors. Refusals and probes
 * narrow it. Uploaded files are not generations and are not metered.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitAllowance } from '@red-cup-engineering/organizing/enterprise';
import { SECTION_ROOT } from './gemini-notebook-cli.mjs';

export const ALLOWANCES_PATH = join(SECTION_ROOT, 'content', 'config', 'allowances.json');

/**
 * The account's allowances, each with `statedAt`: Studio history before the statement was under
 * other limits and is not evidence about these.
 */
export function loadNotebookAllowances(path = ALLOWANCES_PATH) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (document?.type !== 'GeminiNotebookAllowances' || !Array.isArray(document.allowances)) throw new TypeError('Gemini Notebook allowances are invalid');
  const statedAt = new Date(document.statedAt).toISOString();
  return document.allowances.map((entry) => Object.freeze({
    ...admitAllowance({ account: document.account, because: document.because, draws: 'every', ...entry }),
    provider: document.provider, statedAt,
  }));
}

/** The kind of work a video overview of `format` is. */
export const videoCapability = (format) => `video-overview:${format}`;

/** The kind of work a Studio artifact of `kind` is: a video by its format, any other artifact by its kind. */
export const studioKind = (kind, videoFormat) => (kind === 'video' ? videoCapability(videoFormat ?? 'unknown') : kind);

/** The allowance that meters video overviews of `format`. */
export function notebookVideoAllowance(format = 'explainer', allowances = loadNotebookAllowances()) {
  const allowance = allowances.find((candidate) => videoCapability(format) in candidate.costs);
  if (!allowance) throw new Error(`No Gemini Notebook allowance meters ${videoCapability(format)}`);
  return allowance;
}

/** The ledger source of a Studio artifact, so a producer's record and a Studio sync are one spend. */
export const studioSource = (notebookId, artifactId) => `gemini-notebook:${notebookId}/${artifactId}`;
