/** @module image-generation -- provider-agnostic domain algebra: callers, fallback, upscale, provenance. */
import { runWorkersAiModel } from "../cloudflare/workers-ai.mjs";

const CF_WORKER_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const DEFAULT_CF_WORKER_URL = "https://pod-image-generation-worker.561-group.workers.dev";
const DEFAULT_TARGET_WIDTH_PX = 2400;

/**
 * Call the deployed Cloudflare Workers AI image-generation worker.
 * @param {string} prompt
 * @param {{fetchImpl?:typeof fetch, workerUrl?:string, model?:string}} [opts]
 * @returns {Promise<{provider:string, model:string, base64:string, mimeType:string}>}
 * @throws {Error} on a non-ok response or a response missing imageBase64
 */
export async function callCloudflareWorkersAIImage(
  prompt,
  {
    fetchImpl = fetch,
    workerUrl = process.env.POD_IMAGE_WORKER_URL || DEFAULT_CF_WORKER_URL,
    model = CF_WORKER_MODEL,
  } = {}
) {
  const res = await fetchImpl(workerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, model }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`cloudflare workers ai request failed: HTTP ${res.status} ${bodyText.slice(0, 300)}`);
  }
  const body = await res.json();
  if (!body.imageBase64) throw new Error("cloudflare workers ai response carried no imageBase64");
  return {
    provider: "cloudflare-workers-ai",
    model: body.model ?? model,
    base64: body.imageBase64,
    mimeType: body.mimeType ?? "image/jpeg",
  };
}

/**
 * Call Workers AI FLUX directly on the account (CLOUDFLARE_ACCOUNT_ID,
 * API_KEY_CLOUDFLARE_WORKERS_AI). FLUX accepts a prompt of at most 2048 characters.
 */
export async function callWorkersAiImage(prompt, { fetchImpl = fetch, env = process.env, model = CF_WORKER_MODEL } = {}) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2048) throw new Error("image prompt must be 1-2048 characters");
  const result = await runWorkersAiModel(model, { prompt, steps: 4 }, { env, fetchImpl });
  if (typeof result.image !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(result.image)) throw new Error("Workers AI returned no valid base64 image");
  return { provider: "cloudflare-workers-ai", model, base64: result.image, mimeType: "image/jpeg" };
}

/** The deployed image worker first, then Workers AI directly on the account. */
export const DEFAULT_PROVIDERS = [callCloudflareWorkersAIImage, callWorkersAiImage];

/**
 * Run the ordered provider-fallback loop and return the winning provider's raw image.
 * @returns {Promise<{bytes: Buffer, provider: string, model: string, mimeType: string, providerArtifactId?: string}>}
 */
export async function generateImage(prompt, { providers = DEFAULT_PROVIDERS, fetchImpl, env } = {}) {
  const attempts = [];
  for (const call of providers) {
    try {
      const result = await call(prompt, { fetchImpl, ...(env ? { env } : {}) });
      const { base64, ...rest } = result;
      return { ...rest, bytes: Buffer.from(base64, "base64") };
    } catch (err) {
      attempts.push({ provider: call.name, error: err.message });
    }
  }
  throw new Error(`all image providers failed: ${JSON.stringify(attempts)}`);
}

/**
 * Re-encode a source raster as real PNG bytes, upscaling toward
 * targetWidth with sharp's Lanczos3 kernel when the source falls short.
 * Lazy-imports sharp so a caller without it installed degrades to a
 * pass-through instead of failing.
 * @param {Buffer} sourceBuffer
 * @param {number} [targetWidth]
 * @returns {Promise<{buffer:Buffer, upscaled:boolean, reason?:string, sourceWidth?:number, targetWidth?:number}>}
 */
export async function normalizeToPng(sourceBuffer, targetWidth = DEFAULT_TARGET_WIDTH_PX) {
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    return { buffer: sourceBuffer, upscaled: false, reason: "sharp not installed" };
  }
  const image = sharp(sourceBuffer);
  const meta = await image.metadata();
  if (meta.width && meta.width >= targetWidth) {
    const buffer = await image.png().toBuffer();
    return { buffer, upscaled: false, reason: "source already >= target width", sourceWidth: meta.width };
  }
  const buffer = await image.resize({ width: targetWidth, kernel: "lanczos3" }).png().toBuffer();
  return { buffer, upscaled: true, sourceWidth: meta.width, targetWidth };
}

/**
 * Run the ordered provider-fallback loop and normalize the winning
 * provider's raster to print-DPI PNG bytes.
 * @param {string} prompt
 * @param {{providers?:Array<Function>, fetchImpl?:typeof fetch, targetWidth?:number}} [opts]
 * @returns {Promise<{buffer:Buffer, provider:string, model:string, upscaled:boolean, sourceWidthPx:(number|null), targetWidthPx:number, upscaleNote:(string|null)}>}
 * @throws {Error} aggregating every provider's failure when all fail
 */
export async function generateImageWithFallback(
  prompt,
  { providers = DEFAULT_PROVIDERS, fetchImpl, targetWidth = DEFAULT_TARGET_WIDTH_PX } = {}
) {
  const result = await generateImage(prompt, { providers, fetchImpl });
  const rawBuffer = result.bytes;
  const { buffer, upscaled, sourceWidth, targetWidth: appliedTarget, reason } = await normalizeToPng(
    rawBuffer,
    targetWidth
  );

  return {
    buffer,
    provider: result.provider,
    model: result.model,
    upscaled,
    sourceWidthPx: sourceWidth ?? null,
    targetWidthPx: appliedTarget ?? targetWidth,
    upscaleNote: reason ?? null,
  };
}

/**
 * Build the provenance-sidecar object that travels with a generated
 * image file. Pure -- no I/O.
 * @param {{provider:string, model:string, promptUsed:string, generatedAt:string, sourceWidthPx?:(number|null), targetWidthPx:number, upscaled:boolean, upscaleNote?:(string|null), outputPath:string}} facts
 * @returns {object} the provenance sidecar, ready for JSON.stringify
 */
export function buildProvenance({
  provider,
  model,
  promptUsed,
  generatedAt,
  sourceWidthPx,
  targetWidthPx,
  upscaled,
  upscaleNote,
  outputPath,
}) {
  return {
    provider,
    model,
    promptUsed,
    generatedAt,
    sourceWidthPx: sourceWidthPx ?? null,
    outputTargetWidthPx: targetWidthPx,
    upscaled,
    upscaleNote: upscaleNote ?? null,
    outputPath,
  };
}
