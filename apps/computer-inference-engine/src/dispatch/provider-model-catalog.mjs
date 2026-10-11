import { isCommandEndpoint } from "../command/exchange.mjs";

/** Provider-owned model-catalog observation and capability classification. */

const CAPABILITIES = Object.freeze([
  "chat", "reasoning", "long-context", "json-output", "code",
  "Chinese-language", "embeddings", "text-to-speech", "image-generation",
  "video-generation", "music-generation", "audio-understanding", "live-audio",
]);

const textOf = (model) => JSON.stringify(model).toLowerCase();
const numberOf = (model, names) => {
  for (const name of names) {
    const value = model?.[name];
    if (value !== null && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) > 0) return Number(value);
  }
  return null;
};

/** Keep provider-authored capacities distinct: a context window includes the reply. */
function observedModelLimits(model) {
  const contextWindowTokens = numberOf(model, ["context_window", "context_length", "contextLength", "max_model_len"]);
  const maximumInputTokens = numberOf(model, ["inputTokenLimit", "max_input_tokens"]);
  const maximumOutputTokens = numberOf(model, ["max_completion_tokens", "max_output_tokens", "outputTokenLimit"]);
  return Object.freeze({
    ...(contextWindowTokens === null ? {} : { contextWindowTokens }),
    ...(maximumInputTokens === null ? {} : { maximumInputTokens }),
    ...(maximumOutputTokens === null ? {} : { maximumOutputTokens }),
  });
}

