import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { decideWorkPlacement } from "../../src/dispatch/decide-work-placement.mjs";
import { directEndpointOffer, dispatchDirectEndpointOffer, isClosedJsonSchema, loadDirectEndpointProviderDescriptor, measuredExchangeResources, openAiJsonSchemaResponseFormat, refreshDirectEndpointProviderDescriptors } from "../../src/dispatch/direct-endpoint-provider.mjs";

const q = (numerator, denominator = 1) => ({ numerator: String(numerator), denominator: String(denominator) });

function demand(overrides = {}) {
  return {
    type: "TypedWorkDemand",
    id: "urn:demand:direct-endpoint",
    taskClass: "bounded-derivation",
    principal: "urn:actor:customer",
    requiredCapabilities: ["inquiry"],
    requiredQualityTiers: [],
    requiredEffects: ["read-only"],
    requiredExecutionClasses: ["direct-openai-compatible-endpoint"],
    idempotence: "idempotent",
    context: { identity: "ni:///sha-256;context", authorityScope: "urn:scope:local-dev", freshnessIdentity: "urn:freshness:immutable", dataConstraints: [], custodyConstraints: [] },
    outputContract: { identity: "ni:///sha-256;schema" },
    measures: {},
    routePolicy: {
      preferenceOrder: [["consideration"], ["acceptance-probability"], ["latency", "resources"]],
      considerationPreference: [],
      reuse: "forbid",
      unknownObservations: "choice-required",
    },
    ...overrides,
  };
}

const FULL_ENV = Object.freeze({
  DIRECT_ENDPOINT_PROVIDER_ACTOR: "urn:ame:local-ollama-team",
  DIRECT_ENDPOINT_PROVIDER_ENDPOINT: "http://127.0.0.1:11434/v1/chat/completions",
  DIRECT_ENDPOINT_PROVIDER_API_KEY: "unused-by-ollama",
  DIRECT_ENDPOINT_PROVIDER_MODEL: "gemma3:4b",
  DIRECT_ENDPOINT_PROVIDER_CAPABILITIES: "inquiry",
  DIRECT_ENDPOINT_PROVIDER_AUTHORITY_SCOPES: "urn:scope:local-dev",
  DIRECT_ENDPOINT_PROVIDER_EFFECTS: "read-only",
  DIRECT_ENDPOINT_PROVIDER_IDEMPOTENCE: "idempotent",
});

test("loadDirectEndpointProviderDescriptor returns null rather than a partially-configured provider", () => {
  assert.equal(loadDirectEndpointProviderDescriptor({}), null);
  assert.equal(loadDirectEndpointProviderDescriptor({ DIRECT_ENDPOINT_PROVIDER_ACTOR: "urn:ame:x" }), null);
});

test("loadDirectEndpointProviderDescriptor reads endpoint, credential, and model from config data only", () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  assert.equal(descriptor.provider, "urn:ame:local-ollama-team");
  assert.equal(descriptor.endpoint, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(descriptor.apiKey, "unused-by-ollama");
  assert.equal(descriptor.model, "gemma3:4b");
  assert.deepEqual(descriptor.auth, { mode: "bearer" });
  assert.deepEqual(descriptor.capabilities, ["inquiry"]);
  assert.deepEqual(descriptor.considerationAmount, q(1));
});

test("refreshDirectEndpointProviderDescriptors reads the current provider admission for each zero-cash attempt", async () => {
  const env = {
    DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{
      actor: "urn:ame:fixture-free-provider", endpoint: "https://fixture.example/v1/chat/completions", apiKey: "fixture-key", model: "first-model",
      capabilities: ["inquiry"], authorityScopes: ["urn:scope:bounded-inference-candidate"], effects: ["read-only"], idempotence: ["idempotent"],
    }]),
  };
  const first = await refreshDirectEndpointProviderDescriptors(env);
  env.DIRECT_ENDPOINT_PROVIDERS = JSON.stringify([{
    actor: "urn:ame:fixture-free-provider", endpoint: "https://fixture.example/v1/chat/completions", apiKey: "fixture-key", model: "second-model",
    capabilities: ["inquiry"], authorityScopes: ["urn:scope:bounded-inference-candidate"], effects: ["read-only"], idempotence: ["idempotent"],
  }]);
  const second = await refreshDirectEndpointProviderDescriptors(env);
  assert.equal(first[0].model, "first-model");
  assert.equal(second[0].model, "second-model");
  assert.notEqual(first, second);
});

