import { allocateProviderOutputTokens, providerConfiguration } from "../openai/provider-runtime.mjs";
import { isZeroCashProvider } from "@red-cup-engineering/computer-inference-engine/openai";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nonnegativeHostRatio as exactNonnegativeAmount, positiveHostRatio as exactAmount } from "@red-cup-engineering/metrologic/number/wire-ratio";
import { executionConfigurationIdentity } from "./sen-carrier.mjs";
import { isCommandEndpoint } from "../command/exchange.mjs";
import { executeReceiverToolAgent } from "./receiver-agent.mjs";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { pricingRootOf, appendProviderAvailability, latestProviderAvailability, loadObservations } from "./expected-resolution-pricing.mjs";
import { createProviderAccountEntitlementResolver } from "./provider-account-entitlement.mjs";
import { perishablePrice } from "@red-cup-engineering/organizing/enterprise";
import { allowanceLedgerPath, readAllowanceLedger, recordAllowanceEvidence } from "../media/allowance-ledger.mjs";
import { subscriptionAllowance } from "../media/subscription-allowances.mjs";
import { currentProviderAvailability, observeProviderAvailability, observeProviderHired, observeProviderObstruction, providerRemainingRequests, providerWindowStatement, restoreProviderAvailability } from "./provider-availability.mjs";

const CATALOG_ROW = Symbol("provider-catalog-row");
const accountEntitlementVerifiers = new WeakMap();
// Private owner custody retained at descriptor admission, never a caller execution field.
const allowanceLedgerCustody = new WeakMap();
const DEFAULT_ENDPOINT_CLASS = "direct-openai-compatible-endpoint";

/**
 * Path to the openai-compatible-chat-completion-service catalog.json, the
 * one carrier of provider facts this admission carrier overlays.
 * @type {string}
 */
export const DEFAULT_PROVIDER_CATALOG_PATH = fileURLToPath(new URL(
  "./content/openai/providers/catalog.json",
  import.meta.resolve("@red-cup-engineering/computer-inference-engine/package.json"),
));

/**
 * Reads the catalog's rows keyed by providerId. Missing/unreadable yields
 * an empty map; a referencing overlay entry then reports under-configured.
 * @param {string} [catalogPath]
 * @returns {Map<string, {chatCompletionsUrl: string, apiKeyEnvVar: string, defaultModel?: string}>}
 */
function providerCatalogRowsById(catalogPath = DEFAULT_PROVIDER_CATALOG_PATH) {
  if (!existsSync(catalogPath)) return new Map();
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const rows = Array.isArray(catalog?.rows) ? catalog.rows : [];
  return new Map(rows.map((row) => [row.providerId, row.providerFamily ? providerConfiguration(row, rows) : row]));
}

/**
 * Fills one overlay entry's endpoint/apiKeyEnv/model from its matching
 * catalog row by providerId, when the entry has no endpoint of its own.
 * @param {Record<string, unknown>} entry
 * @param {Map<string, {chatCompletionsUrl: string, apiKeyEnvVar: string, defaultModel?: string}>} catalogRowsById
 * @returns {Record<string, unknown>}
 */
function withCatalogFacts(entry, catalogRowsById) {
  if (!entry || typeof entry !== "object") return entry;
  const providerId = typeof entry.providerId === "string" ? entry.providerId.trim() : "";
  if (!providerId) return entry;
  const row = catalogRowsById.get(providerId);
  if (!row) return entry;
  return {
    ...entry,
    endpoint: entry.endpoint ?? row.chatCompletionsUrl,
    [CATALOG_ROW]: row,
    apiKeyEnv: entry.apiKeyEnv ?? row.apiKeyEnvVar,
    apiKey: entry.apiKey ?? row.anonymousApiKey,
    assistantProtocol: entry.assistantProtocol ?? row.assistantProtocol,
    model: entry.model ?? row.defaultModel,
    transport: entry.transport ?? row.transport,
    executable: entry.executable ?? row.executable,
  };
}

/**
 * Recognizes an OpenAI structured-outputs "closed" JSON Schema: every object
 * level declares `additionalProperties: false` with `required` covering
 * exactly its declared properties, checked recursively through nested
 * object and array schemas. This is the exact structural precondition
 * OpenAI-compatible providers document for `strict: true` json_schema
 * response-format enforcement; a schema failing it still gets
 * `type: "json_schema"` provider-side shaping, just with `strict: false`
 * so an open or partial schema is never rejected outright by the provider.
 * @param {object} schema
 * @returns {boolean}
 */
export function isClosedJsonSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.$ref) return false;
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (schema[key] && (!Array.isArray(schema[key]) || !schema[key].every(isClosedJsonSchema))) return false;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const keys = Object.keys(properties);
    if (schema.additionalProperties !== false || !Array.isArray(schema.required) || schema.required.length !== keys.length || !keys.every(key => schema.required.includes(key))) return false;
    return keys.every(key => isClosedJsonSchema(properties[key]));
  }
  if (types.includes("array") && schema.items !== undefined) return isClosedJsonSchema(schema.items);
  return true;
}

/**
 * Builds one OpenAI-compatible `response_format` body field for a customer
 * output schema. `strict` is computed, never customer-declared: true only
 * when {@link isClosedJsonSchema} holds, so a non-closed schema still gets
 * provider-side JSON-schema shaping without a spurious enforcement promise
 * the schema cannot satisfy.
 * @param {object} schema - the customer's Draft 2020-12 output schema
 * @param {string} [name] - the json_schema name, default "customer_output_contract"
 * @returns {{type: "json_schema", json_schema: {name: string, schema: object, strict: boolean}}}
 */
