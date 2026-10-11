import JSNODE_JSON_DATA_0 from "../../content/openai/schemas/inference-exchange.schema.json" with { type: "json" };
import { compileJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { randomBytes } from "node:crypto";
import { STATUS_CODES } from "node:http";

/**
 * @typedef {object} OpenAiCompatibleProviderConfig
 * @property {string} providerId - lowercase-hyphen provider id, used as the cost/usage denomination prefix.
 * @property {string} chatCompletionsUrl - full URL of the provider's chat-completions endpoint.
 * @property {string} apiKey - bearer credential, caller-supplied; never read from disk by this module.
 * @property {string} [authHeader] - credential header name, default "Authorization".
 * @property {(key: string) => string} [authScheme] - formats apiKey into the header value, default `Bearer ${key}`.
 * @property {number|null} [timeoutMs] - request deadline in milliseconds; null delegates cancellation to the caller.
 * @property {(packet: ChatCompletionPacket) => object} [buildRequestBody] - provider-owned request allocation.
 * @property {string[]} [omitRequestFields] - unsupported packet parameters to remove before sending.
 * @property {object} [requestFields] - provider-owned fields overriding untrusted packet parameters.
 * @property {(body: object) => {text: string}} [projectCompletion] - provider-owned assistant carrier projection.
 */

/**
 * @typedef {object} ChatCompletionPacket
 * @property {string} model
 * @property {Array<{role: "system"|"user"|"assistant", content: string}>} messages
 * @property {object} [params] - extra provider-specific body fields, merged in verbatim.
 * @property {number} ["max-tokens"] - mapped to the request body's max_tokens.
 */

/**
 * Validates a chat-completion packet's shape.
 * @param {unknown} packet
 * @returns {string[]} validation errors; empty when the packet is well-formed.
 */
const exchangeSchema = structuredClone(JSNODE_JSON_DATA_0);
const packetContract = compileJsonSchema(exchangeSchema.properties.packet);
const exchangeContract = compileJsonSchema(exchangeSchema);
const validationErrors = (result) => result.issues.map(({ path, message }) => `${path || "/"}: ${message}`);

export function validateChatCompletionPacket(packet) {
  return validationErrors(packetContract.validate(packet));
}

export function validateChatExchangeRecord(record) {
  return validationErrors(exchangeContract.validate(record));
}

/**
 * Generates one exchange record id: `exchange-<UTC-timestamp>-<6 hex>`.
 * @returns {string}
 */
export function generateExchangeId() {
  const now = new Date();
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `exchange-${stamp}-${randomBytes(3).toString("hex")}`;
}

/**
 * Extracts witnessed token usage from a provider response body.
 * Present only when the response actually carried a usage object; never estimated.
 * @param {unknown} responseBody
 * @param {string} denominationPrefix
 * @returns {{input?: object, output?: object}|undefined}
 */
export function tokenUsage(responseBody, denominationPrefix) {
  const usage = responseBody?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const result = {};
  if (Number.isInteger(usage.prompt_tokens)) result.input = { quantity: usage.prompt_tokens, denomination: `${denominationPrefix}-tokens-in` };
  if (Number.isInteger(usage.completion_tokens)) result.output = { quantity: usage.completion_tokens, denomination: `${denominationPrefix}-tokens-out` };
  return Object.keys(result).length ? result : undefined;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Validate one endpoint and derive its HTTP headers.
 * @param {OpenAiCompatibleProviderConfig & {auth?: {mode: string}}} config
 * @returns {{address: URL, headers: Record<string, string>}}
 * @throws {TypeError} On an invalid endpoint or credential contract.
 */
export function configureOpenAiCompatibleRequest(config) {
  let address;
  try { address = new URL(config.chatCompletionsUrl); } catch { throw new TypeError("provider endpoint must be an absolute URL"); }
  if (address.protocol !== "https:" && !(address.protocol === "http:" && LOOPBACK_HOSTS.has(address.hostname))) throw new TypeError("provider endpoint must use HTTPS (plain HTTP is permitted only to a loopback host)");
  if (address.username || address.password) throw new TypeError("provider endpoint must not embed credentials");
  const mode = config.auth?.mode ?? "bearer";
  if (mode === "none") {
    if (!LOOPBACK_HOSTS.has(address.hostname)) throw new TypeError("unauthenticated provider access is permitted only to a loopback host");
    return { address, headers: { "Content-Type": "application/json" } };
  }
  if (mode !== "bearer") throw new TypeError("provider auth mode must be bearer or none");
  if (typeof config.apiKey !== "string" || config.apiKey.length === 0) throw new TypeError("provider credential is required");
  return { address, headers: { [config.authHeader ?? "Authorization"]: (config.authScheme ?? ((key) => `Bearer ${key}`))(config.apiKey), "Content-Type": "application/json" } };
}

/**
 * Exchange one assistant message, retaining tool calls and usage without interpreting them.
 * @param {object} body
 * @param {OpenAiCompatibleProviderConfig & {auth?: {mode: string}, timeoutMs?: number, signal?: AbortSignal}} config
 * @param {typeof fetch} [request]
 * @returns {Promise<{ok: boolean, body?: object, cause?: object}>}
 * @throws {TypeError} On an invalid endpoint, credential, or timeout contract.
 */
export async function exchangeOpenAiCompatibleAssistantMessage(body, config, request = fetch) {
  const { exchangeProviderAssistantMessage } = await import("./provider-runtime.mjs");
  const timeoutMs = config.timeoutMs === undefined ? null : config.timeoutMs;
  if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw new TypeError("timeoutMs must be a positive integer or null");
  return exchangeProviderAssistantMessage(body, { ...config, timeoutMs }, request, exchangeAssistantTransport);
}

async function exchangeAssistantTransport(body, config, request) {
  const { headers } = configureOpenAiCompatibleRequest(config);

  const refuse = (kind, reason, details = {}) => ({ ok: false, cause: { kind, reason, ...details } });
  let response;
  try { response = await request(config.chatCompletionsUrl, { method: "POST", headers, body: JSON.stringify(body), signal: config.signal }); }
  catch (error) { return refuse("transport", error?.name === "AbortError" || error?.name === "TimeoutError" ? "timeout" : "request-failed"); }
  if (!response || typeof response.ok !== "boolean") return refuse("protocol", "invalid-http-response");
  if (!response.ok) {
    const retryAfter = response.headers?.get?.("retry-after");
    const retryAfterSeconds = typeof retryAfter === "string" && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : null;
    let providerMessage;
    try {
      const body=await response.json(),error=body?.error??body?.[0]?.error;
      if(typeof error?.message==="string"){
        const key=typeof config.apiKey==="string"&&config.apiKey.length?config.apiKey:null;
        providerMessage=(key?error.message.replaceAll(key,"<redacted>").replaceAll(encodeURIComponent(key),"<redacted>"):error.message).slice(0,1000);
      }
    } catch { /* HTTP status remains evidence when the error body is unavailable. */ }
    return refuse("http", "provider-refused", { status: response.status, ...(providerMessage?{providerMessage}:{}), ...(Number.isSafeInteger(retryAfterSeconds) ? { retryAfterSeconds } : {}) });
  }
  const result = await readProviderResponseJson(response, config.signal);
  if (!result.ok) return result;
  if (!result.body || typeof result.body !== "object" || Array.isArray(result.body)) return refuse("protocol", "invalid-json-response", { phase: "response-body", status: response.status });
  return result;
}

/** Read a provider's JSON body without making a placement or availability decision. */
export async function readProviderResponseJson(response, signal) {
  try {
    const body = typeof response.json === "function" ? await response.json() : JSON.parse(await response.text());
    return { ok: true, body };
  } catch (error) {
    const phase = "response-body", status = response.status;
    if (signal?.aborted && signal.reason?.name !== "TimeoutError") return { ok: false, cause: { kind: "cancelled", reason: "receiver-cancelled", phase, status } };
    const timeout = signal?.reason?.name === "TimeoutError" || error?.name === "TimeoutError" || error?.name === "AbortError";
    const malformed = error instanceof SyntaxError;
    return { ok: false, cause: { kind: malformed && !timeout ? "protocol" : "transport", reason: timeout ? "timeout" : malformed ? "invalid-json-response" : "response-body-read-failed", phase, status } };
  }
}

/**
 * Admit a catalog row only when its exact token prices and entitlement declare zero cash.
 * @param {object} row
 * @param {string} [requestedModel]
 * @returns {boolean}
 */
export function isZeroCashProvider(row, requestedModel = row?.defaultModel) {
  return row?.pricePerMillionTokensMicroUsd?.input === 0 && row?.pricePerMillionTokensMicroUsd?.output === 0
    && row?.entitlement?.cashCost === "zero" && row.entitlement.paidOverage === "forbidden"
    && row.entitlement.model === requestedModel;
}

/**
 * Runs one chat-completion exchange against an OpenAI-compatible endpoint
 * and settles to exactly one typed outcome: completion or refusal. This is
 * the ONE adapter every OpenAI-compatible provider row shares; a provider
 * is admitted by supplying an OpenAiCompatibleProviderConfig, never by
 * writing a second copy of this function.
 * @param {ChatCompletionPacket} packet - caller must validate first with validateChatCompletionPacket.
 * @param {OpenAiCompatibleProviderConfig} config
 * @param {typeof fetch} [request] - injectable for testing.
 * @returns {Promise<object>} one exchange record: {id, recordedAt, packet, outcome, completion|refusal, cost, usage?}
 */
export async function runOpenAiCompatibleChatExchange(packet, config, request = fetch) {
  const id = generateExchangeId();
  const startedAt = performance.now();
  const denomination = `${config.providerId}-api-requests`;
  const wallTimeSeconds = () => (performance.now() - startedAt) / 1000;
  const refusal = (grounds, unmet) => ({
    id, recordedAt: new Date().toISOString(), packet, outcome: "refusal",
    refusal: { grounds, unmet },
    cost: { "fuel-consumed": 1, "wall-time-seconds": wallTimeSeconds(), denomination },
  });
  try {
    const body = config.buildRequestBody ? { ...config.buildRequestBody(packet) } : { ...(packet.params ?? {}), model: packet.model, messages: packet.messages };
    if (!config.buildRequestBody && packet["max-tokens"] !== undefined) body.max_tokens = packet["max-tokens"];
    for (const field of config.omitRequestFields ?? []) delete body[field];
    Object.assign(body, config.requestFields);
    const exchange = await exchangeOpenAiCompatibleAssistantMessage(body, config, request);
    if (!exchange.ok) {
      const cause = exchange.cause;
      const unmet = cause.kind === "http" ? [`http-failure:${cause.status}`] : [cause.kind === "transport" ? "network-error" : cause.kind === "policy" ? `provider-policy:${cause.reason}` : "unparseable-response-body"];
      return refusal(cause.kind === "http" ? `${config.providerId} responded with HTTP ${cause.status} ${STATUS_CODES[cause.status] ?? ""}${cause.providerMessage?": "+cause.providerMessage:""}` : cause.reason, unmet);
    }
    const parsed = exchange.body;
    const assistantMessage = parsed?.choices?.[0]?.message;
    const content = config.projectCompletion ? config.projectCompletion(parsed).text : assistantMessage?.content;
    if (typeof content !== "string" || content.length === 0) {
      const reasoning = assistantMessage?.reasoning ?? assistantMessage?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        return refusal(`${config.providerId}'s response carried only choices[0].message.reasoning/reasoning_content with no completion content`, ["reasoning-only-response"]);
      }
      return refusal(`${config.providerId}'s response carried no usable assistant content`, [config.projectCompletion ? "missing-completion-carrier" : "missing-completion-content"]);
    }
    return {
      id, recordedAt: new Date().toISOString(), packet, outcome: "completion",
      completion: { model: parsed.model || packet.model, text: content, "finish-reason": parsed.choices[0].finish_reason ?? "unknown", raw: parsed },
      cost: { "fuel-consumed": 1, "wall-time-seconds": wallTimeSeconds(), denomination },
      ...(tokenUsage(parsed, config.providerId) ? { usage: tokenUsage(parsed, config.providerId) } : {}),
    };
  } catch (error) {
    return refusal("a network or fetch error occurred", ["network-error"]);
  }
}

/**
 * @typedef {object} ProviderCatalogRow
 * @property {string} providerId
 * @property {string} chatCompletionsUrl
 * @property {string} apiKeyEnvVar
 * @property {boolean} keyed - true once a live call has verified this row's credential works.
 * @property {string} [defaultModel] - a model id last verified live against this exact row; free-tier rosters rotate, so treat this as a starting point, not a promise.
 */

/**
 * @typedef {object} FreeFirstRoutingPolicy
 * @property {string[]} freeFirstOrder - providerId values in try-order; every entry must be a free tier.
 */

/**
 * Selects the next free-tier provider row to try, in the routing policy's
 * declared order, skipping unarmed rows and any providerId the caller has
 * already ruled out for this attempt (e.g. one that just refused with a
 * rate limit). This function's only source of candidates is
 * routingPolicy.freeFirstOrder -- there is no code path from here to a
 * paid or frontier provider; a caller that wants one must go around this
 * function entirely, as an explicit separate decision.
 * @param {ProviderCatalogRow[]} rows
 * @param {FreeFirstRoutingPolicy} routingPolicy
 * @param {{ excludeProviderIds?: string[] }} [options]
 * @returns {ProviderCatalogRow|null} the next row to try, or null once every free-first candidate is excluded or unarmed.
 */
export function selectFreeFirstProvider(rows, routingPolicy, { excludeProviderIds = [], zeroCashOnly = false } = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  if (!routingPolicy || !Array.isArray(routingPolicy.freeFirstOrder)) throw new TypeError("routingPolicy.freeFirstOrder must be an array");
  const excluded = new Set(excludeProviderIds);
  const byId = new Map(rows.map((row) => [row.providerId, row]));
  for (const providerId of routingPolicy.freeFirstOrder) {
    if (excluded.has(providerId)) continue;
    const row = byId.get(providerId);
    if (row && row.keyed && (!zeroCashOnly || isZeroCashProvider(row))) return row;
  }
  return null;
}

/**
 * Recognizes a refusal that looks like a transient rate-limit or capacity
 * condition -- worth retrying against the next free provider -- as opposed
 * to a hard failure (bad request, missing model, auth failure) that
 * retrying a different free provider will not fix by itself.
 * @param {unknown} refusalValue - the `refusal` object from a runOpenAiCompatibleChatExchange refusal outcome.
 * @returns {boolean}
 */
export function isRateLimitRefusal(refusalValue) {
  if (!refusalValue || typeof refusalValue !== "object") return false;
  const unmet = Array.isArray(refusalValue.unmet) ? refusalValue.unmet : [];
  return unmet.includes("http-failure:429");
}

/**
 * Builds the exact packet to send for one free-first attempt against one
 * row. A model id is frequently valid for only the provider it was chosen
 * for, so the row's own last-verified `defaultModel` overrides the
 * caller's `packet.model` whenever the row has one -- a free-first retry
 * moves across providers, and reusing the caller's original model id
 * across that move produces a spurious hard refusal (missing-model)
 * instead of a genuine retry.
 * @param {ChatCompletionPacket} packet
 * @param {ProviderCatalogRow} row
 * @returns {ChatCompletionPacket}
 */
export function resolveFreeFirstAttemptPacket(packet, row) {
  return { ...packet, model: row.defaultModel ?? packet.model };
}

function admittedFreeFunctionTool(tool) {
  const fn = tool?.function;
  return tool?.type === "function" && Object.keys(tool).every((key) => ["type", "function"].includes(key))
    && fn && typeof fn === "object" && !Array.isArray(fn)
    && Object.keys(fn).every((key) => ["name", "description", "parameters", "strict"].includes(key))
    && typeof fn.name === "string" && /^[a-zA-Z0-9_-]{1,64}$/u.test(fn.name)
    && (fn.description === undefined || typeof fn.description === "string")
    && (fn.strict === undefined || typeof fn.strict === "boolean")
    && fn.parameters?.type === "object" && !Array.isArray(fn.parameters);
}

function admitZeroCashParameters(params = {}) {
  if (Object.keys(params).some((key) => !["temperature", "top_p", "seed", "stop", "response_format", "tools", "tool_choice", "parallel_tool_calls", "max_tokens"].includes(key))) throw new TypeError("zero-cash-request-parameter-not-admitted");
  if (params.tools !== undefined && (!Array.isArray(params.tools) || !params.tools.every(admittedFreeFunctionTool))) throw new TypeError("zero-cash-tool-not-admitted");
  const choice = params.tool_choice;
  if (choice !== undefined && !["auto", "none", "required"].includes(choice)) {
    if (!choice || choice.type !== "function" || Object.keys(choice).some((key) => !["type", "function"].includes(key))
      || !choice.function || Object.keys(choice.function).some((key) => key !== "name")
      || !(params.tools ?? []).some((tool) => tool.function.name === choice.function.name)) throw new TypeError("zero-cash-tool-choice-not-admitted");
  }
}

/**
 * Programmatic free-first dispatch entrypoint: given an already-parsed
 * catalog and packet (no file paths, no argv), walks
 * `catalog.routingPolicy.freeFirstOrder`, retrying the next free provider
 * only on a rate-limit refusal, and stops -- never falls back to a paid or
 * frontier provider -- once every free-first candidate is exhausted or
 * unarmed. Existing application consumers still call this older loop.
 * New standalone inference work uses the observed inference-work-lot
 * dispatcher and records a receiving customer's disposition.
 * @param {{catalog: object, packet: ChatCompletionPacket}} input
 * @param {{request?: typeof fetch}} [options] - injectable transport for testing.
 * @returns {Promise<{ok: boolean, provider?: string, tried: Array<object>, exchange?: object, reason?: string, note?: string}>}
 */
export async function dispatchFreeFirstChatCompletion({ catalog, packet, zeroCashOnly = false }, { request = fetch, env = process.env } = {}) {
  const errors = validateChatCompletionPacket(packet);
  if (errors.length) throw new Error(`packet is invalid:\n  - ${errors.join("\n  - ")}`);
  if (zeroCashOnly) admitZeroCashParameters(packet.params);
  const tried = [];
  const excluded = [];
  for (;;) {
    const row = selectFreeFirstProvider(catalog.rows, catalog.routingPolicy, { excludeProviderIds: excluded, zeroCashOnly });
    if (!row) {
      return { ok: false, tried, reason: "free-first-exhausted", note: "every free-tier provider in routingPolicy.freeFirstOrder is unarmed or was excluded this attempt; this function does not fall back to a paid or frontier provider" };
    }
    const apiKey = row.anonymousApiKey ?? (row.apiKeyEnvVars ?? [row.apiKeyEnvVar]).map((name) => env[name]).find(Boolean);
    if (!apiKey && row.auth?.mode !== "none") {
      excluded.push(row.providerId);
      tried.push({ providerId: row.providerId, outcome: "misconfigured", detail: `${row.apiKeyEnvVar} is not set` });
      continue;
    }
    const { runProviderExchange } = await import("./provider-runtime.mjs");
    const exchange = await runProviderExchange(row, resolveFreeFirstAttemptPacket(packet, row), { request, env })
      .catch((error) => ({ outcome: "refusal", refusal: { grounds: error.message, unmet: ["exchange-error"] } }));
    if (exchange.outcome === "completion") {
      tried.push({ providerId: row.providerId, outcome: exchange.outcome });
      return { ok: true, provider: row.providerId, tried, exchange };
    }
    // Any provider-side failure (rate limit, HTTP error, timeout, missing model,
    // reasoning-only or empty answer) is one provider's problem: the packet was
    // already admitted, so the next free provider gets it.
    tried.push({ providerId: row.providerId, outcome: exchange.outcome, grounds: exchange.refusal?.grounds, unmet: exchange.refusal?.unmet });
    excluded.push(row.providerId);
  }
}

/**
 * The one denomination every catalog row's pricePerMillionTokensMicroUsd
 * figures are expressed in (micro-USD, i.e. one millionth of one US dollar),
 * shared by every purchase-price amount this module returns.
 * @type {{kind: "fiat", asset: "usd", unit: "micro-usd"}}
 */
export const PURCHASE_PRICE_DENOMINATION = Object.freeze({ kind: "fiat", asset: "usd", unit: "micro-usd" });

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

/**
 * @typedef {object} CatalogRowPricePerMillionTokensMicroUsd
 * @property {number} input - integer micro-USD per 1,000,000 input tokens; 0 for a free-tier row.
 * @property {number} output - integer micro-USD per 1,000,000 output tokens; 0 for a free-tier row.
 */

/**
 * Resolves the real purchase price for one dispatched exchange from a
 * catalog row's own pricePerMillionTokensMicroUsd data -- never a hardcoded
 * amount in code. A row whose rate is 0/0 (every free-tier row) always
 * prices at exactly zero, with or without usage. A row carrying a nonzero
 * rate (a paid/frontier reference row) requires the exchange's witnessed
 * usage to compute an exact price; it is never estimated.
 * @param {{pricePerMillionTokensMicroUsd: CatalogRowPricePerMillionTokensMicroUsd}} row - a catalog row.
 * @param {{input?: {quantity: number}, output?: {quantity: number}}} [usage] - the exchange record's own `usage` field, when the provider reported one.
 * @returns {{denomination: {kind: string, asset: string, unit: string}, amount: {numerator: string, denominator: string}}}
 */
export function computePurchasePrice(row, usage) {
  const rate = row?.pricePerMillionTokensMicroUsd;
  if (!rate || typeof rate.input !== "number" || typeof rate.output !== "number") {
    throw new Error(`catalog row ${row?.providerId ?? "(unknown)"} carries no pricePerMillionTokensMicroUsd`);
  }
  if (rate.input === 0 && rate.output === 0) {
    return { denomination: PURCHASE_PRICE_DENOMINATION, amount: { numerator: "0", denominator: "1" } };
  }
  const tokensIn = usage?.input?.quantity, tokensOut = usage?.output?.quantity;
  if (!Number.isInteger(tokensIn) || !Number.isInteger(tokensOut)) {
    throw new Error(`catalog row ${row.providerId} has a nonzero rate but the exchange carried no witnessed usage; a price is never estimated`);
  }
  const numerator = BigInt(tokensIn) * BigInt(rate.input) + BigInt(tokensOut) * BigInt(rate.output);
  const denominator = 1_000_000n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { denomination: PURCHASE_PRICE_DENOMINATION, amount: { numerator: (numerator / divisor).toString(), denominator: (denominator / divisor).toString() } };
}