test("the admitted Bare Cedar Fog Ollama descriptor uses auth none only on loopback", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const [descriptor] = loadDirectEndpointProviderDescriptors({}, { configPath: resolve(import.meta.dirname, "../../content/dispatch/provider-admissions/direct-endpoint-providers.json") });
  assert.equal(descriptor.provider, "urn:ame:bare-cedar-fog-npu-inference-team");
  assert.equal(descriptor.model, "llama3.2:3b");
  assert.deepEqual(descriptor.auth, { mode: "none" });
  assert.equal(Object.hasOwn(descriptor, "apiKey"), false);
  assert.deepEqual(descriptor.considerationAmount, q(1));
  assert.deepEqual(descriptor.declaredResources.map(({ resource }) => resource), ["provider-attention"]);
  assert.throws(() => loadDirectEndpointProviderDescriptors({ DIRECT_ENDPOINT_PROVIDERS: JSON.stringify([{ actor: "urn:ame:remote", endpoint: "https://example.test/v1", auth: { mode: "none" }, model: "m" }]) }), /only on loopback/u);
});

test("the provider admission carrier resolves external bearer credentials only by environment name", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const configPath = resolve(import.meta.dirname, "../../content/dispatch/provider-admissions/direct-endpoint-providers.json");
  const withoutCredentials = loadDirectEndpointProviderDescriptors({}, { configPath });
  assert.deepEqual(withoutCredentials.map(({ provider }) => provider), ["urn:ame:bare-cedar-fog-npu-inference-team", "urn:ame:bare-cedar-fog-codex-inference-team", "urn:ame:bare-cedar-fog-antigravity-inference-team"]);
  const env = { API_KEY_GROQ: "test-groq", API_KEY_OPENROUTER: "test-openrouter", API_KEY_GOOGLE_GEMINI: "test-gemini", API_KEY_INFERENCE_NVIDIA: "test-nvidia", API_KEY_CLOUDFLARE_WORKERS_AI: "test-cloudflare", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" };
  const descriptors = loadDirectEndpointProviderDescriptors(env, { configPath });
  assert.deepEqual(descriptors.map(({ provider }) => provider), [
    "urn:ame:bare-cedar-fog-npu-inference-team",
    "urn:ame:groq-inference-team",
    "urn:ame:openrouter-inference-team",
    "urn:ame:gemini-inference-team",
    "urn:ame:nvidia-inference-team",
    "urn:ame:cloudflare-workers-ai-inference-team",
    "urn:ame:bare-cedar-fog-codex-inference-team",
    "urn:ame:bare-cedar-fog-antigravity-inference-team",
  ]);
  const cloud = descriptors.filter(({ auth }) => auth.mode === "bearer");
  assert.deepEqual(cloud.map(({ auth }) => auth), Array(5).fill({ mode: "bearer" }));
  assert.deepEqual(cloud.map(({ apiKey }) => apiKey), ["test-groq", "test-openrouter", "test-gemini", "test-nvidia", "test-cloudflare"]);
  // The carrier is the default source: no configPath needed.
  assert.deepEqual(loadDirectEndpointProviderDescriptors(env).map(({ provider }) => provider), descriptors.map(({ provider }) => provider));
});