export function openAiJsonSchemaResponseFormat(schema, name = "customer_output_contract") {
  return Object.freeze({ type: "json_schema", json_schema: { name, schema, strict: isClosedJsonSchema(schema) } });
}


function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function csv(value) {
  const text = nonEmpty(value);
  return text ? text.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "") : [];
}

/**
 * Resolve `{ENV_VAR_NAME}` placeholders in a descriptor endpoint (e.g. a
 * Cloudflare account id) from env, never baking the value into checked-in
 * JSON. Returns null on any unresolved placeholder, treated as under-config.
 * @param {string} template
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
function resolveEndpointTemplate(template, env) {
  let unresolved = false;
  const resolved = template.replace(/\{([A-Z][A-Z0-9_]*)\}/gu, (placeholder, name) => {
    const value = nonEmpty(env[name]);
    if (!value) { unresolved = true; return placeholder; }
    return value;
  });
  return unresolved ? null : resolved;
}

function authConfiguration(value, endpoint) {
  const auth = value === undefined ? Object.freeze({ mode: isCommandEndpoint({ endpoint }) ? "none" : "bearer" }) : value;
  if (!auth || typeof auth !== "object" || Array.isArray(auth) || !["bearer", "none"].includes(auth.mode)) {
    throw new TypeError("direct endpoint auth must have mode bearer or none");
  }
  if (auth.mode === "none") {
    if (isCommandEndpoint({ endpoint })) return Object.freeze({ mode: auth.mode });
    let address;
    try { address = new URL(endpoint); } catch { throw new TypeError("direct endpoint must be an absolute URL"); }
    if (!["127.0.0.1", "localhost", "::1"].includes(address.hostname)) {
      throw new TypeError("unauthenticated direct endpoints are permitted only on loopback");
    }
  }
  return Object.freeze({ mode: auth.mode });
}

function exactDimensions(value, category) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${category} must be an array`);
  return value.map((dimension, index) => {
    if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)) throw new TypeError(`${category}[${index}] must be one object`);
    const unit = nonEmpty(dimension.unit);
    const name = nonEmpty(category === "consideration" ? dimension.kind : dimension.resource);
    const asset = nonEmpty(dimension.asset);
    if (!unit || !name || (category === "consideration" && !asset)) throw new TypeError(`${category}[${index}] lacks its exact dimension identity`);
    return Object.freeze({
      ...(category === "consideration" ? { kind: name, asset } : { resource: name, ...(asset ? { asset } : {}) }),
      unit,
      amount: category === "consideration"
        ? exactAmount(String(dimension.amount?.numerator ?? dimension.numerator), String(dimension.amount?.denominator ?? dimension.denominator))
        : exactNonnegativeAmount(String(dimension.amount?.numerator ?? dimension.numerator), String(dimension.amount?.denominator ?? dimension.denominator)),
    });
  });
}

/**
 * Read one direct OpenAI-compatible endpoint provider descriptor from
 * environment configuration. Endpoint, credential, and model are always
 * config data, never source-coded literals; an under-configured descriptor
 * returns null rather than a partially-admitted provider.
 * @param {Record<string, string|undefined>} [env]
 * @returns {null|{
 *   provider: string, endpoint: string, apiKey: string, model: string,
 *   endpointClass: string, capabilities: string[], qualityTiers: string[],
 *   authorityScopes: string[], effects: string[], idempotence: string[],
 *   availableCapacity: number, declaredResources: object[], availableResources?: object[],
 *   considerationKind: string, considerationAsset: string, considerationUnit: string,
 *   considerationAmount: { numerator: string, denominator: string },
 * }}
 */
export function loadDirectEndpointProviderDescriptor(env = process.env, { resolveAccountEntitlement, pricingRoot = pricingRootOf(env), availabilityObservations } = {}) {
  return normalizeDirectEndpointDescriptor({
    provider: env.DIRECT_ENDPOINT_PROVIDER_ACTOR,
    endpoint: env.DIRECT_ENDPOINT_PROVIDER_ENDPOINT,
    apiKey: env.DIRECT_ENDPOINT_PROVIDER_API_KEY,
    auth: env.DIRECT_ENDPOINT_PROVIDER_AUTH_MODE ? { mode: env.DIRECT_ENDPOINT_PROVIDER_AUTH_MODE } : undefined,
    model: env.DIRECT_ENDPOINT_PROVIDER_MODEL,
    endpointClass: env.DIRECT_ENDPOINT_PROVIDER_ENDPOINT_CLASS,
    capabilities: csv(env.DIRECT_ENDPOINT_PROVIDER_CAPABILITIES),
    qualityTiers: csv(env.DIRECT_ENDPOINT_PROVIDER_QUALITY_TIERS),
    authorityScopes: csv(env.DIRECT_ENDPOINT_PROVIDER_AUTHORITY_SCOPES),
    effects: csv(env.DIRECT_ENDPOINT_PROVIDER_EFFECTS),
    idempotence: csv(env.DIRECT_ENDPOINT_PROVIDER_IDEMPOTENCE),
    availableCapacity: env.DIRECT_ENDPOINT_PROVIDER_CAPACITY,
    availableResources: env.DIRECT_ENDPOINT_PROVIDER_AVAILABLE_RESOURCES
      ? JSON.parse(env.DIRECT_ENDPOINT_PROVIDER_AVAILABLE_RESOURCES)
      : undefined,
    considerationKind: env.DIRECT_ENDPOINT_PROVIDER_CONSIDERATION_KIND,
    considerationAsset: env.DIRECT_ENDPOINT_PROVIDER_CONSIDERATION_ASSET,
    considerationUnit: env.DIRECT_ENDPOINT_PROVIDER_CONSIDERATION_UNIT,
    considerationNumerator: env.DIRECT_ENDPOINT_PROVIDER_CONSIDERATION_NUMERATOR,
    considerationDenominator: env.DIRECT_ENDPOINT_PROVIDER_CONSIDERATION_DENOMINATOR,
  }, env, resolveAccountEntitlement, pricingRoot, availabilityObservations);
}

