import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createNotebookAdapter } from './gemini-notebook-cli.mjs';
import { notebookVideoPayload } from './notebook-video-carrier.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A normal point at which a report-to-video run can continue later. */
export class NotebookVideoBlocked extends Error {
  constructor(status, checkpoint, message = status, providerCode = null) {
    super(message);
    this.name = 'NotebookVideoBlocked';
    this.type = 'NotebookVideoBlocked';
    this.status = status;
    this.checkpoint = checkpoint;
    this.providerCode = providerCode;
  }
}

/**
 * Advance a report to a Gemini Notebook video, retaining progress in the caller's
 * existing checkpoint carrier. The caller owns storage and scheduling; this
 * function owns Gemini Notebook source, generation, polling and download effects.
 *
 * A successful step returns the updated checkpoint. A pending or uncertain
 * step returns NotebookVideoBlocked with that same checkpoint for the caller
 * to persist and resume later. A provider-confirmed failure returns
 * `video-failed`; whether and how to try again is the caller's policy.
 *
 * `admitGeneration` runs immediately before each video submission, once the
 * source is ready: the caller holds account capacity there, and anything but
 * `true` blocks as `awaiting-capacity` without submitting. A submission the
 * provider answered with RATE_LIMITED may still have created an artifact, so
 * it is reconciled first; once `rateLimitedReconcileMs` passes with no exact
 * match it is a refusal and the request may be submitted again.
 */
