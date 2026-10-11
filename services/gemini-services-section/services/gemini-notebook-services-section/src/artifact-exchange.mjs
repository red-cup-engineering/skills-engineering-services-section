#!/usr/bin/env node
import { createHttpServer } from "@red-cup-engineering/http-services-section/node-server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCloudflareR2ImmutableContentCustody } from "@red-cup-engineering/cloudflare-r2-services-section/immutable-content-custody";
import { IMMUTABLE_CONTENT_REFERENCE_PROFILE, immutableContentKey } from "@red-cup-engineering/immutable-content-custody-service";
import { isNiUri, makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { sha256Digest } from "@red-cup-engineering/cryptographic-data-service/integrity";

export const GEMINI_NOTEBOOK_MAX_VIDEO_BYTES = 512 * 1024 * 1024;

function immutableReference(value, payload) {
  if (value?.profile !== IMMUTABLE_CONTENT_REFERENCE_PROFILE || !isNiUri(value.ni)
    || value.key !== immutableContentKey(value.ni) || value.byteLength !== payload.byteLength
    || value.mediaType !== payload.mediaType) throw new TypeError("artifact capability requires one exact immutable custody reference");
  return Object.freeze({ profile: value.profile, ni: value.ni, key: value.key, byteLength: value.byteLength, mediaType: value.mediaType });
}

function capabilityPayload(operationId, payload) {
  if (payload?.format !== "mp4" || payload?.mediaType !== "video/mp4" || !/^sha256:[a-f0-9]{64}$/u.test(payload.sha256 ?? "") || !Number.isSafeInteger(payload.byteLength) || payload.byteLength < 1 || payload.byteLength > GEMINI_NOTEBOOK_MAX_VIDEO_BYTES) throw new TypeError("artifact capability requires exact bounded MP4 payload identity");
  if (!isNiUri(operationId ?? "")) throw new TypeError("artifact capability requires one exact operation identity");
  return Object.freeze({ version: 1, operationId, artifact: Object.freeze({ immutableReference: immutableReference(payload.immutableReference, payload), sha256: payload.sha256, byteLength: payload.byteLength, mediaType: payload.mediaType }) });
}

export function readGeminiNotebookArtifactCapabilityKey(options = {}) {
  if (options.capabilityKey instanceof Uint8Array) {
    const key = Buffer.from(options.capabilityKey);
    if (key.length < 32) throw new TypeError("Gemini Notebook artifact capability key must contain at least 32 bytes");
    return key;
  }
  const source = options.capabilityKeyPath ?? options.environment?.GEMINI_NOTEBOOK_ARTIFACT_CAPABILITY_KEY ?? process.env.GEMINI_NOTEBOOK_ARTIFACT_CAPABILITY_KEY;
  if (typeof source !== "string" || source.trim() === "") throw new TypeError("GEMINI_NOTEBOOK_ARTIFACT_CAPABILITY_KEY must name one private key file");
  const path = resolve(source);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) throw new TypeError("Gemini Notebook artifact capability key must be one private regular file");
  const key = readFileSync(path);
  if (key.length < 32) throw new TypeError("Gemini Notebook artifact capability key must contain at least 32 bytes");
  return key;
}

export function issueGeminiNotebookArtifactCapability({ operationId, payload, ...options }) {
  const terms = capabilityPayload(operationId, payload);
  const encoded = Buffer.from(JSON.stringify(terms)).toString("base64url");
  const signature = createHmac("sha256", readGeminiNotebookArtifactCapabilityKey(options)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyArtifactCapability(token, options) {
  const [encoded, offered, ...extra] = token.split(".");
  if (!encoded || !offered || extra.length !== 0 || !/^[A-Za-z0-9_-]{43}$/u.test(offered)) return null;
  const expected = createHmac("sha256", readGeminiNotebookArtifactCapabilityKey(options)).update(encoded).digest();
  let supplied;
  try { supplied = Buffer.from(offered, "base64url"); } catch { return null; }
  if (supplied.toString("base64url") !== offered || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let value;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return null; }
  try { return capabilityPayload(value.operationId, { format: "mp4", ...value.artifact }); }
  catch { return null; }
}

function parseRange(value, length) {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (match === null || (match[1] === "" && match[2] === "")) return false;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, length - suffix);
    end = length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? length - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= length) return false;
    end = Math.min(end, length - 1);
  }
  return Object.freeze({ start, end });
}