/**
 * Normalize one descriptor entry (from environment variables or one
 * DIRECT_ENDPOINT_PROVIDERS array element) to the frozen descriptor shape.
 * An entry may carry `apiKeyEnv` naming the environment variable holding its
 * credential instead of an inline `apiKey`, and its `endpoint` may carry
 * `{ENV_VAR_NAME}` placeholders (see resolveEndpointTemplate) for an
 * account-scoped path; under-configuration returns null.
 * @param {Record<string, unknown>} entry
 * @param {Record<string, string|undefined>} env
 */
function normalizeDirectEndpointDescriptor(entry, env = process.env, resolveAccountEntitlement, pricingRoot = pricingRootOf(env), availabilityObservations) {
  if (!entry || typeof entry !== "object") return null;
  const provider = nonEmpty(entry.provider ?? entry.actor);
  const transport = nonEmpty(entry.transport);
  const endpointTemplate = nonEmpty(entry.endpoint) ?? (transport ? `command:${transport}` : null);
  const endpoint = endpointTemplate ? resolveEndpointTemplate(endpointTemplate, env) : null;
  const apiKey = nonEmpty(entry.apiKey) ?? (nonEmpty(entry.apiKeyEnv) ? nonEmpty(env[entry.apiKeyEnv.trim()]) : null);
  const model = nonEmpty(entry.model);
  if (!provider || !endpoint || !model) return null;
  const auth = authConfiguration(entry.auth, endpoint);
  if (auth.mode === "bearer" && !apiKey) return null;
  const asList = (value) => Array.isArray(value) ? value.map((item) => nonEmpty(item)).filter(Boolean) : csv(value);
  const capacity = Number(entry.availableCapacity ?? "1");
  const declaredResources = exactDimensions(entry.declaredResources, "resources");
  const availableResources = entry.availableResources === undefined
    ? undefined
    : exactDimensions(entry.availableResources, "resources");
  const entitlementFacts = { provider, endpoint, model, apiKey };
  const entitlementResolver = (facts) => resolveAccountEntitlement?.(facts) ?? null;
  const accountEntitlement = entitlementResolver(entitlementFacts);
  const credentialSha256 = apiKey ? sha256Hex(apiKey) : null;
  const identity = credentialSha256 ? `${provider}:${credentialSha256}` : provider;
  if (pricingRoot) restoreProviderAvailability(provider,
    latestProviderAvailability(provider, credentialSha256, { dataRoot: pricingRoot, ...(availabilityObservations ? { observations: availabilityObservations } : {}) }), { identity });
  const availability = currentProviderAvailability(provider, { identity });
  // Each placement compares offers by consideration per accepted result, so an offer is priced by
  // what drawing its own allowance costs now, not by a constant every offer declares alike.
  const allowance = nonEmpty(entry.allowance);
  const allowanceStore = allowance === null ? undefined : allowanceLedgerPath(env);
  const share = allowanceShareOf(allowance, allowanceStore);
  const descriptor = {
    provider,
    ...(nonEmpty(entry.providerId) ? { providerId: nonEmpty(entry.providerId) } : {}),
    ...(transport ? { transport, executable: nonEmpty(entry.executable) } : {}),
    ...(entry.assistantProtocol ? { assistantProtocol: entry.assistantProtocol } : {}),
    endpoint,
    auth,
    ...(apiKey ? { apiKey } : {}),
    ...(credentialSha256 ? { credentialSha256 } : {}),
    model,
    ...(entry.capabilityModels ? { capabilityModels: Object.freeze(structuredClone(entry.capabilityModels)) } : {}),
    ...(entry.zeroCashPolicy ? { zeroCashPolicy: Object.freeze(structuredClone(entry.zeroCashPolicy)) } : {}),
    zeroCashEligible: entry.zeroCashPolicy?.local === true && ["127.0.0.1","localhost","[::1]"].includes(new URL(endpoint).hostname)
      || (entry[CATALOG_ROW]?.chatCompletionsUrl === endpointTemplate && isZeroCashProvider(entry[CATALOG_ROW], model))
      || accountEntitlement !== null,
    ...(accountEntitlement ? { accountEntitlement } : {}),
    endpointClass: nonEmpty(entry.endpointClass) ?? DEFAULT_ENDPOINT_CLASS,
    // Only a declared (or provider-policy) allocation is advertised; an endpoint
    // that declares none offers no output ceiling and requests carry no max_tokens.
    ...optionalOutputTokens(allocateProviderOutputTokens({ providerId: entry.providerId, chatCompletionsUrl: endpoint },
      Number.isSafeInteger(entry.maximumOutputTokens) && entry.maximumOutputTokens > 0 ? entry.maximumOutputTokens : undefined)),
    capabilities: asList(entry.capabilities),
    qualityTiers: asList(entry.qualityTiers),
    authorityScopes: asList(entry.authorityScopes),
    effects: asList(entry.effects),
    idempotence: asList(entry.idempotence),
    availableCapacity: availability?.state === "dead" || (availability?.state === "suspect" && availability.backoffUntil !== null) ? 0
      : Math.min(Number.isSafeInteger(capacity) && capacity >= 0 ? capacity : 1,
        Number.isSafeInteger(availability?.quota?.remaining) ? availability.quota.remaining : Infinity),
    declaredResources,
    ...(availableResources === undefined ? {} : { availableResources }),
    ...(availability ? { providerReading: availability } : {}),
    ...(entry.availabilityEvidence === undefined ? {} : { availabilityEvidence: entry.availabilityEvidence }),
    considerationKind: nonEmpty(entry.considerationKind) ?? "credit",
    considerationAsset: nonEmpty(entry.considerationAsset) ?? `urn:ame:${provider.replace(/^urn:ame:/u, "")}:development-consideration`,
    considerationUnit: nonEmpty(entry.considerationUnit) ?? "invocation",
    considerationAmount: share.exhausted
      ? exactAmount(String(entry.considerationNumerator ?? "1"), String(entry.considerationDenominator ?? "1"))
      : pricedConsideration(String(entry.considerationNumerator ?? "1"), String(entry.considerationDenominator ?? "1"), share.price),
    allowanceShare: Object.freeze(share),
  };
  // A window spent out offers nothing until it turns.
  if (share.exhausted) descriptor.availableCapacity = 0;
  const admitted = Object.freeze({
    ...descriptor,
    configurationIdentity: directEndpointConfigurationIdentity(descriptor),
  });
  if (accountEntitlement) accountEntitlementVerifiers.set(admitted, entitlementResolver);
  if (allowanceStore !== undefined) allowanceLedgerCustody.set(admitted, allowanceStore);
  return admitted;
}