test("a call's cost is the provider's own report, summed exactly, and an unreported cost stays unmeasured", () => {
  const reported = measuredExchangeResources([
    { usage: { promptTokens: 10, outputTokens: 2, totalTokens: 12, reportedCost: "0.00015" } },
    { usage: { promptTokens: 5, outputTokens: 1, totalTokens: 6, reportedCost: "0" } },
  ], { provider: "urn:ame:fixture" });
  assert.deepEqual(reported.resources.find(({ resource }) => resource === "reported-cost"),
    { resource: "reported-cost", unit: "provider-cost-unit", asset: "urn:ame:fixture", amount: { numerator: "3", denominator: "20000" } });
  assert.ok(!reported.uncertainty.includes("provider-reported-cost-incomplete"));
  const unreported = measuredExchangeResources([{ usage: { promptTokens: 10, outputTokens: 2, totalTokens: 12, reportedCost: null } }], { provider: "urn:ame:fixture" });
  assert.equal(unreported.resources.find(({ resource }) => resource === "reported-cost"), undefined);
  assert.ok(unreported.uncertainty.includes("provider-reported-cost-incomplete"));
});

test("Codex is admitted as one bounded local command provider, not a duplicate endpoint", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const configPath = resolve(import.meta.dirname, "../../content/dispatch/provider-admissions/direct-endpoint-providers.json");
  const codex = loadDirectEndpointProviderDescriptors({}, { configPath }).find(({ provider }) => provider === "urn:ame:bare-cedar-fog-codex-inference-team");
  assert.equal(codex?.transport, "codex-exec");
  assert.equal(codex?.endpointClass, "local-command-inference");
  assert.equal(codex?.zeroCashEligible, true);
});

test("Antigravity is admitted as a local command provider spending a subscription, never the zero-cash market", async () => {
  const { directEndpointAdmissionReasons, isDirectEndpointZeroCashEligible, loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const configPath = resolve(import.meta.dirname, "../../content/dispatch/provider-admissions/direct-endpoint-providers.json");
  const antigravity = loadDirectEndpointProviderDescriptors({}, { configPath }).find(({ provider }) => provider === "urn:ame:bare-cedar-fog-antigravity-inference-team");
  assert.equal(antigravity?.transport, "antigravity-print");
  assert.equal(antigravity?.endpoint, "command:antigravity-print");
  assert.equal(isDirectEndpointZeroCashEligible(antigravity), false);
  assert.deepEqual(directEndpointAdmissionReasons(antigravity, { zeroCashOnly: true }), ["subscription-provider-excluded-from-zero-cash-market"]);
});

test("the Cloudflare Workers AI descriptor resolves its account-id-templated endpoint from env and is otherwise skipped", async () => {
  const { loadDirectEndpointProviderDescriptors } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const configPath = resolve(import.meta.dirname, "../../content/dispatch/provider-admissions/direct-endpoint-providers.json");
  const withoutAccountId = loadDirectEndpointProviderDescriptors({ API_KEY_CLOUDFLARE_WORKERS_AI: "test-cloudflare" }, { configPath });
  assert.ok(!withoutAccountId.some(({ provider }) => provider === "urn:ame:cloudflare-workers-ai-inference-team"), "an unresolved {CLOUDFLARE_ACCOUNT_ID} placeholder must skip the descriptor, never leave it half-templated");
  const withAccountId = loadDirectEndpointProviderDescriptors({ API_KEY_CLOUDFLARE_WORKERS_AI: "test-cloudflare", CLOUDFLARE_ACCOUNT_ID: "acct-123" }, { configPath });
  const cloudflare = withAccountId.find(({ provider }) => provider === "urn:ame:cloudflare-workers-ai-inference-team");
  assert.equal(cloudflare.endpoint, "https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1/chat/completions");
  assert.equal(cloudflare.apiKey, "test-cloudflare");
});

test("directEndpointOffer is feasible and selectable through the provider-neutral Pareto selector", () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const offer = directEndpointOffer(descriptor, demand());
  assert.equal(offer.type, "NormalizedWorkOffer");
  const route = decideWorkPlacement({ demand: demand(), offers: [offer] });
  assert.equal(route.disposition, "selected");
  assert.equal(route.selected.offerId, offer.id);
  assert.equal(route.selected.provider, "urn:ame:local-ollama-team");
});

test("directEndpointOffer preserves provider-owned exact resource availability", () => {
  const descriptor = loadDirectEndpointProviderDescriptor({
    ...FULL_ENV,
    DIRECT_ENDPOINT_PROVIDER_AVAILABLE_RESOURCES: JSON.stringify([
      { resource: "urn:resource:free-runner-credit", unit: "invocation", numerator: "0", denominator: "1" },
    ]),
  });
  const offer = directEndpointOffer(descriptor, demand());
  assert.deepEqual(offer.availableResources, [{
    resource: "urn:resource:free-runner-credit",
    unit: "invocation",
    amount: q(0),
  }]);
});

