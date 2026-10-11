import { createHash } from "node:crypto";
import { generateImage } from "../image/image-generation.mjs";
import { synthesizeSpeech } from "../audio/speech-synthesis.mjs";
import { jsonValueId } from "../dispatch/sen-carrier.mjs";

function receipt({ provider, model, capability, bytes, mimeType, observedAt = new Date().toISOString() }) {
  const digest = createHash("sha256").update(bytes).digest("base64url");
  const output = Object.freeze({ identity: `ni:///sha-256;${digest}`, bytes: bytes.length, mimeType });
  const body = Object.freeze({
    type: "MediaInferenceReceipt",
    disposition: "fulfilled",
    provider,
    model,
    capability,
    observedAt,
    output,
  });
  return Object.freeze({ id: jsonValueId(body), ...body });
}

/** @deprecated Use synthesizeSpeech from audio/speech-synthesis. */
export async function generateSpeech(text, options = {}) {
  const result = await synthesizeSpeech({ text, voice: options.voice ?? "Aoede", language: options.language ?? "en-US", format: "wav", sampleRate: options.sampleRate ?? 24_000 }, options);
  return Object.freeze({ ...result, receipt: receipt({ provider: result.provenance.provider, model: result.provenance.model, capability: "text-to-speech", bytes: result.bytes, mimeType: "audio/wav" }) });
}

/** Existing image fallback, now closed by the same inference receipt shape. */
export async function generateImageWithReceipt(prompt, options = {}) {
  const result = await generateImage(prompt, options);
  return Object.freeze({
    bytes: result.bytes,
    receipt: receipt({ provider: result.provider === "cloudflare-workers-ai" ? "urn:ame:cloudflare-workers-ai-inference-team" : result.provider, model: result.model, capability: "image-generation", bytes: result.bytes, mimeType: result.mimeType }),
  });
}
