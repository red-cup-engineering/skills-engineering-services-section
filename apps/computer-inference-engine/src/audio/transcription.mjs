/**
 * Speech transcription of audio prepared from a media file through Workers AI Whisper.
 * Timestamps are offsets into the original media, taken from Whisper's segments.
 */
import { prepareAudioChunks } from "@red-cup-engineering/computer-data-engineering-services-section/media/audio";
import { runWorkersAiModel } from "../cloudflare/workers-ai.mjs";

export const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
const stamp = (seconds) => new Date(Math.floor(seconds) * 1000).toISOString().slice(11, 19);

/**
 * Transcribe one media file into timestamped paragraphs ("[hh:mm:ss] text").
 * @param {string} path
 * @param {{maxSeconds?: number, env?: object, fetchImpl?: typeof fetch, model?: string}} [options]
 */
export async function transcribeMedia(path, { maxSeconds = 3600, env = process.env, fetchImpl = fetch, model = TRANSCRIPTION_MODEL } = {}) {
  const { chunks } = await prepareAudioChunks(path, { maxSeconds });
  const paragraphs = [];
  for (const chunk of chunks) {
    const result = await runWorkersAiModel(model, { audio: chunk.bytes.toString("base64"), task: "transcribe", vad_filter: true, condition_on_previous_text: false }, { env, fetchImpl, responseLimit: 4 * 1024 * 1024 });
    if (typeof result.text !== "string") throw new Error(`Invalid transcription at ${stamp(chunk.offsetSeconds)}`);
    if (!result.text.trim()) continue;
    const segments = Array.isArray(result.segments) ? result.segments.filter((s) => typeof s.text === "string" && Number.isFinite(s.start) && s.start >= 0 && s.start <= 300) : [];
    paragraphs.push(...(segments.length ? segments.map((s) => `[${stamp(chunk.offsetSeconds + s.start)}] ${s.text.trim()}`) : [`[${stamp(chunk.offsetSeconds)}] ${result.text.trim()}`]));
  }
  if (!paragraphs.length) throw new Error("No speech detected");
  return paragraphs.join("\n\n");
}