/**
 * What drawing one more unit of a descriptor's allowance costs now (organizing `perishablePrice` read
 * off the allowance ledger): near nothing for capacity that will lapse unspent at its window's turn,
 * the full unit for capacity the window will spend anyway, exhausted when a window is spent out. A
 * descriptor that names no allowance, or whose ledger cannot be read, is priced at the unit: an
 * unknown is never free.
 */
function allowanceShareOf(allowanceId, storePath) {
  if (allowanceId === null) return { price: 1, exhausted: false, allowance: null };
  try {
    const share = perishablePrice(readAllowanceLedger(subscriptionAllowance(allowanceId), { storePath }).reading);
    // A window spent out has no price, only when it turns: the share is identified as content (a JSON
    // value), so it never carries perishablePrice's unbounded price.
    return { ...(share.exhausted ? {} : { price: share.price }), exhausted: share.exhausted, allowance: allowanceId, binding: share.binding, ...(share.until ? { until: share.until } : {}) };
  } catch {
    return { price: 1, exhausted: false, allowance: allowanceId, unread: true };
  }
}

/**
 * A response's statement of its provider's request window, as a reading of the descriptor's
 * allowance (a `stated` meter in percent of the window), so the allowance's perishable price is read
 * off the provider's own windows. A response stating no window records nothing; a ledger that cannot
 * be written never fails the exchange.
 */
function recordWindowReading(descriptor, response, execution) {
  const allowanceId = descriptor.allowanceShare?.allowance;
  if (typeof allowanceId !== "string") return;
  const at = new Date(execution.now?.() ?? Date.now()).toISOString();
  const window = providerWindowStatement(response, at);
  if (window === null) return;
  const storePath = allowanceLedgerCustody.get(descriptor);
  if (storePath === undefined) return;
  const used = Math.round(((window.limit - window.remaining) / window.limit) * 10_000) / 100;
  try {
    recordAllowanceEvidence(subscriptionAllowance(allowanceId), [{ type: "reading", meter: "requests", at, used, resetsAt: window.resetsAt, source: `reading:${allowanceId}:requests:${window.resetsAt}:${used}` }], { storePath });
  } catch { /* the reading is evidence for pricing, not a condition of the exchange */ }
}

/** The declared consideration scaled by the allowance's current price, as an exact ratio. */
function pricedConsideration(numerator, denominator, price) {
  const millionths = BigInt(Math.max(1, Math.round(price * 1_000_000)));
  return exactAmount(String(BigInt(numerator) * millionths), String(BigInt(denominator) * 1_000_000n));
}

/** Rechecks account-dependent admission at each attempt rather than trusting a startup snapshot.
 * @param {object} descriptor A server-loaded endpoint descriptor.
 * @returns {boolean} Whether the exact endpoint/model/current credential remains admitted.
 */
export function isDirectEndpointZeroCashEligible(descriptor) {
  if (isCommandEndpoint(descriptor)) return false;
  if (descriptor?.accountEntitlement) return accountEntitlementVerifiers.get(descriptor)?.(descriptor) != null;
  return descriptor?.zeroCashEligible === true;
}

/** Admission facts shared by planning inspection and the actual direct lane. */
export function directEndpointAdmissionReasons(descriptor, { zeroCashOnly = false } = {}) {
  const reasons = [];
  if (descriptor.availableCapacity < 1) reasons.push("no-available-capacity");
  if (zeroCashOnly && isCommandEndpoint(descriptor)) reasons.push("subscription-provider-excluded-from-zero-cash-market");
  else if (zeroCashOnly && !isDirectEndpointZeroCashEligible(descriptor)) reasons.push("zero-cash-entitlement-not-admitted");
  if (descriptor.availabilityEvidence?.available === false) reasons.push("provider-observed-unavailable");
  return reasons;
}

/**
 * Identifies credential-free execution facts for one direct endpoint.
 * @param {{provider: string, model: string, endpoint: string, endpointClass: string, maximumOutputTokens: number, reasoningEffort?: string}} descriptor
 * @returns {string}
 */
export function directEndpointConfigurationIdentity(descriptor, execution = {}) {
  if (!descriptor || typeof descriptor !== "object") throw new TypeError("one direct endpoint descriptor is required");
  return executionConfigurationIdentity(directEndpointExecutionConfiguration(descriptor, execution));
}

