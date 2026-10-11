import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPronunciations, listVoices, SpeechSynthesisObstruction, synthesizeSpeech } from "../../src/audio/speech-synthesis.mjs";
import { clearProviderAvailabilityObservations } from "../../src/dispatch/provider-availability.mjs";

const ENV = Object.freeze({ API_KEY_GOOGLE_GEMINI: "fixture-gemini-key" });
const PCM = Buffer.from([0, 0, 1, 0, 255, 255, 2, 0]);
const WAV = Buffer.alloc(44 + PCM.length);
WAV.write("RIFF", 0); WAV.writeUInt32LE(36 + PCM.length, 4); WAV.write("WAVEfmt ", 8); WAV.writeUInt32LE(16, 16);
WAV.writeUInt16LE(1, 20); WAV.writeUInt16LE(1, 22); WAV.writeUInt32LE(24_000, 24); WAV.writeUInt32LE(48_000, 28);
WAV.writeUInt16LE(2, 32); WAV.writeUInt16LE(16, 34); WAV.write("data", 36); WAV.writeUInt32LE(PCM.length, 40); PCM.copy(WAV, 44);
const response = (status = 200, headers = {}) => status === 200
  ? Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: PCM.toString("base64") } }] } }] }, { status, headers })
  : new Response("quota", { status, headers });

function assertWav(bytes, rate = 24_000) {
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString(), "WAVE");
  assert.equal(bytes.readUInt32LE(24), rate);
  assert.deepEqual(bytes.subarray(44), PCM);
}

async function cache(t) {
  const directory = await mkdtemp(join(tmpdir(), "speech-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("Gemini single voice request carries style and wraps returned PCM as WAV", async (t) => {
  clearProviderAvailabilityObservations();
  let call;
  const result = await synthesizeSpeech({ text: "The lake was iron gray.", voice: "Aoede", style: "Read warmly, with restrained tension.", language: "en-US", format: "wav", sampleRate: 24_000 }, {
    env: ENV, cacheDirectory: await cache(t), now: () => "2026-09-27T12:00:00.000Z",
    fetchImpl: async (url, options) => { call = { url, options, body: JSON.parse(options.body) }; return response(); },
  });
  assert.match(call.url, /gemini-3\.8-flash-tts:generateContent/u);
  assert.equal(call.options.headers["x-goog-api-key"], ENV.API_KEY_GOOGLE_GEMINI);
  assert.match(call.body.contents[0].parts[0].text, /restrained tension/u);
  assert.equal(call.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Aoede");
  assertWav(result.bytes);
  assert.equal(result.provenance.provider, "google-gemini");
  assert.equal(result.provenance.cached, false);
});

test("Gemini two-speaker request is one multi-speaker call", async (t) => {
  clearProviderAvailabilityObservations();
  let body;
  const speakers = [{ name: "June", voice: "Kore" }, { name: "Anders", voice: "Charon" }];
  const result = await synthesizeSpeech({ text: "June: You came.\nAnders: I said I would.", voice: "Kore", speakers, language: "en-US", format: "wav", sampleRate: 24_000 }, {
    env: ENV, cacheDirectory: await cache(t), fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return response(); },
  });
  assert.deepEqual(body.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs, [
    { speaker: "June", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    { speaker: "Anders", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
  ]);
  assertWav(result.bytes);
  assert.deepEqual(result.provenance.voices, speakers);
});

test("pronunciations use SSML phonemes where supported and transient respelling otherwise", () => {
  assert.equal(applyPronunciations("Serve jook.", [{ term: "jook", ipa: "tʃʊk", respelling: "juke" }], { ssml: true }).text, '<speak>Serve <phoneme alphabet="ipa" ph="tʃʊk">jook</phoneme>.</speak>');
  assert.equal(applyPronunciations("Serve jook.", [{ term: "jook", ipa: "tʃʊk", respelling: "juke" }]).text, "Serve juke.");
});

test("an identical segment is returned byte-for-byte from content-addressed cache", async (t) => {
  clearProviderAvailabilityObservations();
  let calls = 0;
  const input = { text: "She made jook. I ate it.", voice: "Aoede", language: "en-US", pronunciations: [{ term: "jook", respelling: "juke" }], format: "wav", sampleRate: 24_000 };
  const options = { env: ENV, cacheDirectory: await cache(t), fetchImpl: async () => { calls++; return response(); }, now: () => "2026-09-27T12:00:00.000Z" };
  const first = await synthesizeSpeech(input, options), second = await synthesizeSpeech(input, options);
  assert.equal(calls, 1);
  assert.deepEqual(second.bytes, first.bytes);
  assert.equal(first.provenance.cached, false);
  assert.deepEqual(second.provenance, { ...first.provenance, cached: true });
});

test("a Gemini transport failure falls back to admitted Cloudflare speech and sends only transient respelling", async (t) => {
  clearProviderAvailabilityObservations();
  const env = { ...ENV, API_KEY_CLOUDFLARE_WORKERS_AI: "fixture-cloudflare-key", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" };
  const calls = [];
  const result = await synthesizeSpeech({ text: "Serve jook.", voice: "Aoede", language: "en-US", pronunciations: [{ term: "jook", respelling: "juke" }], format: "wav", sampleRate: 24_000 }, {
    env, cacheDirectory: await cache(t), fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.includes("generativelanguage.googleapis.com")) throw new Error("Gemini temporarily unreachable");
      return new Response(WAV, { headers: { "content-type": "audio/wav" } });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.prompt, "Serve juke.");
  assert.equal(result.provenance.provider, "cloudflare-workers-ai");
  assert.deepEqual(result.provenance.pronunciationMethods, [{ term: "jook", method: "respelling", respelling: "juke" }]);
  assertWav(result.bytes);
});

test("provider quota exhaustion is a typed obstruction carrying renewal time", async (t) => {
  clearProviderAvailabilityObservations();
  const renewsAt = "2026-09-28T00:00:00.000Z";
  const cacheDirectory = await cache(t);
  await assert.rejects(() => synthesizeSpeech({ text: "Wait.", voice: "Aoede", language: "en-US", format: "wav", sampleRate: 24_000 }, {
    env: ENV, cacheDirectory, now: () => "2026-09-27T12:00:00.000Z", fetchImpl: async () => response(429, { "retry-after": renewsAt }),
  }), (error) => error instanceof SpeechSynthesisObstruction && error.reason === "provider-quota-spent" && error.renewsAt === renewsAt);
});

test("listVoices filters provider-documented voices by language and style", () => {
  const voices = listVoices({ language: "en-US", style: "warm" });
  assert.deepEqual(voices.map(({ id }) => id), ["Sulafat"]);
  assert.ok(voices.every(({ documentation }) => documentation.startsWith("https://")));
  assert.ok(voices.every((voice) => !("gender" in voice)));
});
