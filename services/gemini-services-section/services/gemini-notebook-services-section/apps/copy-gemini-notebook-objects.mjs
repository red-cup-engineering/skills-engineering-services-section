#!/usr/bin/env node
/**
 * Copy Gemini Notebook objects into our own storage, as notes of the forest.
 *
 *   copy-gemini-notebook-objects <bucket>[/<key or prefix>] --into <content directory> [--media-root <dir>] [--dry-run]
 *
 * <bucket> and keys are the ones serve-gemini-notebook-buckets lists. Every object
 * under the prefix is copied:
 * - Markdown (Studio reports, generated .md files) becomes the note itself;
 * - anything else (video, audio, images, PDFs, slide decks) is put, exactly, in
 *   the ni-addressed media store (LSPACE_MEDIA_ROOT, else <LSPACE_STATE_DIR or
 *   ~/.local/state/561-group/l-space>/media), and the note embeds it by its name,
 *   `![title](ni:///sha-256;…?ct=<type>)`, which L-Space serves at /.well-known/ni/.
 * Each note says where it came from (notebook, provider id). A note already
 * carrying the same content is left alone, so a copy can be run again.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { createImmutableContentCustody } from '@red-cup-engineering/immutable-content-custody-service';
import { createFileStore } from '@red-cup-engineering/immutable-content-custody-service/file-store';
import { makeNiUri, niUriWithContentType } from '@red-cup-engineering/uri-services-section/ni-uri';
import { createGeminiNotebookBuckets } from '../src/gemini-notebook-buckets.mjs';

const MAXIMUM_BYTES = 1024 ** 3;

export function mediaRoot(env = process.env) {
  return env.LSPACE_MEDIA_ROOT ?? join(env.LSPACE_STATE_DIR ?? join(homedir(), '.local', 'state', '561-group', 'l-space'), 'media');
}

const yamlString = (value) => JSON.stringify(String(value));
const noteName = (key) => key.split('/').pop().replace(/\.[^.]+$/u, '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'untitled';

/** The note for one copied object: its frontmatter and body. */
export function mediaNote({ title, notebookTitle, meta, ni, mediaType, byteLength, markdown }) {
  const provider = meta.metadata ?? {};
  const origin = `gemini-notebook:${provider['notebook-id']}/${provider['artifact-id'] ?? provider['source-id']}`;
  const kind = provider.kind ?? 'media';
  const date = (meta.lastModified instanceof Date ? meta.lastModified : new Date(meta.lastModified ?? Date.now())).toISOString().slice(0, 10);
  const front = [
    `title: ${yamlString(title)}`,
    `description: ${yamlString(`${kind === 'source' ? 'A source' : `A ${kind.replace('-', ' ')}`} from the Gemini Notebook “${notebookTitle}”.`)}`,
    `type: ${markdown === undefined ? kind : 'prose'}`,
    ...(markdown === undefined ? [`media: ${yamlString(niUriWithContentType(ni, mediaType))}`, `media-type: ${mediaType}`, `byte-length: ${byteLength}`] : [`content: ${yamlString(ni)}`]),
    `date-created: ${date}`,
    `derived-from: ${yamlString(origin)}`,
  ];
  const body = markdown ?? `![${title.replace(/[[\]]/gu, '')}](${niUriWithContentType(ni, mediaType)})\n`;
  return `---\n${front.join('\n')}\n---\n\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

async function bytesOf(found) {
  if (found.body instanceof Uint8Array) return Buffer.from(found.body);
  return Buffer.from(await new Response(found.body).arrayBuffer());
}

/** Copy every object of bucket under prefix; returns one row per object. */
export async function copyGeminiNotebookObjects({ bucket, prefix = '', into, media = mediaRoot(), dryRun = false, buckets }) {
  const source = buckets ?? await createGeminiNotebookBuckets();
  const listed = await source.listObjects(bucket, { prefix });
  if (listed === null) throw new Error(`no notebook bucket ${bucket}`);
  const notebookTitle = (await source.listBuckets()).find((entry) => entry.name === bucket)?.title ?? bucket;
  const custody = createImmutableContentCustody({ store: createFileStore(media), maximumBytes: MAXIMUM_BYTES });
  const directory = resolve(into);
  // Notes already on disk, read once; names claimed by this run join them as it goes.
  const onDisk = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => ({ name, text: readFileSync(join(directory, name), 'utf8') })) : [];
  const existing = onDisk.map(({ name }) => name);
  const rows = [];
  for (const { key } of listed.keys) {
    const found = await source.getObject(bucket, key);
    const bytes = await bytesOf(found);
    const ni = makeNiUri(bytes);
    const mediaType = found.contentType ?? 'application/octet-stream';
    const markdown = /^text\/(?:x-)?markdown\b/u.test(mediaType) ? bytes.toString('utf8') : undefined;
    const title = key.split('/').pop().replace(/\.[^.]+$/u, '');
    const already = onDisk.find(({ text }) => text.includes(ni));
    if (already) { rows.push({ key, ni, note: join(directory, already.name), outcome: 'present' }); continue; }
    let name = `${noteName(key)}.md`;
    for (let n = 2; existing.includes(name); n += 1) name = `${noteName(key)}-${n}.md`;
    existing.push(name);
    const note = join(directory, name);
    if (!dryRun) {
      if (markdown === undefined) await custody.put({ ni, bytes, mediaType });
      mkdirSync(directory, { recursive: true });
      writeFileSync(note, mediaNote({ title, notebookTitle, meta: found, ni, mediaType, byteLength: bytes.length, markdown }), { flag: 'wx' });
    }
    rows.push({ key, ni, mediaType, byteLength: bytes.length, note, outcome: dryRun ? 'would-copy' : 'copied' });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('copy-gemini-notebook-objects')) {
  const args = process.argv.slice(2);
  const option = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args.splice(at, 2)[1]; };
  const into = option('--into'), media = option('--media-root') ?? mediaRoot();
  const dryRun = args.includes('--dry-run') && args.splice(args.indexOf('--dry-run'), 1).length > 0;
  const [target] = args;
  if (!target || !into) {
    process.stderr.write('usage: copy-gemini-notebook-objects <bucket>[/<key or prefix>] --into <content directory> [--media-root <dir>] [--dry-run]\n');
    process.exit(2);
  }
  const slash = target.indexOf('/');
  const rows = await copyGeminiNotebookObjects({ bucket: slash === -1 ? target : target.slice(0, slash), prefix: slash === -1 ? '' : target.slice(slash + 1), into, media, dryRun });
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
}
