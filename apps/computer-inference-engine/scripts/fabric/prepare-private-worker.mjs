#!/usr/bin/env node
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const valued = new Set(["output", "model-path", "model-alias", "endpoint-id", "engine", "port", "parallel", "rpm", "context-size", "image", "cost-unit", "dispatch-cost", "inference-cost", "verification-cost", "scarcity-cost"]);
function parse(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const raw = argv[index]; if (!raw.startsWith("--") || !valued.has(raw.slice(2))) throw new Error(`unknown argument ${raw}`); const key = raw.slice(2), value = argv[++index]; if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`); out[key] = value; } return out; }
const integer = (value, fallback, low, high, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isInteger(number) || number < low || number > high) throw new Error(`${name} must be an integer from ${low} to ${high}`); return number; };
const decimal = (value, fallback, name) => { const number = value === undefined ? fallback : Number(value); if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new Error(`${name} must be a nonnegative number no greater than 1000000`); return number; };
const identifier = (value, name) => { if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value ?? "")) throw new Error(`${name} is invalid`); return value; };
const envName = (id, suffix) => `INFERENCE_WORKER_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
const quoted = (value) => JSON.stringify(value);

function compose(engine) {
  const gpu = engine === "cuda" ? "    gpus: all\n" : "";
  const gpuArgs = engine === "cuda" ? "      - --n-gpu-layers\n      - \"99\"\n" : "";
  return `services:
  inference:
    image: \${LLAMA_CPP_IMAGE:?set LLAMA_CPP_IMAGE}
    restart: unless-stopped
${gpu}    ports:
      - "127.0.0.1:\${INFERENCE_PORT:-8080}:8080"
    volumes:
      - "\${MODEL_PATH:?set MODEL_PATH}:/models/model.gguf:ro"
      - "./secrets/api-key.txt:/run/secrets/inference-api-key:ro"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    command:
      - -m
      - /models/model.gguf
      - --alias
      - \${MODEL_ALIAS:?set MODEL_ALIAS}
      - --host
      - 0.0.0.0
      - --port
      - "8080"
      - --api-key-file
      - /run/secrets/inference-api-key
      - --ctx-size
      - "\${CONTEXT_SIZE:-4096}"
      - --parallel
      - "\${PARALLEL:-1}"
      - --metrics
${gpuArgs}`;
}

function instructions({ endpointId, modelAlias, port, baseUrlEnv, apiKeyEnv, requests, parallel, rpm }) {
  return `# Private inference worker: ${endpointId}

This directory is a host-local carrier for one OpenAI-compatible llama.cpp
worker. The container publishes only to host loopback. Tailscale Serve is the
only intended network face; do not use Funnel or publish the container port on
LAN/public interfaces.

## Host operator

1. Review \`.env\`, \`compose.yaml\`, and the model path. The generated API
   key is in \`secrets/api-key.txt\` (mode 0600); never send it in chat or put
   it in Git.
2. Start the worker: \`docker compose up -d\`.
3. Confirm local health: \`curl -fsS -H "Authorization: Bearer <key>" http://127.0.0.1:${port}/v1/models\`.
4. Expose only inside the tailnet: \`tailscale serve --bg http://127.0.0.1:${port}\`.
5. Give the LISS operator the resulting tailnet HTTPS base URL, the exact model
   alias \`${modelAlias}\`, and the API key through an agreed protected channel.
   The price and capacity terms in \`worker-offer.json\` are authored by the
   worker operator.

## LISS admission

Inject the URL and key only into the invoking environment as \`${baseUrlEnv}\`
and \`${apiKeyEnv}\`, then run:

\`node src/probe-openai-endpoint.mjs --base-url-env ${baseUrlEnv} --api-key-env ${apiKeyEnv} --model ${modelAlias} --endpoint-id ${endpointId} --requests ${requests} --concurrency ${parallel} --rpm ${rpm}\`

The endpoint remains disabled unless that command emits \`"admitted":true\`.
The admitted registry projection is derived from this offer and the successful
probe; never copy the credential or a raw probe response. Re-probe after model,
image, hardware, tailnet identity, serving configuration, price, or capacity
changes.
`;
}

export function preparePrivateWorker(args) {
  if (!args.output || !args["model-path"] || !args["model-alias"] || !args["endpoint-id"] || !args["cost-unit"] || args["inference-cost"] === undefined || args.rpm === undefined) throw new Error("--output, --model-path, --model-alias, --endpoint-id, --cost-unit, --inference-cost, and --rpm are required");
  const output = resolve(args.output); if (existsSync(output)) throw new Error("output already exists");
  const modelPath = realpathSync(resolve(args["model-path"])); if (!statSync(modelPath).isFile()) throw new Error("model-path must be a regular file");
  const modelAlias = identifier(args["model-alias"], "model-alias"), endpointId = identifier(args["endpoint-id"], "endpoint-id"), engine = args.engine ?? "cpu";
  if (!["cpu", "cuda"].includes(engine)) throw new Error("engine must be cpu or cuda");
  const port = integer(args.port, 8080, 1024, 65535, "port"), parallel = integer(args.parallel, 1, 1, 64, "parallel"), rpm = integer(args.rpm, undefined, 1, 100000, "rpm"), contextSize = integer(args["context-size"], 4096, 256, 1048576, "context-size"), requests = Math.max(8, Math.min(128, parallel * 2));
  const cost = { unit: identifier(args["cost-unit"], "cost-unit"), dispatch: decimal(args["dispatch-cost"], 0, "dispatch-cost"), inference: decimal(args["inference-cost"], undefined, "inference-cost"), verification: decimal(args["verification-cost"], 0, "verification-cost"), scarcity: decimal(args["scarcity-cost"], 0, "scarcity-cost") };
  const image = args.image ?? `ghcr.io/ggml-org/llama.cpp:${engine === "cuda" ? "server-cuda" : "server"}`;
  if (!/^ghcr\.io\/ggml-org\/llama\.cpp:[a-zA-Z0-9._-]+(?:@sha256:[a-f0-9]{64})?$/.test(image)) throw new Error("image must be an official llama.cpp server tag, optionally digest-pinned");
  const baseUrlEnv = envName(endpointId, "BASE_URL"), apiKeyEnv = envName(endpointId, "API_KEY");
  try {
    mkdirSync(join(output, "secrets"), { recursive: true });
    writeFileSync(join(output, "secrets", "api-key.txt"), randomBytes(32).toString("base64url"), { mode: 0o600 });
    writeFileSync(join(output, ".env"), `LLAMA_CPP_IMAGE=${quoted(image)}\nMODEL_PATH=${quoted(modelPath)}\nMODEL_ALIAS=${quoted(modelAlias)}\nINFERENCE_PORT=${port}\nPARALLEL=${parallel}\nCONTEXT_SIZE=${contextSize}\n`, { mode: 0o600 });
    writeFileSync(join(output, "compose.yaml"), compose(engine), { mode: 0o600 });
    writeFileSync(join(output, "README.md"), instructions({ endpointId, modelAlias, port, baseUrlEnv, apiKeyEnv, requests, parallel, rpm }), { mode: 0o600 });
    writeFileSync(join(output, "worker-offer.json"), `${JSON.stringify({ type: "PrivateInferenceWorkerOffer", endpointId, engine, model: { alias: modelAlias, localFile: basename(modelPath) }, network: { carrier: "tailscale-serve", backendBind: `127.0.0.1:${port}`, publicExposureAuthorized: false }, credential: { kind: "file-backed-bearer", environmentAtLiss: apiKeyEnv }, baseUrlEnvironmentAtLiss: baseUrlEnv, terms: { authoredBy: "worker-operator", capacity: { concurrency: parallel, rpm }, cost }, admission: { command: "probe-openai-endpoint", required: "admitted=true", requests, concurrency: parallel, rpm }, mutableImageTag: !image.includes("@sha256:") }, null, 2)}\n`, { mode: 0o600 });
  } catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
  return { type: "PrivateInferenceWorkerCarrierPrepared", output, endpointId, engine, modelAlias, baseUrlEnvironment: baseUrlEnv, apiKeyEnvironment: apiKeyEnv, offeredConcurrency: parallel, offeredRpm: rpm, costUnit: cost.unit, secretPrinted: false };
}

if (isMain(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(preparePrivateWorker(parse(process.argv.slice(2))))}\n`); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
