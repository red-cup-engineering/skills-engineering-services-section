/**
 * Cloudflare Workers AI's model-run surface (POST /accounts/{account}/ai/run/{model}).
 * Chat completions use the catalog's OpenAI-compatible row; image, speech and other
 * model families run here. The account id and token come from the environment.
 */

/** Read a response body into JSON, refusing one larger than `limit` bytes. */
async function boundedJson(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error(`Workers AI response exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error(`Workers AI returned invalid JSON (HTTP ${response.status})`); }
}

/**
 * Run one Workers AI model and return its `result`. Inside a Worker whose
 * `env` carries the `AI` binding, the binding runs it; anywhere else the REST
 * surface does, with the account id and token from `env`.
 * @param {string} model e.g. "@cf/openai/whisper-large-v3-turbo"
 * @param {object} body the model's input
 * @param {{env?: object, fetchImpl?: typeof fetch, timeoutMs?: number, responseLimit?: number}} [options]
 */
export async function runWorkersAiModel(model, body, { env = process.env, fetchImpl = fetch, timeoutMs = null, responseLimit = 12 * 1024 * 1024 } = {}) {
  if (!/^@cf\/[\w.-]+\/[\w.-]+$/u.test(model)) throw new Error(`Invalid Workers AI model: ${model}`);
  if (typeof env.AI?.run === "function") {
    const result = await env.AI.run(model, body);
    if (result === undefined || result === null) throw new Error(`Workers AI ${model} returned no result`);
    return result;
  }
  if (!/^[a-f0-9]{32}$/iu.test(env.CLOUDFLARE_ACCOUNT_ID ?? "")) throw new Error("Missing or invalid CLOUDFLARE_ACCOUNT_ID");
  if (!env.API_KEY_CLOUDFLARE_WORKERS_AI) throw new Error("Missing API_KEY_CLOUDFLARE_WORKERS_AI");
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.API_KEY_CLOUDFLARE_WORKERS_AI}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(timeoutMs === null || timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
  });
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (response.ok && /^(?:audio|image)\//u.test(contentType)) return Buffer.from(await response.arrayBuffer());
  const result = await boundedJson(response, responseLimit);
  if (!response.ok || result.success === false) {
    const codes = (result.errors ?? []).map((error) => error.code).filter(Number.isFinite).join(",");
    throw new Error(`Workers AI ${model} HTTP ${response.status}${codes ? ` (codes ${codes})` : ""}`);
  }
  if (!result.result) throw new Error(`Workers AI ${model} returned no result`);
  return result.result;
}