export function directEndpointExecutionConfiguration(descriptor, execution = {}) {
  if (!descriptor || typeof descriptor !== "object") throw new TypeError("one direct endpoint descriptor is required");
  const maximumOutputTokens = allocateProviderOutputTokens({ providerId: descriptor.providerId, chatCompletionsUrl: descriptor.endpoint },
    smallestAccountedOutputTokens(descriptor.maximumOutputTokens, execution.maximumOutputTokens));
  const protocol = descriptor.assistantProtocol ?? (isCommandEndpoint(descriptor) ? "json-envelope" : null);
  return Object.freeze({
    provider: nonEmpty(descriptor.provider), model: nonEmpty(descriptor.model),
    endpoint: nonEmpty(descriptor.endpoint), executionClass: nonEmpty(descriptor.endpointClass),
    ...optionalOutputTokens(maximumOutputTokens),
    ...(protocol ? { mode: `${execution.interaction ?? "tool-agent"}:${descriptor.transport ?? "http"}:${protocol}:v1` } : execution.interaction ? { mode: execution.interaction } : {}),
  });
}

/**
 * Projects witnessed receiver exchanges to exact resource measurements without
 * treating absent usage or account-window identity as zero or unlimited.
 * Token totals are independent provider observations, never reconstructed from
 * components or added to the input/output dimensions as another token charge.
 * @param {ReadonlyArray<object>} exchanges
 * @param {{provider: string, accountIdentity?: string, windowIdentity?: string, durationMs?: number, networkBytes?: number}} scope
 * @returns {{scope: object, resources: ReadonlyArray<object>, partialResources: ReadonlyArray<object>, callerObservedResources: ReadonlyArray<object>, uncertainty: ReadonlyArray<string>}}
 */
function decimalRatio(text) {
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const shift = BigInt(fraction.length) - BigInt(exponent);
  const digits = BigInt(`${whole}${fraction}`);
  return shift >= 0n ? { numerator: digits, denominator: 10n ** shift } : { numerator: digits * 10n ** -shift, denominator: 1n };
}
const addRatios = (left, right) => ({ numerator: left.numerator * right.denominator + right.numerator * left.denominator, denominator: left.denominator * right.denominator });

export function measuredExchangeResources(exchanges, scope) {
  if (!Array.isArray(exchanges) || !scope || typeof scope.provider !== "string" || scope.provider.trim() === "") return Object.freeze({ scope: null, resources: Object.freeze([]), partialResources: Object.freeze([]), callerObservedResources: Object.freeze([]), uncertainty: Object.freeze(["measurement-scope-invalid"]) });
  const tokenReadings = [
    ["promptTokens", "input-tokens"],
    ["outputTokens", "output-tokens"],
    ["totalTokens", "total-tokens"],
  ].map(([field, resource]) => {
    let amount = 0n;
    let observed = 0;
    for (const exchange of exchanges) {
      const value = exchange?.usage?.[field];
      if (Number.isSafeInteger(value) && value >= 0) {
        amount += BigInt(value);
        observed += 1;
      }
    }
    return { resource, unit: "token", amount, observed };
  });
  // The provider's own statement of what each exchange cost, summed exactly; unit and asset are the provider's.
  const reportedCosts = exchanges.map((exchange) => exchange?.usage?.reportedCost).filter((value) => typeof value === "string");
  const reportedCost = reportedCosts.length === 0 ? null : reportedCosts.map(decimalRatio).reduce(addRatios);
  const resources = [
    ...(exchanges.length > 0 ? [{ resource: "requests", unit: "request", amount: BigInt(exchanges.length) }] : []),
    ...tokenReadings.filter((reading) => exchanges.length > 0 && reading.observed === exchanges.length),
    ...(reportedCost && reportedCosts.length === exchanges.length ? [{ resource: "reported-cost", unit: "provider-cost-unit", asset: scope.provider, ratio: reportedCost }] : []),
    ...(Number.isSafeInteger(scope.durationMs) && scope.durationMs >= 0 ? [{ resource: "duration", unit: "millisecond", amount: scope.durationMs }] : []),
  ].map(({ resource, unit, asset, amount, ratio }) => Object.freeze({ resource, unit, ...(asset ? { asset } : {}), amount: ratio ? exactNonnegativeAmount(String(ratio.numerator), String(ratio.denominator)) : exactNonnegativeAmount(String(amount), "1") }));
  const partialResources = tokenReadings
    .filter((reading) => reading.observed > 0 && reading.observed < exchanges.length)
    .map(({ resource, unit, amount }) => Object.freeze({ resource, unit, amount: exactNonnegativeAmount(String(amount), "1") }));
  const callerObservedResources = Number.isSafeInteger(scope.networkBytes) && scope.networkBytes >= 0
    ? Object.freeze([Object.freeze({ resource: "network-bytes", unit: "byte", amount: exactNonnegativeAmount(String(scope.networkBytes), "1"), provenance: "caller-observed" })])
    : Object.freeze([]);
  const uncertainty = [];
  if (exchanges.length === 0) uncertainty.push("completed-exchange-count-unknown");
  for (const reading of tokenReadings) {
    if (reading.observed !== exchanges.length) uncertainty.push(reading.resource.replace("-tokens", "-token-usage-incomplete"));
  }
  // An unreported cost is unmeasured, never zero.
  if (exchanges.length > 0 && reportedCosts.length !== exchanges.length) uncertainty.push("provider-reported-cost-incomplete");
  if (![scope.accountIdentity, scope.windowIdentity].every((value) => typeof value === "string" && value.trim() !== "")) uncertainty.push("account-window-identity-unknown");
  if (scope.networkBytes !== undefined) uncertainty.push("network-bytes-caller-observed");
  return Object.freeze({ scope: Object.freeze({ providerIdentity: scope.provider, accountIdentity: scope.accountIdentity ?? null, windowIdentity: scope.windowIdentity ?? null, measurementCoverage: "completed-exchanges" }), resources: Object.freeze(resources), partialResources: Object.freeze(partialResources), callerObservedResources, uncertainty: Object.freeze(uncertainty) });
}