test("an under-scoped descriptor is refused by the placement owner rather than silently admitted", () => {
  const descriptor = loadDirectEndpointProviderDescriptor({ ...FULL_ENV, DIRECT_ENDPOINT_PROVIDER_EFFECTS: undefined });
  const offer = directEndpointOffer(descriptor, demand());
  const route = decideWorkPlacement({ demand: demand(), offers: [offer] });
  assert.equal(route.disposition, "refused");
  assert.deepEqual(route.refusals, [{ offerId: offer.id, reasons: ["effect-not-supported:read-only"] }]);
});

test("dispatchDirectEndpointOffer calls the injected transport with the descriptor's endpoint, credential, and model", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const calls = [];
  const invoke = async (call) => { calls.push(call); return { type: "ReceiverOwnedToolAgentCompletion", provider: "local-ollama-team", model: "gemma3:4b", text: "observed", durationMs: 12, invocations: [{ id: "call-1", name: "observe", arguments: {}, result: { held: true } }], exchanges: [{ finishReason: "tool_calls", usage: { promptTokens: 7, outputTokens: 2, totalTokens: 9 } }] }; };
  const tool = { type: "function", function: { name: "observe", parameters: { type: "object" } } };
  const handler = async () => ({ held: true });
  const result = await dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }], tools: [tool], toolHandlers: { observe: handler } }, { invoke });
  assert.equal(result.disposition, "delivered");
  assert.equal(result.text, "observed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, descriptor.endpoint);
  assert.equal(calls[0].apiKey, descriptor.apiKey);
  assert.equal(calls[0].model, descriptor.model);
  assert.deepEqual(calls[0].auth, { mode: "bearer" });
  assert.deepEqual(calls[0].tools, [tool]);
  assert.equal(calls[0].toolHandlers.observe, handler);
  assert.equal(result.toolInvocations[0].name, "observe");
  assert.equal(result.exchanges[0].usage.totalTokens, 9);
  assert.equal(descriptor.maximumOutputTokens, undefined, "an endpoint that declares no output allocation advertises none");
  assert.equal(Object.hasOwn(calls[0], "maximumOutputTokens"), false, "no accounted allocation means the transport receives no output ceiling");
});

test("a caller-accounted output allocation reaches the transport and no literal default stands in for an absent one", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const calls = [];
  const invoke = async (call) => { calls.push(call); return { type: "ReceiverOwnedToolAgentCompletion", provider: "local-ollama-team", model: "gemma3:4b", text: "ok", durationMs: 1, invocations: [], exchanges: [] }; };
  await dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }], execution: { maximumOutputTokens: 77 } }, { invoke });
  assert.equal(calls[0].maximumOutputTokens, 77);
});

test("a transport failure throws rather than silently falling back to another answer", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const invoke = async () => { throw new Error("local-ollama-team refused tool exchange with HTTP 500"); };
  await assert.rejects(
    dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }] }, { invoke }),
    /HTTP 500/u,
  );
});

test("a typed transport residue is preserved as refusal evidence rather than treated as a delivered answer", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const cause = { kind: "http", reason: "provider-refused", status: 429 };
  const invocations = [{ id: "call-1", name: "observe", arguments: {}, result: { held: true } }];
  const exchanges = [{ finishReason: "tool_calls", usage: { promptTokens: 7, outputTokens: 2, totalTokens: 9 } }];
  const invoke = async () => ({ type: "ReceiverOwnedToolAgentResidue", disposition: "provider-exchange-failed", provider: "observed-provider", model: "observed-model", cause, invocations, exchanges, durationMs: 13 });
  const result = await dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }] }, { invoke });
  assert.deepEqual(result, {
    disposition: "refused",
    provider: "observed-provider",
    model: "observed-model",
    reason: "provider-exchange-failed",
    cause,
    durationMs: 13,
    toolInvocations: invocations,
    exchanges,
  });
});

