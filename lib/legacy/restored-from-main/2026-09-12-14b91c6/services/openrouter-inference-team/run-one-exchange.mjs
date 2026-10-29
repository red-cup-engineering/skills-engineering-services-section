#!/usr/bin/env node
// run-one-exchange.mjs — the OpenRouter Inference Team's exchange harness.
//
// Reads a context packet (JSON: model, messages, optional max-tokens/params),
// and either (--dry-run) validates the packet and reports auth-material
// presence with no network call and nothing written, or drives one
// Bearer-authenticated HTTPS POST against OpenRouter's
// chat-completions surface and settles to exactly one of two typed outcomes:
// completion or refusal. See README.md and
// content/contracts/openrouter-inference-service.rml for the contract this
// realizes. This adapter is stateless: its typed caller owns the sole
// WitnessJournal settlement. The stdout record carries provider-returned
// usage evidence for that caller; this boundary never seats its own receipt.
//
// Auth material is CLIENT-SUPPLIED: the contracting client provides the key
// at invocation, as environment, from its own custody (for the firm's own
// provider accounts that custodian is the Leader Movement Team). This team
// holds no key of its own, seats no credential in any record, and never
// rotates keys, accounts, or projects to evade a provider limit.
//
// Usage:
//   node run-one-exchange.mjs path/to/packet.json [--dry-run]
//
// Env:
//   OPENROUTER_API_KEY or API_KEY_OPENROUTER — client-supplied Bearer
//   credential aliases, in that precedence order.
//   OPENROUTER_INFERENCE_DEFAULT_MODEL — optional deploy-time fallback for
//     packet.model when the packet omits it; filled in before validation.
import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { admitOpenRouterFreeInvocation, OPENROUTER_ZERO_CASH_PROVIDER, verifyOpenRouterFreeAccount } from "./src/free-tier-admission.mjs";
import { projectChatCompletion } from "./src/project-chat-completion.mjs";
import { validateChatCompletionPacket } from "@red-cup-engineering/openai-compatible-chat-completion-service";
import { tokenUsage } from "@red-cup-engineering/openai-compatible-chat-completion-service";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");

function fail(code, message) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(code);
}

if (process.env.OPENROUTER_INFERENCE_EXCHANGE_FUEL_SECONDS !== undefined) fail(2, "OPENROUTER_INFERENCE_EXCHANGE_FUEL_SECONDS is retired; cancel the durable lot explicitly");

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

// Deploy-time fallback: fill in packet.model from OPENROUTER_INFERENCE_DEFAULT_MODEL
// when the packet itself omits it, before validation runs — validation still
// requires a non-empty model string one way or the other.
if (
  typeof packet === "object" && packet !== null && !Array.isArray(packet) &&
  (packet.model === undefined || packet.model === null || packet.model === "") &&
  process.env.OPENROUTER_INFERENCE_DEFAULT_MODEL
) {
  packet.model = process.env.OPENROUTER_INFERENCE_DEFAULT_MODEL;
}

const packetErrors = validateChatCompletionPacket(packet);
if (packetErrors.length) {
  fail(2, `packet at ${packetPath} is invalid:\n  - ${packetErrors.join("\n  - ")}`);
}

// ── auth material ────────────────────────────────────────────────────────
// Client-supplied at invocation; never seated in any record (see header).
const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.API_KEY_OPENROUTER;
const authPresence = {
  "OPENROUTER_API_KEY": Boolean(process.env.OPENROUTER_API_KEY),
  "API_KEY_OPENROUTER": Boolean(process.env.API_KEY_OPENROUTER),
};

// ── dry-run: validate and report presence only, no network, no write ────
if (DRY_RUN) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        "dry-run": true,
        "packet-valid": true,
        "auth-presence": authPresence,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

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
    await admitOpenRouterFreeInvocation({ apiKey, model: packet.model });
    const body = { model: packet.model, messages: packet.messages, ...(packet.params || {}) };
    if (packet["max-tokens"] !== undefined) body.max_tokens = packet["max-tokens"];
    delete body.provider;
    body.provider = { allow_fallbacks: OPENROUTER_ZERO_CASH_PROVIDER.allow_fallbacks, max_price: { ...OPENROUTER_ZERO_CASH_PROVIDER.max_price } };

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    await verifyOpenRouterFreeAccount({ apiKey });
    const wallTime = (performance.now() - startedAt) / 1000;
    const rawText = await response.text();

    if (!response.ok) {
      record = {
        id,
        recordedAt: new Date().toISOString(),
        packet,
        outcome: "refusal",
        refusal: {
          grounds: `OpenRouter responded with HTTP ${response.status} ${response.statusText}: ${rawText.slice(0, 500)}`,
          unmet: [`http-failure:${response.status}`],
        },
        cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openrouter-api-requests" },
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
            grounds: `OpenRouter's response body could not be parsed as JSON: ${e.message}`,
            unmet: ["unparseable-response-body"],
          },
          cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openrouter-api-requests" },
        };
      }

      if (!record) {
        const completion = projectChatCompletion(parsed);
        if (completion.text.length === 0) {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet,
            outcome: "refusal",
            refusal: {
              grounds: `OpenRouter's response carried no usable assistant content, reasoning, or tool call: ${rawText.slice(0, 500)}`,
              unmet: ["missing-completion-carrier"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openrouter-api-requests" },
          };
        } else {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet,
            outcome: "completion",
            completion: {
              model: parsed.model || packet.model,
              text: completion.text,
              "finish-reason": completion.choice?.finish_reason ?? "unknown",
              raw: parsed,
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openrouter-api-requests" },
            ...(tokenUsage(parsed, "openrouter") ? { usage: tokenUsage(parsed, "openrouter") } : {}),
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
      cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openrouter-api-requests" },
    };
  }

  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  process.exit(0);
}

await runLiveExchange();
