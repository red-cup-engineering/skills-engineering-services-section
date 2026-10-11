import { sha256Digest } from '@red-cup-engineering/cryptographic-data-service/integrity';

/** Validate and describe the exact MP4 carrier used by Gemini Notebook video flows. */
export function notebookVideoPayload(bytes, request, artifactId) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') return null;
  return {
    format: 'mp4',
    mediaType: 'video/mp4',
    byteLength: bytes.length,
    sha256: sha256Digest(bytes),
    videoFormat: request.videoFormat,
    videoStyle: request.videoStyle,
    language: request.videoLanguage,
    providerArtifactId: artifactId,
  };
}
