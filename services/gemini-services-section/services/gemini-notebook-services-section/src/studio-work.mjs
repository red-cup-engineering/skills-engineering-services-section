/**
 * One Studio artifact, of any kind STUDIO_KINDS names, made for a consumer against the account's
 * Gemini Notebook allowance and kept as a file.
 *
 * The account's allowance is one compute pool every Studio kind draws on (allowances.mjs), so every
 * submission goes through the inference engine's allowance ledger:
 *
 *   capacity     reads the provider's current and weekly compute usage.
 *   submission   createArtifact asks Studio. An artifact id binds the work and settles the hold as
 *                spent under the artifact's Studio source (the same spend a Studio sync records);
 *                a refusal settles it void. A quota answer or a lost connection may still have made
 *                the artifact, so the work is reconciled against Studio's rows (same kind, same
 *                sources, made after the submission) before anything is asked again; once
 *                `reconcileMs` passes with nothing there, the quota answer is a refusal the
 *                allowance learns from, and anything else is void;
 *   output       a completed artifact's media is fetched once into `outputPath`, checked by its
 *                leading bytes, and kept with its sha-256.
 *
 * advanceStudioWork is safe to call again: the caller persists each checkpoint it is handed, and a
 * step that cannot go on now returns StudioWorkBlocked with the checkpoint to resume from.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {admitNotebookQuota} from './quota.mjs';
import {studioKind} from './allowances.mjs';
import { studioRequest } from './gemini-notebook-client.mjs';

const MINUTE = 60_000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// When the current window turns; a rolling meter clears continuously and has no turn to wait for.
const turnOf = (reading) => reading?.meters.filter(({ law }) => law !== 'sliding').map(({ resetsAt }) => resetsAt).filter(Boolean).sort()[0] ?? null;

/** A normal point at which Studio work continues later; `status` says why. */
export class StudioWorkBlocked extends Error {
  constructor(status, checkpoint, message = status, providerCode = null) {
    super(message);
    this.name = 'StudioWorkBlocked';
    this.status = status;
    this.checkpoint = checkpoint;
    this.providerCode = providerCode;
  }
}

// What each kind's file must begin with: Studio's media URLs answer a sign-in page when they fail.
const CARRIERS = {
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  'video/mp4': (bytes) => bytes.subarray(4, 8).toString('latin1') === 'ftyp',
  'audio/mp4': (bytes) => bytes.subarray(4, 8).toString('latin1') === 'ftyp',
};

/** The Studio rows a submission made at `startedAt` could have become: same kind and sources, made after it, not already claimed. */
export function submissionCandidates(rows, { kind, sourceIds, startedAt, exclude = [], slackMs = 2 * MINUTE }) {
  const wanted = [...sourceIds].sort().join(',');
  const from = Date.parse(startedAt) - slackMs;
  return rows.filter((row) => row.kind === kind && [...row.sourceIds].sort().join(',') === wanted && Date.parse(row.createdAt) >= from && !exclude.includes(row.id));
}

/**
 * Advance one Studio artifact as far as it can go now.
 *
 * @param {object} work
 * @param {object} work.client       an opened Gemini Notebook client (openGeminiNotebook)
 * @param {string} work.notebookId
 * @param {object} work.request      { kind, sourceIds, language?, instructions?, options? } (studioRequest)
 * @param {string} work.outputPath   where the artifact's media is kept
 * @param {string} work.principal    who the capacity is held for
 * @param {string} work.reference    the work's own name, kept on its hold
 * @param {object} [work.checkpoint] the last checkpoint this work was handed
 * @param {Function} work.onCheckpoint persists each checkpoint
 * @param {Function} [work.onRecord] receives one entry per effect
 * @param {string[]} [work.exclude]  artifact ids already bound to other work, never adopted here
 * @returns {Promise<object|StudioWorkBlocked>} the completed checkpoint, or why it waits
 */