/**
 * Load every configured direct endpoint provider descriptor, in customer
 * preference order: the DIRECT_ENDPOINT_PROVIDERS environment variable (one
 * JSON array of descriptor entries; each may name apiKeyEnv rather than an
 * inline credential) followed by the legacy single-descriptor variables. A
 * malformed array is a configuration error and throws rather than silently
 * yielding an empty market lane; individually under-configured entries are
 * skipped as with the single loader.
 * @param {Record<string, string|undefined>} [env]
 * @returns {ReadonlyArray<NonNullable<ReturnType<typeof loadDirectEndpointProviderDescriptor>>>}
 */
// The package's own admission carrier is the default source. An explicit
// configPath (DIRECT_ENDPOINT_PROVIDER_CONFIG through the caller) replaces
// the carrier; a DIRECT_ENDPOINT_PROVIDERS list replaces it too unless a
// configPath was given explicitly, in which case the list adds entries.
/** The smallest output allocation a caller or provider actually accounts; undefined when none is accounted. */
function smallestAccountedOutputTokens(...values) {
  const accounted = values.filter((value) => Number.isSafeInteger(value) && value > 0);
  return accounted.length === 0 ? undefined : Math.min(...accounted);
}

function optionalOutputTokens(value) {
  return Number.isSafeInteger(value) && value > 0 ? { maximumOutputTokens: value } : {};
}

export const DEFAULT_DIRECT_ENDPOINT_PROVIDER_CONFIG = fileURLToPath(new URL("../../content/dispatch/provider-admissions/direct-endpoint-providers.json", import.meta.url));

export function loadDirectEndpointProviderDescriptors(env = process.env, { configPath, catalogPath, accountEntitlements, accountEntitlementsPath = env.DIRECT_ENDPOINT_ACCOUNT_ENTITLEMENTS, pricingRoot = pricingRootOf(env), now } = {}) {
  const descriptors = [];
  const availabilityObservations = pricingRoot ? loadObservations({ dataRoot: pricingRoot }) : [];
  const observations = accountEntitlements ?? (accountEntitlementsPath ? JSON.parse(readFileSync(accountEntitlementsPath, "utf8")) : []);
  const resolveAccountEntitlement = createProviderAccountEntitlementResolver(observations, { now });
  const catalogRowsById = providerCatalogRowsById(catalogPath);
  const explicitList = nonEmpty(env.DIRECT_ENDPOINT_PROVIDERS) !== null;
  if (configPath === undefined && !explicitList) configPath = DEFAULT_DIRECT_ENDPOINT_PROVIDER_CONFIG;
  if (configPath && existsSync(configPath)) {
    const carrier = JSON.parse(readFileSync(configPath, "utf8"));
    const entries = Array.isArray(carrier) ? carrier : carrier?.providers;
    if (!Array.isArray(entries)) throw new Error("direct endpoint provider config must contain one providers array");
    for (const entry of entries) {
      const descriptor = normalizeDirectEndpointDescriptor(withCatalogFacts(entry, catalogRowsById), env, resolveAccountEntitlement, pricingRoot, availabilityObservations);
      if (descriptor) descriptors.push(descriptor);
    }
  }
  const raw = nonEmpty(env.DIRECT_ENDPOINT_PROVIDERS);
  if (raw) {
    let entries;
    try { entries = JSON.parse(raw); } catch (error) {
      throw new Error("DIRECT_ENDPOINT_PROVIDERS must be one JSON array of direct endpoint descriptor entries", { cause: error });
    }
    if (!Array.isArray(entries)) throw new Error("DIRECT_ENDPOINT_PROVIDERS must be one JSON array of direct endpoint descriptor entries");
    for (const entry of entries) {
      const descriptor = normalizeDirectEndpointDescriptor(withCatalogFacts(entry, catalogRowsById), env, resolveAccountEntitlement, pricingRoot, availabilityObservations);
      if (descriptor) descriptors.push(descriptor);
    }
  }
  const single = loadDirectEndpointProviderDescriptor(env, { resolveAccountEntitlement, pricingRoot, availabilityObservations });
  if (single && !descriptors.some((descriptor) => descriptor.configurationIdentity === single.configurationIdentity)) descriptors.push(single);
  return Object.freeze(descriptors);
}

/**
 * Re-read direct endpoint admission at the start of a zero-cash attempt.
 * Account-entitlement validity is time-bound, so callers must not retain a
 * descriptor chosen by an earlier attempt. The loader is deliberately pure
 * and uncached; this asynchronous boundary makes that fresh-read requirement
 * explicit to dispatch without turning provider admission into a side effect.
 * @param {Record<string, string|undefined>} [env]
 * @param {Parameters<typeof loadDirectEndpointProviderDescriptors>[1]} [options]
 * @returns {Promise<ReadonlyArray<NonNullable<ReturnType<typeof loadDirectEndpointProviderDescriptor>>>>}
 */
export async function refreshDirectEndpointProviderDescriptors(env = process.env, options = {}) {
  return loadDirectEndpointProviderDescriptors(env, options);
}

/**
 * Build one provider-neutral NormalizedWorkOffer for work placement.
 * from a direct endpoint descriptor and the demand it is being offered against.
 * Purely data: it performs no network call and holds no transport.
 * @param {ReturnType<typeof loadDirectEndpointProviderDescriptor>} descriptor
 * @param {{ taskClass: string }} demand
 * @returns {object} one NormalizedWorkOffer
 */
