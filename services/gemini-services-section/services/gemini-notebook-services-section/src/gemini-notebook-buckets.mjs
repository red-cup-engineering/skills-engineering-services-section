/**
 * The Gemini Notebook library as S3-shaped buckets (the bucket set the HTTP
 * section's s3Resource serves), read live through gemini-notebook-client.
 *
 * Each notebook is one bucket, `<title-slug>--<notebook-uuid>` (the UUID is
 * what resolves; the slug only reads well). Its keys:
 * - `studio/<kind>/<title>.<ext>`: every completed Studio artifact with
 *   retrievable content (audio .m4a, video .mp4, infographic .png, slide deck
 *   .pdf and .pptx, report .md, quiz and flashcards .html, generated files);
 * - `sources/<file name>`: every uploaded source file Gemini Notebook kept.
 * A title shared by two objects of one kind gets ` (<id8>)` before its extension.
 *
 * Object metadata (x-amz-meta-*) carries the provider identity: notebook id and
 * title, artifact or source id, kind. Studio artifacts never change once
 * completed, so an object's ETag is its provider id and a probed length is kept
 * for the life of the process. Images are the exception to byte stability: the
 * image host signs a fresh C2PA manifest (`caBX` chunk) into every download, so
 * an image is fetched once and its bytes kept (up to imageCacheBytes), and its
 * size, ranges and digest agree for as long as they are kept.
 */
import { typeExtension } from '@red-cup-engineering/computer-serialized-content-engineering-services-section/services/http-data-services-section/src/media-type';
import { listKeys } from '@red-cup-engineering/http-services-section/s3';
import { openGeminiNotebook } from './gemini-notebook-client.mjs';

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
const slug = (title) => title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 25).replace(/-+$/u, '') || 'notebook';
// Map with at most `width` calls in flight: a listing probes each object once, and Google rate-limits bursts.
async function mapLimited(values, width, map) {
  const out = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, values.length) }, async () => {
    while (next < values.length) { const index = next++; out[index] = await map(values[index]); }
  }));
  return out;
}
const fileName = (title) => title.replace(/[\u0000-\u001f/\\]+/gu, '-').replace(/\s+/gu, ' ').trim().slice(0, 180) || 'untitled';

export const notebookBucketName = (notebook) => `${slug(notebook.title)}--${notebook.id}`;
export const notebookIdOfBucket = (bucket) => bucket.match(UUID)?.[1] ?? null;

/** Every object of one notebook: [{ key, mediaType, url?, text?, interactive?, etag, lastModified, metadata }]. */
export function notebookObjects(notebook, artifacts) {
  const objects = [];
  const base = { 'notebook-id': notebook.id, 'notebook-title': encodeURIComponent(notebook.title) };
  for (const artifact of artifacts) {
    if (artifact.status !== 'completed') continue;
    for (const media of artifact.media) {
      const name = fileName(artifact.title);
      const extension = artifact.kind === 'file' && /\.[a-z0-9]{1,5}$/iu.test(name) ? '' : `.${typeExtension(media.mediaType)}`;
      objects.push({ stem: `studio/${artifact.kind}/${name}`, extension, id: artifact.id, mediaType: media.mediaType, url: media.url, text: media.text, interactive: media.interactive, lastModified: artifact.createdAt ?? notebook.createdAt, metadata: { ...base, 'artifact-id': artifact.id, kind: artifact.kind } });
    }
  }
  for (const source of notebook.sources) {
    if (!source.downloadUrl) continue;
    const named = new URL(source.downloadUrl).searchParams.get('filename') ?? source.title;
    objects.push({ stem: `sources/${fileName(named).replace(/\.[^.]+$/u, '')}`, extension: /\.[^.]+$/u.exec(fileName(named))?.[0] ?? '', id: source.id, mediaType: null, url: source.downloadUrl, lastModified: source.createdAt ?? notebook.createdAt, metadata: { ...base, 'source-id': source.id, kind: 'source' } });
  }
  const seen = new Map();
  for (const object of objects) seen.set(object.stem + object.extension, (seen.get(object.stem + object.extension) ?? 0) + 1);
  return objects.map(({ stem, extension, ...object }) => ({ ...object, key: seen.get(stem + extension) > 1 ? `${stem} (${object.id.slice(0, 8)})${extension}` : stem + extension, etag: `"gemini-notebook-${object.id}${extension}"` }));
}

