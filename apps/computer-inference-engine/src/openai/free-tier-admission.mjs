const API = "https://openrouter.ai/api/v1";
const ZERO_PRICE = Object.freeze({ prompt: 0, completion: 0, request: 0, image: 0 });

export const OPENROUTER_ZERO_CASH_PROVIDER = Object.freeze({
  allow_fallbacks: false,
  max_price: ZERO_PRICE,
});

export class OpenRouterFreeAdmissionError extends Error {
  constructor(message, reason, status) {
    super(message);
    this.name = "OpenRouterFreeAdmissionError";
    this.reason = reason;
    if (Number.isInteger(status)) this.status = status;
  }
}

async function json(response, label) {
  let value;
  try { value = await response.json(); }
  catch { throw new OpenRouterFreeAdmissionError(`${label} did not return JSON`, "invalid-admission-response"); }
  if (!response.ok) throw new OpenRouterFreeAdmissionError(`${label} refused with HTTP ${response.status}`, "admission-http-refusal", response.status);
  return value;
}

export async function verifyOpenRouterFreeAccount({ apiKey, fetchImpl = fetch, signal } = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 8) throw new OpenRouterFreeAdmissionError("OpenRouter credential is absent", "credential-absent");
  const body = await json(await fetchImpl(`${API}/key`, { headers: { authorization: `Bearer ${apiKey}` }, signal }), "OpenRouter key preflight");
  if (body?.data?.is_free_tier !== true) throw new OpenRouterFreeAdmissionError("OpenRouter key is not machine-reported as free tier", "account-not-free-tier");
  return Object.freeze({ isFreeTier: true, usage: Number(body.data.usage ?? 0), limit: body.data.limit ?? null });
}

export async function admitOpenRouterFreeInvocation({ apiKey, model, fetchImpl = fetch, signal } = {}) {
  if (typeof model !== "string" || !model.endsWith(":free")) throw new OpenRouterFreeAdmissionError("OpenRouter model must carry the exact :free variant suffix", "model-not-free-variant");
  const account = await verifyOpenRouterFreeAccount({ apiKey, fetchImpl, signal });
  const catalog = await json(await fetchImpl(`${API}/models`, { signal }), "OpenRouter model catalog preflight");
  if (!Array.isArray(catalog?.data)) throw new OpenRouterFreeAdmissionError("OpenRouter model catalog is malformed", "invalid-admission-response");
  const matches = catalog.data.filter((entry) => entry?.id === model);
  if (matches.length !== 1) throw new OpenRouterFreeAdmissionError("OpenRouter catalog does not contain exactly one selected model", "model-not-listed");
  const pricing = matches[0].pricing ?? {};
  const exactZero = (value) => value === 0 || value === "0";
  if (!exactZero(pricing.prompt) || !exactZero(pricing.completion) || (pricing.request !== undefined && !exactZero(pricing.request))) {
    throw new OpenRouterFreeAdmissionError("OpenRouter selected model is not zero-priced for prompt, completion, and request", "model-not-zero-priced");
  }
  return Object.freeze({ account, model, promptPrice: 0, completionPrice: 0, requestPrice: pricing.request === undefined ? null : 0 });
}