export function directEndpointOffer(descriptor, demand, execution = {}, availabilityEvidence = descriptor?.availabilityEvidence) {
  if (!descriptor) throw new Error("one direct endpoint provider descriptor is required");
  if (!demand || typeof demand.taskClass !== "string" || demand.taskClass.trim() === "") throw new Error("one demand naming a taskClass is required");
  const configurationIdentity = directEndpointConfigurationIdentity({ ...descriptor, endpointClass: descriptor.endpointClass ?? DEFAULT_ENDPOINT_CLASS, ...optionalOutputTokens(descriptor.maximumOutputTokens) }, execution);
  return Object.freeze({
    type: "NormalizedWorkOffer",
    id: `urn:offer:direct-endpoint:${descriptor.provider}:${configurationIdentity.split(";").at(-1)}:${demand.taskClass}`,
    provider: descriptor.provider,
    executionClass: descriptor.endpointClass,
    operation: demand.taskClass,
    implementationIdentity: configurationIdentity,
    configurationIdentity,
    capabilities: descriptor.capabilities,
    qualityTiers: descriptor.qualityTiers,
    authorityScopes: descriptor.authorityScopes,
    effects: descriptor.effects,
    idempotence: descriptor.idempotence,
    dataConstraints: [],
    custodyConstraints: [],
    outputContractIdentities: [demand.outputContract.identity],
    availability: "available",
    availableCapacity: descriptor.availableCapacity,
    bounds: {},
    consideration: [{
      kind: descriptor.considerationKind,
      asset: descriptor.considerationAsset,
      unit: descriptor.considerationUnit,
      amount: descriptor.considerationAmount,
    }],
    declaredResources: descriptor.declaredResources,
    ...(descriptor.availableResources === undefined ? {} : { availableResources: descriptor.availableResources }),
    ...(availabilityEvidence === undefined ? {} : { availabilityEvidence: { ...availabilityEvidence, offerId: `urn:offer:direct-endpoint:${descriptor.provider}:${configurationIdentity.split(";").at(-1)}:${demand.taskClass}`, providerIdentity: descriptor.provider } }),
    semantics: { reuse: "none" },
  });
}

/**
 * Invoke the selected direct endpoint offer through an injected
 * OpenAI-compatible transport shaped like
 * `@red-cup-engineering/computer-platform/agents`'s
 * `executeOpenAiCompatibleToolAgent` (its `{provider, endpoint, apiKey,
 * model, messages, tools, toolHandlers}` call convention, returning a
 * `ReceiverOwnedToolAgentCompletion`). The transport is never imported
 * directly here -- it stays swappable/stubbable, and this module stays
 * dependency-light the same way ./inference-demand-classification.mjs does.
 * A thrown transport failure remains a failed invocation. A typed adapter
 * residue is returned with its bounded, redacted evidence intact so the
 * route may refuse this offer without erasing completed provider work.
 * @param {ReturnType<typeof loadDirectEndpointProviderDescriptor>} descriptor
 * @param {{ messages: object[], tools?: object[], toolHandlers?: Record<string, Function> }} demand
 * @param {{ invoke: (call: object) => Promise<object> }} transport
 * @returns {Promise<{ disposition: "delivered", provider: string, model: string, text: string, durationMs: number|null }>}
 */
