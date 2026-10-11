/** Provider-neutral, reproducible speech synthesis for audiobook segments. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDirectEndpointProviderDescriptors } from "../dispatch/direct-endpoint-provider.mjs";
import { createProviderAccountEntitlementResolver, renewProviderAccountEntitlement } from "../dispatch/provider-account-entitlement.mjs";
import { currentProviderAvailability, observeProviderAvailability } from "../dispatch/provider-availability.mjs";

// Free-tier models first: gemini-2.5-pro-preview-tts has no free quota (429 on this key on
// 2026-09-28) and is tried last. A model whose quota is spent falls through to the next.
export const GEMINI_TTS_MODELS = Object.freeze([
  "gemini-3.8-flash-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-pro-preview-tts",
]);
export const CLOUDFLARE_TTS_MODEL = "@cf/myshell-ai/melotts";
const GEMINI_PROVIDER = "urn:ame:gemini-inference-team";
const CLOUDFLARE_PROVIDER = "urn:ame:cloudflare-workers-ai-inference-team";
const DEFAULT_CACHE = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "561-group", "computer-inference-engine", "speech-cache");

const VOICES = Object.freeze([
  ...[
    ["Achernar", ["calm", "soft"]], ["Aoede", ["breezy", "natural"]], ["Charon", ["informative", "steady"]],
    ["Fenrir", ["excitable", "energetic"]], ["Kore", ["firm", "clear"]], ["Leda", ["youthful", "clear"]],
    ["Orus", ["firm", "steady"]], ["Puck", ["upbeat", "expressive"]], ["Schedar", ["even", "natural"]],
    ["Sulafat", ["warm", "natural"]], ["Zephyr", ["bright", "natural"]],
    ["Callirrhoe", ["easy-going", "natural"]], ["Autonoe", ["bright", "natural"]], ["Enceladus", ["breathy", "natural"]],
    ["Iapetus", ["clear", "natural"]], ["Umbriel", ["easy-going", "natural"]], ["Algieba", ["smooth", "natural"]],
    ["Despina", ["smooth", "natural"]], ["Erinome", ["clear", "natural"]], ["Algenib", ["gravelly", "natural"]],
    ["Rasalgethi", ["informative", "natural"]], ["Laomedeia", ["upbeat", "natural"]], ["Alnilam", ["firm", "natural"]],
    ["Gacrux", ["mature", "natural"]], ["Pulcherrima", ["forward", "natural"]], ["Achird", ["friendly", "natural"]],
    ["Zubenelgenubi", ["casual", "natural"]], ["Vindemiatrix", ["gentle", "natural"]], ["Sadachbia", ["lively", "natural"]],
    ["Sadaltager", ["knowledgeable", "natural"]],
  ].map(([id, styles]) => Object.freeze({ id, provider: "google-gemini", languages: Object.freeze(["en-US", "en-GB", "cmn-CN", "fr-FR", "ja-JP"]), styles: Object.freeze(styles), documentation: "https://ai.google.dev/gemini-api/docs/speech-generation#voices" })),
]);

export class SpeechSynthesisObstruction extends Error {
  constructor(reason, facts = {}) {
    super(`speech synthesis obstructed: ${reason}`);
    this.name = "SpeechSynthesisObstruction";
    this.code = "SPEECH_SYNTHESIS_OBSTRUCTION";
    this.reason = reason;
    Object.assign(this, facts);
  }
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const regexp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Apply a script lexicon to a transient provider request, never to stored source. */
export function applyPronunciations(text, pronunciations = [], { ssml = false } = {}) {
  let rendered = ssml ? xml(text) : text;
  const methods = [];
  for (const entry of pronunciations) {
    if (!entry || typeof entry.term !== "string" || !entry.term) throw new TypeError("each pronunciation needs a term");
    const matcher = new RegExp(`\\b${regexp(ssml ? xml(entry.term) : entry.term)}\\b`, "giu");
    if (ssml && entry.ipa) {
      rendered = rendered.replace(matcher, (term) => `<phoneme alphabet="ipa" ph="${xml(entry.ipa)}">${xml(term)}</phoneme>`);
      methods.push({ term: entry.term, method: "ssml-phoneme", ipa: entry.ipa });
    } else if (entry.respelling) {
      rendered = rendered.replace(matcher, entry.respelling);
      methods.push({ term: entry.term, method: "respelling", respelling: entry.respelling });
    } else methods.push({ term: entry.term, method: "unchanged" });
  }
  return Object.freeze({ text: ssml ? `<speak>${rendered}</speak>` : rendered, methods: Object.freeze(methods) });
}