export async function advanceStudioWork({ client, notebookId, request, outputPath, principal, reference, checkpoint = {}, onCheckpoint, onRecord = () => {}, exclude = [],  reconcileMs = 30 * MINUTE, now = () => new Date() }) {
  if (typeof onCheckpoint !== 'function') throw new TypeError('onCheckpoint must persist each Studio effect boundary');
  const checked = studioRequest(request);
  const kind = studioKind(checked.kind, checked.options.format);
  const requestSha256 = sha256(JSON.stringify({ notebookId, ...checked }));
  let state = structuredClone(checkpoint);
  const save = async (updates) => { state = { ...state, ...updates, notebookId, requestSha256, updatedAt: now().toISOString() }; await onCheckpoint(structuredClone(state)); };
  const blocked = (status, message, providerCode = null) => new StudioWorkBlocked(status, structuredClone(state), message, providerCode);

  if (state.requestSha256 && state.requestSha256 !== requestSha256) {
    if (state.artifactId || state.attempt) return blocked('request-changed', 'The Studio request changed after it was submitted');
    state = {};
  }

  if (!state.artifactId) {
    if (state.attempt) {
      // The last submission may have reached Studio: read its rows before asking again.
      let candidates;
      try {
        candidates = submissionCandidates(await client.listArtifacts(notebookId), { kind: checked.kind, sourceIds: checked.sourceIds, startedAt: state.attempt.startedAt, exclude: [...exclude, ...(state.failedArtifacts ?? [])] });
      } catch (error) { return blocked('needs-reconcile', `Studio rows could not be read: ${error.message}`, state.attempt.providerCode ?? null); }
      if (candidates.length > 1) return blocked('needs-reconcile', `${candidates.length} Studio ${checked.kind} rows could be this submission; adopt one by id`);
      if (candidates.length === 1) {
        const [row] = candidates;
        await save({ artifactId: row.id, attempt: null, holdId: null, stage: 'generating' });
        await onRecord({ step: checked.kind, outcome: 'recovered-submission', artifactId: row.id });
      } else if (now().getTime() - Date.parse(state.attempt.startedAt) < reconcileMs) {
        return blocked('needs-reconcile', 'The submission may have reached Studio; no row is there yet', state.attempt.providerCode ?? null);
      } else {
        const outcome = state.attempt.providerCode === 'RATE_LIMITED' ? 'refused' : 'void';
        await save({ attempt: null, holdId: null, stage: 'refused' });
        await onRecord({ step: checked.kind, outcome, reconciledAfterMs: reconcileMs, providerCode: state.attempt?.providerCode ?? null });
        return blocked('refused', `Studio made no ${checked.kind} for the submission`, outcome === 'refused' ? 'RATE_LIMITED' : null);
      }
    }
    if (!state.artifactId) {
      const admission = await admitNotebookQuota();
      if (!admission.admitted) {
        if (state.holdId) await save({ holdId: null });
        return blocked('awaiting-capacity', admission.message);
      }
      await onRecord({step:checked.kind,outcome:'native-quota-observed',usage:admission.usage});
      await save({ holdId: null, attempt: { startedAt: now().toISOString() }, stage: 'submitting' });
      try {
        const created = await client.createArtifact(notebookId, checked);
        await save({ artifactId: created.artifactId, attempt: null, holdId: null, stage: 'generating' });
        await onRecord({ step: checked.kind, outcome: 'submitted', artifactId: created.artifactId });
      } catch (error) {
        if (error.ambiguous === false) {
            await save({ attempt: null, holdId: null, stage: 'refused' });
          await onRecord({ step: checked.kind, outcome: 'refused', message: error.message, providerCode: error.providerCode ?? null });
          return blocked('refused', error.message, error.providerCode ?? null);
        }
        await save({ attempt: { ...state.attempt, providerCode: error.providerCode ?? null } });
        await onRecord({ step: checked.kind, outcome: 'uncertain', message: error.message, providerCode: error.providerCode ?? null });
        return blocked('needs-reconcile', error.message, error.providerCode ?? null);
      }
    }
  }

  if (!(state.output && existsSync(outputPath))) {
    let row;
    try { row = (await client.listArtifacts(notebookId)).find((candidate) => candidate.id === state.artifactId); }
    catch (error) { return blocked('observation-failed', error.message); }
    if (!row) return blocked('artifact-missing', `Studio no longer lists ${checked.kind} ${state.artifactId}`);
    if (row.status === 'failed') {
      const failedArtifacts = [...new Set([...(state.failedArtifacts ?? []), state.artifactId])];
      await save({ artifactId: null, failedArtifacts, stage: 'failed' });
      await onRecord({ step: checked.kind, outcome: 'failed', artifactId: row.id });
      return blocked('failed', `Studio reported that the ${checked.kind} failed`);
    }
    if (row.status !== 'completed') return blocked('processing', `Studio ${checked.kind} is ${row.status}`);
    const medium = row.media.find((item) => item.url && CARRIERS[item.mediaType]);
    if (!medium) return blocked('media-missing', `Studio ${checked.kind} ${row.id} carries no media this work keeps`);
    let bytes;
    try {
      const response = await client.fetchMedia(medium.url);
      if (!response.ok) return blocked('download-failed', `Studio media answered HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) { return blocked('download-failed', error.message); }
    if (!CARRIERS[medium.mediaType](bytes)) return blocked('download-invalid', `Studio media is not ${medium.mediaType}`);
    const digest = sha256(bytes);
    if (state.output && state.output.sha256 !== digest) return blocked('download-changed', 'Studio returned different bytes for the recorded artifact');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(`${outputPath}.part`, bytes);
    renameSync(`${outputPath}.part`, outputPath);
    await save({ output: { mediaType: medium.mediaType, bytes: bytes.length, sha256: digest }, title: row.title, stage: 'completed' });
    await onRecord({ step: checked.kind, outcome: 'downloaded', artifactId: row.id, mediaType: medium.mediaType, bytes: bytes.length, sha256: digest });
  }
  if (sha256(readFileSync(outputPath)) !== state.output.sha256) return blocked('output-changed', 'The kept file differs from what Studio returned');
  return structuredClone(state);
}