export async function dispatchDirectEndpointOffer(descriptor, demand, { invoke } = {}) {
  if (!descriptor) throw new Error("one direct endpoint provider descriptor is required");
  if (!isCommandEndpoint(descriptor) && typeof invoke !== "function") throw new Error("dispatching a direct endpoint offer requires one injected transport function");
  if (!Array.isArray(demand?.messages) || demand.messages.length === 0) throw new Error("one nonempty message sequence is required to dispatch a direct endpoint offer");
  const execution = demand.execution ?? {};
  for (const field of ["provider", "providerId", "transport", "executable", "assistantProtocol", "endpoint", "apiKey", "auth", "model", "reasoningEffort"]) {
    if (execution[field] !== undefined) throw new Error(`direct endpoint execution cannot override selected ${field}`);
  }
  if (execution.zeroCashOnly && !isDirectEndpointZeroCashEligible(descriptor)) throw new Error("zero-cash-entitlement-not-admitted");
  invoke ??= executeReceiverToolAgent;
  const credentialSha256 = descriptor.apiKey ? sha256Hex(descriptor.apiKey) : null;
  const readingOptions = { ...(execution.now === undefined ? {} : { now: execution.now }),
    identity: credentialSha256 ? `${descriptor.provider}:${credentialSha256}` : descriptor.provider };
  const recordReading = (reading) => {
    if (execution.pricingRoot && reading) appendProviderAvailability(reading, credentialSha256, { dataRoot: execution.pricingRoot });
    return reading;
  };
  let observedExchange = false;
  let rejectedBodyBytes;
  let locallyRejectedBody = false;
  const bodyLimitRefusal = () => Object.freeze({
    disposition: "refused", provider: descriptor.provider, model: descriptor.model,
    reason: "provider-request-exceeds-observed-body-limit",
    cause: { kind: "local-admission", reason: "provider-request-exceeds-observed-body-limit" },
    durationMs: 0, toolInvocations: Object.freeze([]), exchanges: Object.freeze([]),
  });
  const checkedFetch = async (...args) => {
    if (execution.zeroCashOnly && !isDirectEndpointZeroCashEligible(descriptor)) throw new Error("zero-cash-entitlement-not-admitted");
    const body = args[1]?.body;
    const admissionRead = args[2]?.purpose === "provider-admission";
    const bodyBytes = typeof body === "string" ? Buffer.byteLength(body) : body instanceof Uint8Array ? body.byteLength : null;
    if (bodyBytes !== null && execution.pricingRoot) {
      const configurationIdentity = directEndpointConfigurationIdentity(descriptor, execution);
      const priorLimits = loadObservations({ dataRoot: execution.pricingRoot }).filter((row) => row.kind === "provider-refusal"
        && row.status === 413 && row.provider === descriptor.provider && row.configurationIdentity === configurationIdentity
        && row.credentialSha256 === descriptor.credentialSha256 && Number.isSafeInteger(row.requestBytes));
      if (priorLimits.some((row) => bodyBytes >= row.requestBytes)) {
        locallyRejectedBody = true;
        const error = new Error("provider-request-exceeds-observed-body-limit");
        error.code = "provider-request-exceeds-observed-body-limit";
        throw error;
      }
    }
    let response;
    try {
      response = await (execution.fetchImpl ?? globalThis.fetch)(args[0], args[1]);
    } catch (error) {
      observedExchange = true;
      if (!execution.signal?.aborted) recordReading(observeProviderObstruction(descriptor.provider, { reason: "provider-transport-failed" }, readingOptions));
      throw error;
    }
    observedExchange = true;
    if (response.status === 413 && bodyBytes !== null) rejectedBodyBytes = bodyBytes;
    // Successful admission reads establish account/model eligibility only. They
    // cannot clear a completion 429 or spend a completion request in the quota.
    // A failed admission read still obstructs this provider's next attempt.
    recordWindowReading(descriptor, response, execution);
    let observedReading;
    if (!admissionRead || response.ok !== true) {
      observedReading = observeProviderAvailability(descriptor.provider, response, readingOptions);
      // A successful completion spends one request. Provider-authored quota
      // headers already describe the post-exchange balance; never subtract twice.
      if (response.ok === true) observedReading = observeProviderHired(descriptor.provider, { remaining: providerRemainingRequests(response) ?? undefined }, readingOptions);
    }
    recordReading(observedReading);
    return response;
  };
  let result;
  try {
    result = await invoke({
    provider: descriptor.provider,
    providerId: descriptor.providerId,
    transport: descriptor.transport,
    executable: descriptor.executable,
    assistantProtocol: descriptor.assistantProtocol,
    endpoint: descriptor.endpoint,
    auth: descriptor.auth,
    ...(descriptor.apiKey ? { apiKey: descriptor.apiKey } : {}),
    model: descriptor.model,
    // No fixed deadline: a long-thinking model takes minutes; the caller's signal governs cancellation.
    timeoutMs: null,
    ...execution,
    fetchImpl: checkedFetch,
    checkAdmission: () => { if (execution.zeroCashOnly && !isDirectEndpointZeroCashEligible(descriptor)) throw new Error("zero-cash-entitlement-not-admitted"); },
    ...optionalOutputTokens(directEndpointExecutionConfiguration(descriptor, execution).maximumOutputTokens),
    ...(demand.chatCompletion ? { chatCompletion: demand.chatCompletion } : {
      messages: demand.messages,
      tools: demand.tools ?? [],
      toolHandlers: demand.toolHandlers ?? {},
      ...(demand.responseFormat ? { responseFormat: demand.responseFormat } : {}),
    }),
    });
  } catch (error) {
    if (locallyRejectedBody) return bodyLimitRefusal();
    if (!observedExchange && !execution.signal?.aborted && error?.message !== "zero-cash-entitlement-not-admitted") recordReading(observeProviderObstruction(descriptor.provider, { reason: "provider-transport-failed" }, readingOptions));
    throw error;
  }
  if (locallyRejectedBody) return bodyLimitRefusal();
  if (result?.type === "ReceiverOwnedToolAgentResidue") {
    // HTTP headers witness request consumption; they do not witness a usable exchange.
    // Record body/assistant failures even when an earlier 200 reading marked it alive.
    const failedExchange = result.cause?.kind === "transport" || result.cause?.kind === "protocol";
    if (!execution.signal?.aborted && result.cause?.kind !== "resource" && result.cause?.kind !== "cancelled" && (!observedExchange || failedExchange)) {
      const reason = result.cause?.phase ? `${result.cause.phase}:${result.cause.reason}` : result.cause?.reason ?? result.disposition ?? "provider-refusal";
      recordReading(observeProviderObstruction(descriptor.provider, { reason }, readingOptions));
    }
    return Object.freeze({
      disposition: "refused",
      provider: result.provider ?? descriptor.provider,
      model: result.model ?? descriptor.model,
      reason: result.disposition ?? "provider-residue",
      cause: result.cause ?? null,
      durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
      toolInvocations: Object.freeze(result.invocations ?? []),
      exchanges: Object.freeze(result.exchanges ?? []),
      ...(rejectedBodyBytes === undefined ? {} : { requestBytes: rejectedBodyBytes }),
    });
  }
  const delivered = demand.chatCompletion
    ? result?.type === "ReceiverOwnedAssistantTurn" && result.response && typeof result.response === "object"
    : result?.type === "ReceiverOwnedToolAgentCompletion" && typeof result.text === "string";
  if (!delivered) {
    throw new Error(`direct endpoint provider ${descriptor.provider} did not deliver one completion (${result?.type ?? "no result"})`);
  }
  if (!observedExchange) observeProviderHired(descriptor.provider, {}, readingOptions);
  return Object.freeze({
    disposition: "delivered",
    provider: descriptor.provider,
    model: result.model ?? descriptor.model,
    ...(demand.chatCompletion ? { response: result.response } : { text: result.text, ...(result.messages ? { messages: result.messages } : {}) }),
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
    toolInvocations: Object.freeze(result.invocations ?? []),
    exchanges: Object.freeze(result.exchanges ?? []),
  });
}
