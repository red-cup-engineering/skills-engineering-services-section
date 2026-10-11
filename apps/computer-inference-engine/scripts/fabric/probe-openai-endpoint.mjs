#!/usr/bin/env node
import { dispatchJobs, resolveEndpointBaseUrl } from "../../src/fabric/inference-fabric.mjs";

const valued = new Set(["base-url", "base-url-env", "model", "api-key-env", "requests", "concurrency", "rpm", "timeout-ms", "endpoint-id"]);
function parse(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { const raw = argv[i]; if (!raw.startsWith("--") || !valued.has(raw.slice(2))) throw new Error(`unknown argument ${raw}`); const key = raw.slice(2), value = argv[++i]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } return out; }
const integer = (value, fallback, low, high, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${name} must be an integer from ${low} to ${high}`); return number; };
const envName = (value, name) => { if (value !== undefined && !/^[A-Z][A-Z0-9_]{0,127}$/.test(value)) throw new Error(`${name} must be an uppercase environment variable name`); return value; };
const endpointName = (value, fallback) => { const name = value ?? fallback; if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name)) throw new Error("endpoint-id is invalid"); return name; };
const envForEndpoint = (id) => `INFERENCE_ENDPOINT_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_BASE_URL`;

function probeJob(id, index) {
  const cases = [
    { workType: "classification", value: { kind: "admission" }, prompt: "Return exactly this JSON object and no other text: {\"kind\":\"admission\"}" },
    { workType: "extraction", value: { values: ["alpha", "beta"] }, prompt: "Return exactly this JSON object and no other text: {\"values\":[\"alpha\",\"beta\"]}" },
    { workType: "summarization", value: { summary: "cooldown enables fallback" }, prompt: "Return exactly this JSON object and no other text: {\"summary\":\"cooldown enables fallback\"}" },
  ];
  const selected = cases[index % cases.length];
  return { id: `${id}-probe-${index + 1}`, workType: selected.workType, requiredCapabilities: ["chat"], difficulty: 0.05, maxTokens: 64, messages: [{ role: "user", content: selected.prompt }], outputContract: { format: "json", schema: { const: selected.value } } };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (Boolean(args["base-url"]) === Boolean(args["base-url-env"])) throw new Error("provide exactly one of --base-url or --base-url-env");
  if (!args.model) throw new Error("--model is required");
  const baseUrlEnv = envName(args["base-url-env"], "base-url-env"), apiKeyEnv = envName(args["api-key-env"], "api-key-env");
  const rawBaseUrl = args["base-url"] ?? process.env[baseUrlEnv]; if (!rawBaseUrl) throw new Error(`base URL environment variable ${baseUrlEnv} is unavailable`);
  const provisional = { baseUrl: rawBaseUrl }, safeBaseUrl = resolveEndpointBaseUrl(provisional), parsedUrl = new URL(safeBaseUrl);
  const id = endpointName(args["endpoint-id"], `remote-${parsedUrl.hostname.replace(/[^a-z0-9.-]/gi, "-")}`), requests = integer(args.requests, 8, 1, 128, "requests"), concurrency = integer(args.concurrency, 4, 1, 64, "concurrency"), rpm = args.rpm === undefined ? null : integer(args.rpm, undefined, 1, 100000, "rpm"), timeoutMs = integer(args["timeout-ms"], 120000, 1000, 600000, "timeout-ms");
  const capabilities = ["chat", "json", "json-output", "classification", "extraction", "summarization"];
  const liveEndpoint = { id, type: "openai-compatible", enabled: true, baseUrl: safeBaseUrl, ...(apiKeyEnv ? { apiKeyEnv } : {}), model: args.model, concurrency, ...(rpm ? { rpm } : {}), timeoutMs, capabilities, workTypes: ["classification", "extraction", "summarization"], cost: { unit: "relative-resolution-cost-v1", dispatch: 0.05, inference: 0.1, verification: 0.1, scarcity: 0.02 }, successPrior: { default: 0.5, difficultyPenalty: 0.5 }, expectedLatencyMs: 0 };
  const result = await dispatchJobs(Array.from({ length: requests }, (_, index) => probeJob(id, index)), { concurrency, attempts: 1, endpoints: [liveEndpoint] }, { concurrency, attempts: 1, timeoutMs });
  const verified = result.records.filter((record) => record.verification?.format === "json" && record.text).length, yieldRate = verified / requests, observedLatency = result.summary.p50LatencyMs ?? timeoutMs, registryBaseUrlEnv = baseUrlEnv ?? envForEndpoint(id);
  const summary = { type: "OpenAICompatibleEndpointProbe", endpoint: { id, model: args.model, safeOrigin: `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, "")}`, baseUrlSource: baseUrlEnv ? { environment: baseUrlEnv } : { suppliedDirectly: true, registryEnvironment: registryBaseUrlEnv }, apiKeyEnvironment: apiKeyEnv ?? null }, requests, verified, refused: result.summary.refused, verifiedYield: yieldRate, jobsPerMinute: result.summary.schemaVerifiedJobsPerMinute, p50LatencyMs: result.summary.p50LatencyMs, p95LatencyMs: result.summary.p95LatencyMs, admitted: verified === requests && result.summary.refused === 0, registryEndpointCandidate: { id, type: "openai-compatible", enabled: true, baseUrlEnv: registryBaseUrlEnv, ...(apiKeyEnv ? { apiKeyEnv } : {}), model: args.model, concurrency, ...(rpm ? { rpm } : {}), timeoutMs, capabilities, workTypes: ["classification", "extraction", "summarization"], cost: liveEndpoint.cost, successPrior: { default: Math.max(0.01, Math.min(0.99, yieldRate)), byWorkType: Object.fromEntries(["classification", "extraction", "summarization"].map((workType) => [workType, Math.max(0.01, Math.min(0.99, yieldRate))])), difficultyPenalty: 0.5 }, expectedLatencyMs: observedLatency } };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!summary.admitted) { process.stderr.write("endpoint probe did not achieve 100% verified yield\n"); process.exitCode = 1; }
}

try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