/** The bucket set over one signed-in client; open with createGeminiNotebookBuckets(). Library listings are kept for ttlMs. */
export function geminiNotebookBuckets(client, { ttlMs = 60_000, now = () => Date.now(), imageCacheBytes = 512 * 1024 ** 2 } = {}) {
  const cache = new Map();
  const lengths = new Map();
  const images = new Map();
  const imageBytes = async (url) => {
    if (images.has(url)) { const bytes = await images.get(url); images.delete(url); images.set(url, Promise.resolve(bytes)); return bytes; }
    const fetched = client.fetchMedia(url).then(async (response) => Buffer.from(await response.arrayBuffer()));
    images.set(url, fetched);
    fetched.catch(() => images.delete(url));
    const bytes = await fetched;
    let total = 0;
    for (const [key, value] of [...images].reverse()) { const held = await value.catch(() => Buffer.alloc(0)); total += held.length; if (total > imageCacheBytes && key !== url) images.delete(key); }
    return bytes;
  };
  const isImage = (object) => object.url && object.mediaType?.startsWith('image/');
  const remembered = (name, load) => {
    const hit = cache.get(name);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = load();
    cache.set(name, { at: now(), value });
    value.catch(() => cache.delete(name));
    return value;
  };
  const notebooks = () => remembered('library', () => client.listNotebooks());
  const objects = (notebookId) => remembered(`notebook:${notebookId}`, async () => {
    const [notebook, artifacts] = await Promise.all([client.getNotebook(notebookId), client.listArtifacts(notebookId)]);
    return notebook === null ? null : notebookObjects(notebook, artifacts);
  });
  async function find(bucket, key) {
    const notebookId = notebookIdOfBucket(bucket);
    const all = notebookId === null ? null : await objects(notebookId);
    return all?.find((object) => object.key === key) ?? null;
  }
  async function inline(object, notebookId) {
    if (object.text !== undefined) return Buffer.from(object.text, 'utf8');
    if (object.interactive) return Buffer.from(await client.interactiveHtml(notebookId, object.metadata['artifact-id']) ?? '', 'utf8');
    return null;
  }
  // The length and media type of a URL-backed object, asked once as its first byte.
  async function probe(object) {
    if (isImage(object)) return { size: (await imageBytes(object.url)).length, mediaType: object.mediaType };
    if (lengths.has(object.url)) return lengths.get(object.url);
    const response = await client.fetchMedia(object.url, { range: 'bytes=0-0' });
    await response.body?.cancel();
    const total = Number(response.headers.get('content-range')?.split('/')[1] ?? response.headers.get('content-length'));
    const probed = { size: Number.isSafeInteger(total) ? total : undefined, mediaType: object.mediaType ?? response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
    lengths.set(object.url, probed);
    return probed;
  }
  async function head(bucket, key) {
    const object = await find(bucket, key);
    if (!object) return null;
    const notebookId = notebookIdOfBucket(bucket);
    const bytes = isImage(object) ? await imageBytes(object.url) : object.url ? null : await inline(object, notebookId);
    const { size, mediaType } = bytes === null ? await probe(object) : { size: bytes.length, mediaType: object.mediaType };
    return { object, bytes, size, contentType: mediaType, etag: object.etag, lastModified: object.lastModified ? new Date(object.lastModified) : undefined, metadata: object.metadata };
  }
  return Object.freeze({
    async listBuckets() {
      return (await notebooks()).map((notebook) => ({ name: notebookBucketName(notebook), title: notebook.title, createdAt: notebook.createdAt ? new Date(notebook.createdAt) : new Date(0) }));
    },
    async listObjects(bucket, options = {}) {
      const notebookId = notebookIdOfBucket(bucket);
      const all = notebookId === null ? null : await objects(notebookId);
      if (all === null) return null;
      const sized = await mapLimited(all, 6, async (object) => ({ key: object.key, etag: object.etag, lastModified: object.lastModified ? new Date(object.lastModified) : undefined, size: object.url ? (await probe(object)).size : (await inline(object, notebookId)).length }));
      return listKeys(sized, options);
    },
    async headObject(bucket, key) {
      const found = await head(bucket, key);
      if (!found) return null;
      const { object: _object, bytes: _bytes, ...meta } = found;
      return meta;
    },
    async getObject(bucket, key, { range } = {}) {
      const found = await head(bucket, key);
      if (!found) return null;
      const { object, bytes, ...meta } = found;
      if (bytes !== null) return { ...meta, body: bytes };
      const response = await client.fetchMedia(object.url, range ? { range: `bytes=${range.start}-${range.end}` } : {});
      return { ...meta, body: response.body, ...(range && response.status === 206 ? { range } : {}) };
    },
  });
}

/** The bucket set over the notebooklm login (see readStorageState). */
export async function createGeminiNotebookBuckets(options = {}) {
  return geminiNotebookBuckets(await openGeminiNotebook(options), options);
}