/** Serve one already-authorized immutable provider artifact without owning a socket. */
export async function respondGeminiNotebookArtifactRequest(request, options = {}) {
  if (!(request instanceof Request)) throw new TypeError("Gemini Notebook artifact exchange requires a Request");
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (token.length < 32) return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } });
  const capability = verifyArtifactCapability(token, options);
  if (capability === null) return new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } });
  const match = new URL(request.url).pathname.match(/^\/artifacts\/([a-f0-9]{64})\.mp4$/u);
  if (match === null) return new Response(null, { status: 404 });
  if (capability.artifact.sha256 !== `sha256:${match[1]}`) return new Response(null, { status: 404 });
  const terms = capability.artifact;
  const custody = options.custody ?? createCloudflareR2ImmutableContentCustody({ environment: options.environment ?? process.env, maximumBytes: GEMINI_NOTEBOOK_MAX_VIDEO_BYTES });
  let retained;
  try { retained = await custody.get(terms.immutableReference); }
  catch { return new Response(null, { status: 409 }); }
  if (retained === null) return new Response(null, { status: 404 });
  const bytes = Buffer.from(retained.bytes ?? []);
  if (retained.ni !== terms.immutableReference.ni || makeNiUri(bytes) !== terms.immutableReference.ni
    || sha256Digest(bytes) !== terms.sha256 || bytes.length !== terms.byteLength
    || retained.mediaType !== terms.mediaType || terms.mediaType !== "video/mp4") return new Response(null, { status: 409 });
  const range = parseRange(request.headers.get("range"), bytes.length);
  if (range === false) return new Response(null, { status: 416, headers: { "content-range": `bytes */${bytes.length}` } });
  const body = range === null ? bytes : bytes.subarray(range.start, range.end + 1);
  const headers = {
    "content-type": "video/mp4",
    "content-length": String(body.length),
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
    ...(range === null ? {} : { "content-range": `bytes ${range.start}-${range.end}/${bytes.length}` }),
  };
  return new Response(request.method === "HEAD" ? null : body, { status: range === null ? 200 : 206, headers });
}

async function writeWebResponse(response, outgoing) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) return outgoing.end();
  for await (const chunk of response.body) outgoing.write(chunk);
  outgoing.end();
}

export async function serveGeminiNotebookArtifactExchange(options = {}) {
  readGeminiNotebookArtifactCapabilityKey(options);
  const custody = options.custody ?? createCloudflareR2ImmutableContentCustody({ environment: options.environment ?? process.env, maximumBytes: GEMINI_NOTEBOOK_MAX_VIDEO_BYTES });
  const host = options.host ?? process.env.GEMINI_NOTEBOOK_ARTIFACT_HOST ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = createHttpServer({ handle: async (incoming, outgoing) => {
    try {
      const request = new Request(`http://${incoming.headers.host ?? `${host}:${port}`}${incoming.url}`, { method: incoming.method, headers: incoming.headers });
      await writeWebResponse(await respondGeminiNotebookArtifactRequest(request, { ...options, custody }), outgoing);
    } catch {
      outgoing.writeHead(500).end();
    }
  } });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, host, accept); });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  serveGeminiNotebookArtifactExchange({
    port: Number(process.env.GEMINI_NOTEBOOK_ARTIFACT_PORT ?? 8082),
    host: process.env.GEMINI_NOTEBOOK_ARTIFACT_HOST ?? "127.0.0.1",
  }).then((server) => process.stdout.write(`${JSON.stringify(server.address())}\n`));
}
