#!/usr/bin/env node
// run-one-exchange.mjs — the Groq Inference Team's exchange harness.
//
// Reads a context packet (JSON: model, messages, optional max-tokens/params),
// and either (--dry-run) validates the packet and reports auth-material
// presence with no network call and nothing written, or drives one
// Bearer-authenticated HTTPS POST against Groq's
// chat-completions surface, bounded by a fuel-seconds budget, and settles to
// exactly one of two typed outcomes: completion or refusal. See README.md and
// content/contracts/groq-inference-service.rml for the contract this
// realizes. This adapter is stateless with respect to exchange history; its
// typed caller owns the sole WitnessJournal settlement. The exchange record it emits
// on stdout still carries recordedAt and, when Groq's own response body
// returned one, a witnessed usage object (see tokenUsage below) -- both are
// wire-format fields for the caller to forward, not a local write.
//
// Auth material may be supplied by an explicitly contributing customer or
// seated in this provider's private resource file. The key never crosses the
// inference-service response and is never seated in an exchange record.
//
// Usage:
//   node run-one-exchange.mjs path/to/packet.json [--dry-run]
//
// Env:
//   GROQ_API_KEY, API_KEY_GROQ_GROQCLOUD, or API_KEY_GROQ — client-supplied
//   Bearer credential aliases, in that precedence order.
//   GROQ_INFERENCE_DEFAULT_MODEL — optional deploy-time fallback for
//     packet.model when the packet omits it; filled in before validation.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { admitRateState } from "./src/rate-admission.mjs";
import { boundedGroqRequest } from "./src/request-budget.mjs";
import { validateChatCompletionPacket } from "@red-cup-engineering/openai-compatible-chat-completion-service";
import { tokenUsage } from "@red-cup-engineering/openai-compatible-chat-completion-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOURCE_ENV = join(HERE, "content", "resources", "inference-account.env");
if (existsSync(RESOURCE_ENV)) process.loadEnvFile(RESOURCE_ENV);

if (process.env.GROQ_INFERENCE_EXCHANGE_FUEL_SECONDS !== undefined) fail(2, "GROQ_INFERENCE_EXCHANGE_FUEL_SECONDS is retired; cancel the durable lot explicitly");
const DRY_RUN = process.argv.includes("--dry-run");

function emitJson(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function fail(code, message) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(code);
}

// ── packet load and validation ──────────────────────────────────────────
const packetPath = process.argv[2];
if (!packetPath || packetPath.startsWith("--")) {
  fail(2, "usage: node run-one-exchange.mjs path/to/packet.json [--dry-run]");
}

let packetRaw;
try {
  packetRaw = readFileSync(resolvePath(packetPath), "utf8");
} catch (e) {
  fail(2, `cannot read packet at ${packetPath}: ${e.message}`);
}

let packet;
try {
  packet = JSON.parse(packetRaw);
} catch (e) {
  fail(2, `packet at ${packetPath} is not valid JSON: ${e.message}`);
}

// Deploy-time fallback: fill in packet.model from GROQ_INFERENCE_DEFAULT_MODEL
// when the packet itself omits it, before validation runs — validation still
// requires a non-empty model string one way or the other.
if (
  typeof packet === "object" && packet !== null && !Array.isArray(packet) &&
  (packet.model === undefined || packet.model === null || packet.model === "") &&
  process.env.GROQ_INFERENCE_DEFAULT_MODEL
) {
  packet.model = process.env.GROQ_INFERENCE_DEFAULT_MODEL;
}

const packetErrors = validateChatCompletionPacket(packet);
if (packetErrors.length) {
  fail(2, `packet at ${packetPath} is invalid:\n  - ${packetErrors.join("\n  - ")}`);
}

// ── auth material ────────────────────────────────────────────────────────
// Client-supplied at invocation; never seated in any record (see header).
const apiKey = process.env.GROQ_API_KEY ?? process.env.API_KEY_GROQ_GROQCLOUD ?? process.env.API_KEY_GROQ;
const authPresence = {
  "GROQ_API_KEY": Boolean(process.env.GROQ_API_KEY),
  "API_KEY_GROQ_GROQCLOUD": Boolean(process.env.API_KEY_GROQ_GROQCLOUD),
  "API_KEY_GROQ": Boolean(process.env.API_KEY_GROQ),
};

// ── dry-run: validate and report presence only, no network, no write ────
if (DRY_RUN) {
  emitJson({
    ok: true,
    "dry-run": true,
    "packet-valid": true,
    "auth-presence": authPresence,
  });
  process.exit(0);
}

const ratePolicy = JSON.parse(readFileSync(join(HERE, "content", "policies", "typed-inference-rate-capacity.json"), "utf8"));
admitRateState({
  statePath: join(HERE, "data", "groq-last-live-admission"),
  minimumIntervalMilliseconds: Number(process.env.GROQ_INFERENCE_MIN_INTERVAL_MS ?? ratePolicy.minimumLiveExchangeIntervalMilliseconds),
});

// ── live run ──────────────────────────────────────────────────────────────
function generateId() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = randomBytes(3).toString("hex");
  return `exchange-${stamp}-${rand}`;
}

// Witnessed token usage: present only when the provider's own response body
// actually carried a usage object (never estimated). Denominated per this
// provider specifically -- never converted or summed with another
// provider's token counts.


async function runLiveExchange() {
  const startedAt = performance.now();
  const id = generateId();
  let record;

  try {
    const body = boundedGroqRequest(packet);
    delete body.provider;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const wallTime = (performance.now() - startedAt) / 1000;
    const rawText = await response.text();

    if (!response.ok) {
      record = {
        id,
        recordedAt: new Date().toISOString(),
        packet,
        outcome: "refusal",
        refusal: {
          grounds: `Groq responded with HTTP ${response.status} ${response.statusText}: ${rawText.slice(0, 500)}`,
          unmet: [`http-failure:${response.status}`],
        },
        cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "groq-api-requests" },
      };
    } else {
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (e) {
        record = {
          id,
          recordedAt: new Date().toISOString(),
          packet,
          outcome: "refusal",
          refusal: {
            grounds: `Groq's response body could not be parsed as JSON: ${e.message}`,
            unmet: ["unparseable-response-body"],
          },
          cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "groq-api-requests" },
        };
      }

      if (!record) {
        const choice = parsed?.choices?.[0];
        const content = choice?.message?.content;
        if (typeof content !== "string") {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet,
            outcome: "refusal",
            refusal: {
              grounds: "Groq's response carried no choices[0].message.content",
              unmet: ["missing-completion-content"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "groq-api-requests" },
          };
        } else {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet,
            outcome: "completion",
            completion: {
              model: parsed.model || packet.model,
              text: content,
              "finish-reason": choice.finish_reason ?? "unknown",
              raw: parsed,
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "groq-api-requests" },
            ...(tokenUsage(parsed, "groq") ? { usage: tokenUsage(parsed, "groq") } : {}),
          };
        }
      }
    }
  } catch (e) {
    const wallTime = (performance.now() - startedAt) / 1000;
    record = {
      id,
      recordedAt: new Date().toISOString(),
      packet,
      outcome: "refusal",
      refusal: {
        grounds: `a network or fetch error occurred: ${e.message}`,
        unmet: ["network-error"],
      },
      cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "groq-api-requests" },
    };
  }

  emitJson(record);
  process.exit(0);
}

await runLiveExchange();