test("dispatch requires an injected transport function", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  await assert.rejects(dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }] }, {}), /injected transport function/u);
});

test("every admitted cloud descriptor is selectable by the route law for every work type the dispatch offers", async () => {
  const { loadDirectEndpointProviderDescriptors, directEndpointOffer } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const env = { API_KEY_GROQ: "k", API_KEY_OPENROUTER: "k", API_KEY_GOOGLE_GEMINI: "k", API_KEY_INFERENCE_NVIDIA: "k", API_KEY_CLOUDFLARE_WORKERS_AI: "k", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" };
  const cloud = loadDirectEndpointProviderDescriptors(env).filter(({ auth }) => auth.mode === "bearer");
  assert.equal(cloud.length, 5);
  for (const taskClass of ["architecture-review", "classification", "extraction", "summarization", "inquiry", "software-engineering", "code-review"]) {
    const demand = {
      type: "TypedWorkDemand", id: `urn:work-lot:test:${taskClass}`, taskClass, principal: "actor:test",
      requiredCapabilities: ["chat"], requiredQualityTiers: [], requiredEffects: ["read-only"], requiredExecutionClasses: ["direct-openai-compatible-endpoint"], idempotence: "idempotent",
      context: { identity: "ni:///sha-256;x", authorityScope: "urn:scope:bounded-inference-candidate", freshnessIdentity: "urn:freshness:request-bounded", dataConstraints: [], custodyConstraints: [] },
      outputContract: { identity: "ni:///sha-256;y" }, measures: {},
      routePolicy: { preferenceOrder: [["consideration"], ["acceptance-probability"], ["latency", "resources"]], considerationPreference: [], reuse: "forbid", unknownObservations: "choice-required" },
    };
    const route = decideWorkPlacement({ demand, offers: cloud.map((descriptor) => directEndpointOffer(descriptor, demand)) });
    assert.equal(route.disposition, "selected", `${taskClass}: ${JSON.stringify(route.refusals)}`);
    assert.deepEqual(route.refusals, [], `${taskClass} must refuse no cloud provider`);
  }
});

test("the whole admitted carrier routes to a selected plan for a chat demand: no non-commensurate frontier", async () => {
  const { loadDirectEndpointProviderDescriptors, directEndpointOffer } = await import("../../src/dispatch/direct-endpoint-provider.mjs");
  const env = { API_KEY_GROQ: "k", API_KEY_OPENROUTER: "k", API_KEY_GOOGLE_GEMINI: "k", API_KEY_INFERENCE_NVIDIA: "k", API_KEY_CLOUDFLARE_WORKERS_AI: "k", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" };
  const all = loadDirectEndpointProviderDescriptors(env);
  assert.equal(all.length, 7);
  const demand = {
    type: "TypedWorkDemand", id: "urn:work-lot:test:chat", taskClass: "chat", principal: "actor:test",
    requiredCapabilities: ["chat"], requiredQualityTiers: [], requiredEffects: ["read-only"], requiredExecutionClasses: ["direct-openai-compatible-endpoint", "local-command-inference"], idempotence: "idempotent",
    context: { identity: "ni:///sha-256;x", authorityScope: "urn:scope:bounded-inference-candidate", freshnessIdentity: "urn:freshness:request-bounded", dataConstraints: [], custodyConstraints: [] },
    outputContract: { identity: "ni:///sha-256;y" }, measures: {},
    routePolicy: { preferenceOrder: [["consideration"], ["acceptance-probability"], ["latency", "resources"]], considerationPreference: [], reuse: "forbid", unknownObservations: "choice-required" },
  };
  const route = decideWorkPlacement({ demand, offers: all.map((descriptor) => directEndpointOffer(descriptor, demand)) });
  assert.equal(route.disposition, "selected", JSON.stringify(route.rationale));
  assert.deepEqual(route.refusals, []);
  assert.ok(route.attemptPlan.flatMap((layer) => layer.offers).length >= 4, "the plan tries the cloud providers");
});

test("isClosedJsonSchema accepts a flat closed object schema", () => {
  assert.equal(isClosedJsonSchema({ type: "object", additionalProperties: false, required: ["classification"], properties: { classification: { type: "string" } } }), true);
});

test("isClosedJsonSchema rejects a schema with an open object level", () => {
  assert.equal(isClosedJsonSchema({ type: "object", properties: { classification: { type: "string" } } }), false);
  assert.equal(isClosedJsonSchema({ type: "object", additionalProperties: false, required: [], properties: { classification: { type: "string" } } }), false);
});

test("isClosedJsonSchema rejects a nested object property that is not itself closed", () => {
  const schema = { type: "object", additionalProperties: false, required: ["nested"], properties: { nested: { type: "object", properties: { a: { type: "string" } } } } };
  assert.equal(isClosedJsonSchema(schema), false);
});

test("isClosedJsonSchema accepts a nested closed object property and closed array items", () => {
  const schema = {
    type: "object", additionalProperties: false, required: ["nested", "items"],
    properties: {
      nested: { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" } } },
      items: { type: "array", items: { type: "string" } },
    },
  };
  assert.equal(isClosedJsonSchema(schema), true);
});

test("openAiJsonSchemaResponseFormat sets strict true only for a closed schema", () => {
  const closed = { type: "object", additionalProperties: false, required: ["classification"], properties: { classification: { type: "string" } } };
  const open = { type: "object", properties: { classification: { type: "string" } } };
  assert.deepEqual(openAiJsonSchemaResponseFormat(closed, "probe"), { type: "json_schema", json_schema: { name: "probe", schema: closed, strict: true } });
  assert.deepEqual(openAiJsonSchemaResponseFormat(open, "probe"), { type: "json_schema", json_schema: { name: "probe", schema: open, strict: false } });
});

test("the canonical exchange projector preserves observed zero token counters and leaves absent account scope unknown", () => {
  const measured = measuredExchangeResources([{ usage: { promptTokens: 0, outputTokens: 0 } }], { provider: "urn:ame:fixture", durationMs: 4 });
  assert.deepEqual(measured.scope, { providerIdentity: "urn:ame:fixture", accountIdentity: null, windowIdentity: null, measurementCoverage: "completed-exchanges" });
  assert.deepEqual(measured.resources, [
    { resource: "requests", unit: "request", amount: { numerator: "1", denominator: "1" } },
    { resource: "input-tokens", unit: "token", amount: { numerator: "0", denominator: "1" } },
    { resource: "output-tokens", unit: "token", amount: { numerator: "0", denominator: "1" } },
    { resource: "duration", unit: "millisecond", amount: { numerator: "4", denominator: "1" } },
  ]);
  assert.deepEqual(measured.partialResources, []);
  assert.deepEqual(measured.uncertainty, ["provider-reported-cost-incomplete", "account-window-identity-unknown"]);
});

test("dispatchDirectEndpointOffer forwards an explicit responseFormat to the transport verbatim", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const responseFormat = openAiJsonSchemaResponseFormat({ type: "object", additionalProperties: false, required: ["x"], properties: { x: { type: "string" } } }, "probe");
  const calls = [];
  const invoke = async (call) => { calls.push(call); return { type: "ReceiverOwnedToolAgentCompletion", provider: "local-ollama-team", model: "gemma3:4b", text: "{\"x\":\"ok\"}", durationMs: 12, invocations: [], exchanges: [] }; };
  await dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }], responseFormat }, { invoke });
  assert.deepEqual(calls[0].responseFormat, responseFormat);
});

test("dispatchDirectEndpointOffer sends no responseFormat field when the caller supplies none", async () => {
  const descriptor = loadDirectEndpointProviderDescriptor(FULL_ENV);
  const calls = [];
  const invoke = async (call) => { calls.push(call); return { type: "ReceiverOwnedToolAgentCompletion", provider: "local-ollama-team", model: "gemma3:4b", text: "observed", durationMs: 12, invocations: [], exchanges: [] }; };
  await dispatchDirectEndpointOffer(descriptor, { messages: [{ role: "user", content: "hi" }] }, { invoke });
  assert.equal("responseFormat" in calls[0], false);
});