/** Classify only from the provider's observed model record. */
export function classifyObservedModel(model, { providerIdentity = "" } = {}) {
  const text = textOf(model);
  const id = String(model?.id ?? model?.name ?? model?.model ?? "").replace(/^models\//u, "").toLowerCase();
  const google = /gemini|google/iu.test(providerIdentity);
  const googleMedia = google && /^(?:gemini-.+-image|imagen-|nano-banana|veo-|gemini-omni-|lyria-|gemini-embedding|text-embedding|embedding-|gemini-.+(?:tts|live|audio|transcribe))/u.test(id);
  const googleText = google && !googleMedia && /^gemini-(?:(?:\d+(?:\.\d+)*-)?)(?:flash(?:-lite)?|pro|ultra)(?:-|$)/u.test(id);
  const declared = new Set([
    ...(Array.isArray(model?.capabilities) ? model.capabilities : []),
    ...(Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : []),
    ...(Array.isArray(model?.properties) ? model.properties : []),
  ].map((value) => String(value).toLowerCase()));
  const limits = observedModelLimits(model);
  const context = limits.contextWindowTokens ?? limits.maximumInputTokens ?? null;
  const has = (pattern) => pattern.test(text) || [...declared].some((value) => pattern.test(value));
  const capabilities = new Set();
  if (!googleMedia && (has(/chat|conversation|text.generation|generatecontent|instruct/u) || googleText)) capabilities.add("chat");
  if (has(/reason|thinking|agentic|autonomous.agent|complex.*workflow|deepseek-r1|qwq|gpt-oss|\bo[134]\b/u)
    || (googleText && /^gemini-(?:(?:\d+(?:\.\d+)*-)?pro)(?:-|$)/u.test(id))) capabilities.add("reasoning");
  if ((context ?? 0) >= 32_768 || has(/long.context|128k|256k|1m.context/u)) capabilities.add("long-context");
  if (has(/json|structured.output|tool.call|function.call/u) || (capabilities.has("chat") && (!google || googleText))) capabilities.add("json-output");
  if (has(/code|coder|codestral|devstral|starcoder|software.engineering|coding/u)) capabilities.add("code");
  if (has(/qwen|deepseek|glm|kimi|yi-|baichuan|chinese|mandarin|zh-/u)) capabilities.add("Chinese-language");
  if (has(/embed|embedding|feature.extraction/u)) capabilities.add("embeddings");
  if (has(/text.to.speech|speech.synthesis|\btts\b|melotts/u)) capabilities.add("text-to-speech");
  if (has(/text.to.image|image.generation|flux|stable.diffusion|imagen/u)) capabilities.add("image-generation");
  // Google's model listing commonly exposes generateContent without a modality.
  // The model identity supplies that missing distinction; it is not API quota.
  if (google) {
    if (/^(?:gemini-.+-image|imagen-|nano-banana)/u.test(id)) capabilities.add("image-generation");
    if (/^(?:veo-|gemini-omni-)/u.test(id)) capabilities.add("video-generation");
    if (/^lyria-/u.test(id)) capabilities.add("music-generation");
    if (/^(?:gemini-embedding|text-embedding|embedding-)/u.test(id)) capabilities.add("embeddings");
    if (/^gemini-.+tts/u.test(id)) capabilities.add("text-to-speech");
    if (/^gemini-.+live/u.test(id)) {
      capabilities.add("live-audio");
      capabilities.add("audio-understanding");
    }
    if (/^gemini-.+(?:audio|transcribe)/u.test(id)) capabilities.add("audio-understanding");
  }
  return Object.freeze(CAPABILITIES.filter((capability) => capabilities.has(capability)));
}

function endpointFor(descriptor) {
  if (descriptor.catalogEndpoint) return descriptor.catalogEndpoint;
  if (descriptor.transport === "ollama-chat" || /127\.0\.0\.1:11434/u.test(descriptor.endpoint ?? "")) return "http://127.0.0.1:11434/api/tags";
  if (descriptor.provider.includes("cloudflare-workers-ai")) {
    const match = descriptor.endpoint.match(/\/accounts\/([^/]+)\/ai\//u);
    return match ? `https://api.cloudflare.com/client/v4/accounts/${match[1]}/ai/models/search?per_page=1000` : null;
  }
  return descriptor.endpoint?.replace(/\/chat\/completions\/?$/u, "/models") ?? null;
}

function modelRows(body) {
  const source = body?.result ?? body?.data ?? body?.models ?? [];
  const rows = Array.isArray(source) ? source : Array.isArray(source?.models) ? source.models : [];
  return rows.map((row) => typeof row === "string" ? { id: row } : row).filter((row) => row && typeof row === "object");
}

/**
 * Read one provider's own listing. No inference request is made and no
 * credential, account id, or raw response is returned.
 */
export async function observeProviderModelCatalog(descriptor, { fetchImpl = fetch, now = () => new Date().toISOString(), timeoutMs = 20_000 } = {}) {
  const endpoint = endpointFor(descriptor);
  if (!endpoint || isCommandEndpoint(descriptor)) return Object.freeze({
    type: "ProviderModelCatalogObservation", providerIdentity: descriptor.provider,
    observedAt: now(), disposition: "not-listed", models: Object.freeze([]),
  });
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: descriptor.auth?.mode === "bearer" ? { authorization: `Bearer ${descriptor.apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return Object.freeze({ type: "ProviderModelCatalogObservation", providerIdentity: descriptor.provider, observedAt: now(), disposition: "unavailable", models: Object.freeze([]) });
  }
  if (!response.ok) return Object.freeze({
    type: "ProviderModelCatalogObservation", providerIdentity: descriptor.provider,
    observedAt: now(), disposition: "refused", status: response.status, models: Object.freeze([]),
  });
  let body;
  try { body = await response.json(); } catch { body = null; }
  const models = modelRows(body).map((row) => {
    const id = String(row.id ?? row.name ?? row.model ?? "").replace(/^models\//u, "");
    const limits = observedModelLimits(row);
    return Object.freeze({ id, capabilities: classifyObservedModel(row, { providerIdentity: descriptor.provider }), ...(Object.keys(limits).length ? { limits } : {}) });
  }).filter(({ id }) => id !== "" && (!descriptor.provider.includes("openrouter") || id.endsWith(":free")));
  return Object.freeze({
    type: "ProviderModelCatalogObservation", providerIdentity: descriptor.provider,
    observedAt: now(), disposition: "observed", source: new URL(endpoint).origin,
    models: Object.freeze(models),
  });
}

export async function observeProviderModelCatalogs(descriptors, options = {}) {
  return Promise.all(descriptors.map((descriptor) => observeProviderModelCatalog(descriptor, options)));
}