export async function advanceNotebookVideo({
  reportPath,
  outputPath,
  title,
  sourceTitle,
  video = {},
  notebookId,
  checkpoint = {},
  onCheckpoint,
  onRecord = () => {},
  notebook = createNotebookAdapter(),
  admitGeneration = null,
  rateLimitedReconcileMs = 30 * 60_000,
  now = () => Date.now(),
} = {}) {
  if (typeof onCheckpoint !== 'function') throw new TypeError('onCheckpoint must persist each Gemini Notebook effect boundary');
  for (const [key, value] of Object.entries({ reportPath, outputPath, title, sourceTitle })) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${key} is required`);
  }
  if (!notebookId && checkpoint.notebookId) notebookId = checkpoint.notebookId;
  if (!notebookId) throw new TypeError('notebookId is required');
  const reportBytes = readFileSync(reportPath);
  if (!statSync(reportPath).isFile() || reportBytes.length === 0) throw new TypeError('reportPath must be a nonempty file');
  const reportSha256 = digest(reportBytes);
  const videoRequestSha256 = digest(Buffer.from(JSON.stringify({
    reportSha256,
    notebookId,
    sourceTitle,
    title,
    video: { format: video.format ?? 'explainer', style: video.style ?? 'auto', language: video.language ?? 'en', prompt: video.prompt ?? '' },
  })));
  let state = structuredClone(checkpoint);
  const save = async (updates) => {
    state = { ...state, ...updates, notebookId, sourceTitle, reportSha256, videoRequestSha256, updatedAt: new Date().toISOString() };
    await onCheckpoint(structuredClone(state));
  };
  const blocked = (status, message, providerCode = null) => new NotebookVideoBlocked(status, structuredClone(state), message, providerCode);
  const generationInputs = {
    sourceIds: state.sourceId ? [state.sourceId] : [],
    prompt: [video.prompt, title].filter(Boolean).join('\n'),
    title,
    format: video.format ?? 'explainer',
    style: video.style ?? 'auto',
    language: video.language ?? 'en',
  };
  const reconcile = () => typeof notebook.findVideo === 'function' && generationInputs.sourceIds.length
    ? notebook.findVideo({ notebookId, ...generationInputs, startedAt: state.generationAttempt?.startedAt }) : Promise.resolve(null);

  if (state.reportSha256 && state.reportSha256 !== reportSha256) return blocked('report-changed', 'The report changed after Gemini Notebook received it');
  if (state.notebookId && state.notebookId !== notebookId) return blocked('notebook-changed', 'The checkpoint belongs to a different notebook');
  if (state.sourceTitle && state.sourceTitle !== sourceTitle) return blocked('source-title-changed', 'The checkpoint belongs to a different report source');
  if (state.videoRequestSha256 && state.videoRequestSha256 !== videoRequestSha256) return blocked('video-request-changed', 'Video settings changed after production began');

  // A verified received artifact belongs to its consumer now. Reopening its
  // generation service adds no evidence about these bytes and can strand publication.
  if (state.artifactId && state.downloadedArtifactId === state.artifactId && state.downloadSha256 && existsSync(outputPath)) {
    const payload=notebookVideoPayload(readFileSync(outputPath), { videoFormat: video.format ?? 'explainer', videoStyle: video.style ?? 'auto', videoLanguage: video.language ?? 'en' }, state.artifactId);
    if (!payload) return blocked('video-download-invalid', 'The retained output is not a valid MP4 carrier');
    if (payload.sha256 !== state.downloadSha256) return blocked('video-download-corrupt', 'The recorded video bytes changed after download');
    return structuredClone(state);
  }

  const authentication=notebook.authenticationAdmission?.();
  if(authentication)return blocked('authentication-pending',authentication.reason,'NOTEBOOK_AUTHENTICATION_PENDING');

  if (!state.artifactId) {
    if (state.generationStarted) {
      try {
        const recovered = await reconcile();
        const attempt = state.generationAttempt;
        if (!recovered && attempt?.providerCode === 'RATE_LIMITED' && now() - Date.parse(attempt.startedAt) >= rateLimitedReconcileMs) {
          await save({ generationStarted: false, stage: 'source-ready' });
          await onRecord({ step: 'video', outcome: 'refused', providerCode: 'RATE_LIMITED', reconciledAfterMs: rateLimitedReconcileMs });
          return blocked('video-refused', 'Gemini Notebook refused the video for quota; no artifact appeared', 'RATE_LIMITED');
        }
        if (!recovered) return blocked('needs-reconcile', 'Video submission may have reached Gemini Notebook; no exact source and prompt match is visible yet', attempt?.providerCode ?? null);
        await save({ artifactId: recovered.artifactId, stage: 'generating', lastError: null });
        await onRecord({ step: 'video', outcome: 'recovered-exact-submission', artifactId: recovered.artifactId });
      } catch (error) {
        return blocked('needs-reconcile', `Exact video reconciliation failed: ${error.message}`);
      }
    }
    if (!state.artifactId) {
    try {
      const source = await notebook.ensureSource({
        notebookId,
        reportPath,
        title: sourceTitle,
        checkpoint: state.sourceSubmission,
        onCheckpoint: async (sourceSubmission) => save({ sourceSubmission }),
      });
      const previousSourceId = state.sourceId;
      await save({
        sourceId: source.sourceId,
        sourceOwned: state.sourceOwned === true || source.created === true,
        stage: source.ready ? 'source-ready' : 'source-processing',
      });
      if (source.sourceId !== previousSourceId) await onRecord({ step: 'source', outcome: source.created ? 'uploaded' : 'found', sourceId: source.sourceId });
      if (!source.ready) return blocked('source-processing', 'Gemini Notebook is still processing the report');
    } catch (error) {
      await onRecord({ step: 'source', outcome: error.ambiguous ? 'uncertain' : 'failed', message: error.message });
      return blocked(error.ambiguous ? 'needs-reconcile' : 'source-failed', error.message);
    }

    generationInputs.sourceIds = [state.sourceId];
    if (admitGeneration) {
      const admission = await admitGeneration({ notebookId, format: generationInputs.format, title });
      if (admission !== true) return blocked('awaiting-capacity', admission?.message ?? 'No account capacity is available for this video yet');
    }
    const videoAttempts = (Number.isInteger(state.videoAttempts) ? state.videoAttempts : 0) + 1;
    await save({ videoAttempts, generationStarted: true, generationAttempt: { number: videoAttempts, startedAt: new Date().toISOString(), ...generationInputs }, stage: 'submitting-video' });
    await onRecord({ step: 'video', outcome: 'submitting', format: video.format ?? 'explainer' });
    try {
      const artifact = await notebook.generateVideo({
        ...video,
        notebookId,
        sourceIds: [state.sourceId],
        title,
        prompt: [video.prompt, title].filter(Boolean).join('\n'),
      });
      await save({ artifactId: artifact.artifactId, stage: 'generating' });
      await onRecord({ step: 'video', outcome: 'submitted', artifactId: artifact.artifactId });
    } catch (error) {
      let recovered = null;
      try { recovered = await reconcile(); } catch { /* Keep the uncertain checkpoint for later read-only reconciliation. */ }
      if (recovered) {
        await save({ artifactId: recovered.artifactId, stage: 'generating', lastError: null });
        await onRecord({ step: 'video', outcome: 'recovered-exact-submission', artifactId: recovered.artifactId });
      } else if (error.ambiguous === false) {
        await save({ generationStarted: false, generationAttempt: { ...state.generationAttempt, providerCode: error.providerCode ?? error.code ?? 'UNKNOWN' } });
      } else if (error.providerCode) {
        await save({ generationAttempt: { ...state.generationAttempt, providerCode: error.providerCode } });
      }
      if (recovered) {
        // Continue through the normal status/download path below.
      } else {
      await onRecord({ step: 'video', outcome: error.ambiguous === false ? 'refused' : 'uncertain', message: error.message, ...(error.providerCode ? { providerCode: error.providerCode } : {}) });
      return blocked(error.ambiguous === false ? 'video-refused' : 'needs-reconcile', error.message, error.providerCode ?? null);
      }
    }
    }
  }

  let artifact;
  try {
    artifact = await notebook.getVideo({ notebookId, artifactId: state.artifactId });
  } catch (error) {
    return blocked('video-observation-failed', error.message);
  }
  if (artifact.status === 'failed') {
    const failedArtifacts = [...new Set([...(state.failedArtifacts ?? []), state.artifactId])];
    if (state.stage !== 'video-failed') await onRecord({ step: 'video', outcome: 'failed', artifactId: state.artifactId });
    await save({ stage: 'video-failed', failedArtifacts });
    return blocked('video-failed', 'Gemini Notebook reported that video generation failed');
  }
  if (artifact.status !== 'completed') return blocked('video-processing', `Gemini Notebook video is ${artifact.status}`);

  if (state.downloadedArtifactId && state.downloadedArtifactId !== state.artifactId) {
    return blocked('video-download-conflict', 'The output path is already bound to a different artifact');
  }
  if (existsSync(outputPath) && !state.downloadedArtifactId) {
    const existing = readFileSync(outputPath);
    const payload = notebookVideoPayload(existing, { videoFormat: video.format ?? 'explainer', videoStyle: video.style ?? 'auto', videoLanguage: video.language ?? 'en' }, state.artifactId);
    if (!payload) return blocked('video-download-invalid', 'The existing output is not a valid MP4 carrier');
    await save({ downloadedArtifactId: state.artifactId, downloadedBytes: payload.byteLength, downloadSha256: payload.sha256, stage: 'video-downloaded' });
    await onRecord({ step: 'download', outcome: 'recovered-existing', bytes: payload.byteLength, artifactId: state.artifactId });
  } else if (!existsSync(outputPath)) {
    try {
      const downloaded = await notebook.downloadVideo({ notebookId, artifactId: state.artifactId, outputPath });
      const bytes = readFileSync(outputPath);
      const payload = notebookVideoPayload(bytes, { videoFormat: video.format ?? 'explainer', videoStyle: video.style ?? 'auto', videoLanguage: video.language ?? 'en' }, state.artifactId);
      if (!payload) return blocked('video-download-invalid', 'Gemini Notebook returned an invalid MP4 carrier');
      if (state.downloadSha256 && payload.sha256 !== state.downloadSha256) return blocked('video-download-changed', 'The provider returned different bytes for the recorded artifact');
      await save({ downloadedArtifactId: state.artifactId, downloadedBytes: downloaded.bytes ?? payload.byteLength, downloadSha256: payload.sha256, stage: 'video-downloaded' });
      await onRecord({ step: 'download', outcome: 'downloaded', bytes: downloaded.bytes ?? bytes.length, artifactId: state.artifactId });
    } catch (error) {
      return blocked('video-download-failed', error.message);
    }
  }
  const retainedVideo = readFileSync(outputPath);
  const retainedPayload = notebookVideoPayload(retainedVideo, { videoFormat: video.format ?? 'explainer', videoStyle: video.style ?? 'auto', videoLanguage: video.language ?? 'en' }, state.artifactId);
  if (!retainedPayload) return blocked('video-download-invalid', 'The retained output is not a valid MP4 carrier');
  const retainedSha256 = retainedPayload.sha256;
  if (state.downloadSha256 && retainedSha256 !== state.downloadSha256) return blocked('video-download-corrupt', 'The recorded video bytes changed after download');
  if (!state.downloadSha256) await save({ downloadedArtifactId: state.artifactId, downloadedBytes: retainedPayload.byteLength, downloadSha256: retainedSha256, stage: 'video-downloaded' });

  if (state.sourceOwned && state.sourceId && !state.reportSourceRemoved) {
    try {
      await notebook.removeSources({ notebookId, sourceIds: [state.sourceId] });
      await save({ reportSourceRemoved: true });
    } catch (error) {
      await onRecord({step:'source',outcome:'cleanup-deferred',sourceId:state.sourceId});
      // Retiring an owned input source must not withhold the received artifact.
    }
  }
  return structuredClone(state);
}

/** Adopt one exact video after an uncertain submission; never infer by title. */
export async function adoptNotebookVideo({ checkpoint, artifactId, onCheckpoint, onRecord = () => {}, notebook = createNotebookAdapter() } = {}) {
  if (!checkpoint?.generationStarted || checkpoint.artifactId) throw new Error('Only an uncertain submission without an artifact can be adopted');
  if (typeof artifactId !== 'string' || !artifactId.trim()) throw new TypeError('artifactId is required');
  if (typeof onCheckpoint !== 'function') throw new TypeError('onCheckpoint is required');
  const artifact = await notebook.getVideo({ notebookId: checkpoint.notebookId, artifactId });
  if (artifact.status === 'failed') throw new Error('Cannot adopt a failed artifact');
  const next = { ...checkpoint, artifactId, stage: 'generating', lastError: null, updatedAt: new Date().toISOString() };
  await onCheckpoint(structuredClone(next));
  await onRecord({ step: 'video', outcome: 'adopted', artifactId });
  return { artifact, checkpoint: next };
}

/**
 * Reset only a failed video so the report source can be submitted again. The
 * next submission is a new request: it may carry different video settings.
 */
export async function retryNotebookVideo({ checkpoint, onCheckpoint, onRecord = () => {} } = {}) {
  if (checkpoint?.stage !== 'video-failed') throw new Error('Only a failed video can be retried');
  if (typeof onCheckpoint !== 'function') throw new TypeError('onCheckpoint is required');
  const { artifactId, generationStarted, generationAttempt, downloadedArtifactId, downloadedBytes, downloadSha256, ...kept } = checkpoint;
  const next = {
    ...kept,
    stage: 'retrying',
    artifactId: null,
    generationStarted: false,
    generationAttempt: null,
    downloadedArtifactId: null,
    downloadedBytes: null,
    downloadSha256: null,
    videoRequestSha256: null,
    reportSourceRemoved: false,
    failedArtifacts: [...new Set([...(checkpoint.failedArtifacts ?? []), artifactId].filter(Boolean))],
    updatedAt: new Date().toISOString(),
  };
  await onCheckpoint(structuredClone(next));
  await onRecord({ step: 'video', outcome: 'retry', failedArtifact: artifactId });
  return next;
}