export function listVoices({ language, style, provider } = {}) {
  return VOICES.filter((voice) => (!language || voice.languages.some((item) => item.toLowerCase() === language.toLowerCase() || item.toLowerCase().startsWith(`${language.toLowerCase()}-`)))
    && (!style || voice.styles.some((item) => item.toLowerCase() === style.toLowerCase()))
    && (!provider || voice.provider === provider));
}

function wavFromPcm(pcm, sampleRate, channels = 1) {
  const header = Buffer.alloc(44), byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavRate(bytes) {
  return bytes.length >= 28 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE" ? bytes.readUInt32LE(24) : null;
}

async function ffmpegWav(bytes, inputExtension, sampleRate) {
  const directory = await mkdtemp(join(tmpdir(), "speech-synthesis-"));
  const input = join(directory, `input.${inputExtension}`), output = join(directory, "output.wav");
  try {
    await writeFile(input, bytes);
    await new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", ["-v", "error", "-y", "-i", input, "-ar", String(sampleRate), "-ac", "1", "-c:a", "pcm_s16le", output], { stdio: ["ignore", "ignore", "pipe"] });
      const errors = []; child.stderr.on("data", (chunk) => errors.push(chunk));
      child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg speech conversion failed: ${Buffer.concat(errors).toString().trim()}`)));
    });
    return await readFile(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function normalizeWav(bytes, mimeType, sourceRate, sampleRate) {
  const existingRate = wavRate(bytes);
  if (existingRate === sampleRate) return bytes;
  if (!existingRate && /audio\/(?:l16|pcm)/iu.test(mimeType)) {
    const wrapped = wavFromPcm(bytes, sourceRate || 24_000);
    return (sourceRate || 24_000) === sampleRate ? wrapped : ffmpegWav(wrapped, "wav", sampleRate);
  }
  const extension = existingRate ? "wav" : /mpeg|mp3/iu.test(mimeType) ? "mp3" : "audio";
  return ffmpegWav(bytes, extension, sampleRate);
}

function unavailable(provider) {
  const availability = currentProviderAvailability(provider);
  if (availability?.available === false) {
    const quotaSpent = availability.status === 429 || availability.remainingRequests === 0;
    throw new SpeechSynthesisObstruction(quotaSpent ? "provider-quota-spent" : "provider-unavailable", {
      provider, renewsAt: availability.renewsAt ?? availability.quota?.renewsAt ?? availability.backoffUntil ?? availability.unavailableUntil ?? availability.resetAt ?? null, availability,
    });
  }
}

function recordResponse(provider, response, now) {
  const observation = observeProviderAvailability(provider, response, { now });
  if (response.status === 429) throw new SpeechSynthesisObstruction("provider-quota-spent", {
    provider, renewsAt: observation?.renewsAt ?? observation?.quota?.renewsAt ?? observation?.backoffUntil ?? observation?.unavailableUntil ?? observation?.resetAt ?? null, availability: observation,
  });
}

function descriptorFor(provider, env) {
  const descriptor = loadDirectEndpointProviderDescriptors(env).find((item) => item.provider === provider);
  if (!descriptor?.zeroCashEligible || !descriptor.apiKey || !Array.isArray(descriptor.capabilityModels?.["text-to-speech"])) return null;
  return descriptor;
}

function admitExactSpeechModel(descriptor, endpoint, model) {
  const observation = renewProviderAccountEntitlement({ provider: descriptor.provider, endpoint, model, apiKey: descriptor.apiKey, policy: descriptor.zeroCashPolicy });
  const entitlement = observation && createProviderAccountEntitlementResolver([observation])({ provider: descriptor.provider, endpoint, model, apiKey: descriptor.apiKey });
  if (!entitlement) throw new SpeechSynthesisObstruction("zero-cash-entitlement-not-admitted", { provider: descriptor.provider, model });
  return entitlement;
}

function geminiBody({ text, voice, style, language, speakers }) {
  const direction = [style, language ? `Speak in ${language}.` : null].filter(Boolean).join(" ");
  const prompt = direction ? `${direction}\n\n${text}` : text;
  const speechConfig = speakers?.length
    ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map((speaker) => ({ speaker: speaker.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voice } } })) } }
    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
  speechConfig.languageCode = language;
  return { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig } };
}

async function callGemini(request, { descriptor, fetchImpl, now }) {
  unavailable(GEMINI_PROVIDER);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
  admitExactSpeechModel(descriptor, endpoint, request.model);
  const response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": descriptor.apiKey }, body: JSON.stringify(geminiBody(request)) });
  recordResponse(GEMINI_PROVIDER, response, now);
  if (!response.ok) throw new Error(`Gemini speech request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  const body = await response.json();
  const part = body?.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
  if (!part) throw new Error("Gemini speech response carried no inline audio");
  const mimeType = part.inlineData.mimeType ?? "audio/L16;rate=24000";
  const rate = Number(mimeType.match(/rate=(\d+)/iu)?.[1] ?? 24_000);
  return { bytes: Buffer.from(part.inlineData.data, "base64"), mimeType, sourceRate: rate };
}

async function callCloudflare(request, { descriptor, env, fetchImpl, now }) {
  unavailable(CLOUDFLARE_PROVIDER);
  if (!/^[a-f0-9]{32}$/iu.test(env.CLOUDFLARE_ACCOUNT_ID ?? "")) throw new SpeechSynthesisObstruction("provider-not-configured", { provider: CLOUDFLARE_PROVIDER });
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${request.model}`;
  admitExactSpeechModel(descriptor, endpoint, request.model);
  const response = await fetchImpl(endpoint, { method: "POST", headers: { authorization: `Bearer ${descriptor.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: request.text, lang: request.language }) });
  recordResponse(CLOUDFLARE_PROVIDER, response, now);
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!response.ok) throw new Error(`Cloudflare speech request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  if (contentType.startsWith("audio/")) return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: contentType };
  const body = await response.json();
  const encoded = body?.result?.audio ?? body?.audio ?? body?.result;
  if (typeof encoded !== "string") throw new Error("Cloudflare speech response carried no audio");
  return { bytes: Buffer.from(encoded, "base64"), mimeType: body?.result?.content_type ?? body?.content_type ?? "audio/mpeg" };
}

function validate(input) {
  if (!input || typeof input.text !== "string" || !input.text.trim()) throw new TypeError("speech text must be nonempty");
  if (input.format !== "wav") throw new TypeError('speech format must be "wav"');
  if (!Number.isSafeInteger(input.sampleRate) || input.sampleRate < 8_000 || input.sampleRate > 192_000) throw new TypeError("speech sampleRate must be an integer from 8000 through 192000");
  if (!input.language || typeof input.language !== "string") throw new TypeError("speech language is required");
  if (!input.voice || typeof input.voice !== "string") throw new TypeError("speech voice is required");
  if (input.speakers && (!Array.isArray(input.speakers) || input.speakers.length < 1 || input.speakers.length > 2 || input.speakers.some((item) => !item?.name || !item?.voice))) throw new TypeError("speech speakers must contain one or two named voices");
}

/** Synthesize one independently cached WAV segment. Extra options are dependency-injection seams. */
export async function synthesizeSpeech(input, options = {}) {
  const { env = process.env, fetchImpl = fetch, cacheDirectory = env.SPEECH_SYNTHESIS_CACHE_DIRECTORY || DEFAULT_CACHE, model, provider, now = () => new Date().toISOString() } = options;
  validate(input);
  const gemini = descriptorFor(GEMINI_PROVIDER, env), cloudflare = descriptorFor(CLOUDFLARE_PROVIDER, env);
  const selectedProvider = provider ?? (gemini ? "google-gemini" : cloudflare ? "cloudflare-workers-ai" : null);
  if (!selectedProvider) throw new SpeechSynthesisObstruction("no-zero-cash-speech-provider");
  const selectedDescriptor = selectedProvider === "google-gemini" ? gemini : cloudflare;
  const selectedModel = model ?? options.preferredModel ?? selectedDescriptor?.capabilityModels?.["text-to-speech"]?.[0] ?? (selectedProvider === "google-gemini" ? GEMINI_TTS_MODELS[0] : CLOUDFLARE_TTS_MODEL);
  const pronunciation = applyPronunciations(input.text, input.pronunciations, { ssml: selectedProvider === "google-cloud-text-to-speech" });
  const settings = { voice: input.voice, style: input.style ?? null, language: input.language, speakers: input.speakers ?? [], pronunciations: input.pronunciations ?? [], model: selectedModel, format: input.format, sampleRate: input.sampleRate };
  const textSha256 = digest(input.text), settingsSha256 = digest(canonical(settings));
  const cacheKey = digest(canonical({ text: input.text, ...settings }));
  const bytesPath = join(cacheDirectory, `${cacheKey}.wav`), metadataPath = join(cacheDirectory, `${cacheKey}.json`);
  try {
    const [bytes, stored] = await Promise.all([readFile(bytesPath), readFile(metadataPath, "utf8")]);
    return Object.freeze({ bytes, provenance: Object.freeze({ ...JSON.parse(stored), cached: true }) });
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const at = now();
  const request = { ...input, text: pronunciation.text, model: selectedModel };
  let raw;
  if (selectedProvider === "google-gemini") {
    if (!gemini) throw new SpeechSynthesisObstruction("provider-not-configured", { provider: GEMINI_PROVIDER });
    try { raw = await callGemini(request, { descriptor: gemini, fetchImpl, now }); }
    catch (error) {
      const models = selectedDescriptor?.capabilityModels?.["text-to-speech"] ?? GEMINI_TTS_MODELS;
      const next = model === undefined && error instanceof SpeechSynthesisObstruction && error.reason === "provider-quota-spent" ? models[models.indexOf(selectedModel) + 1] : undefined;
      const tried = [...(options.triedModels ?? []), selectedModel];
      if (next !== undefined && !tried.includes(next)) return synthesizeSpeech(input, { ...options, model: undefined, preferredModel: next, triedModels: tried });
      if (provider || !cloudflare) throw error;
      return synthesizeSpeech(input, { env, fetchImpl, cacheDirectory, provider: "cloudflare-workers-ai", now });
    }
  } else if (selectedProvider === "cloudflare-workers-ai") {
    if (!cloudflare) throw new SpeechSynthesisObstruction("provider-not-configured", { provider: CLOUDFLARE_PROVIDER });
    raw = await callCloudflare(request, { descriptor: cloudflare, env, fetchImpl, now });
  } else throw new SpeechSynthesisObstruction("unsupported-provider", { provider: selectedProvider });
  const bytes = await normalizeWav(raw.bytes, raw.mimeType, raw.sourceRate, input.sampleRate);
  const provenance = Object.freeze({ provider: selectedProvider, model: selectedModel, voice: input.voice, voices: Object.freeze((input.speakers ?? []).map(({ name, voice }) => ({ name, voice }))), style: input.style ?? null, language: input.language, textSha256, settingsSha256, synthesizedAt: at, cached: false, pronunciationMethods: pronunciation.methods, format: "wav", sampleRate: input.sampleRate, cacheKey });
  await mkdir(cacheDirectory, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  await Promise.all([writeFile(`${bytesPath}.${nonce}`, bytes), writeFile(`${metadataPath}.${nonce}`, `${JSON.stringify(provenance)}\n`)]);
  await Promise.all([rename(`${bytesPath}.${nonce}`, bytesPath), rename(`${metadataPath}.${nonce}`, metadataPath)]);
  return Object.freeze({ bytes, provenance });
}
