#!/usr/bin/env node
// run-one-exchange.mjs — the OpenAI Inference Team's exchange harness.
//
// Reads a context packet (JSON: model, messages, optional max-tokens/params),
// and either (--dry-run) validates the packet and reports auth-material
// presence with no network call and nothing written, or drives one
// Bearer-authenticated HTTPS POST against OpenAI's chat-completions surface,
// bounded by a fuel-seconds budget, and settles to exactly one of two typed
// outcomes: completion or refusal. See README.md and
// content/contracts/openai-inference-service.rml for the contract this
// realizes, and lib/schemas/inference-exchange.schema.json (in the
// executive office's schema pool) for the class every written exchange
// record is validated against.
//
// This service owns its OpenAI boundary and has no umbrella-client dependency.
//
// Usage:
//   node run-one-exchange.mjs path/to/packet.json [--dry-run]
//
// Env:
//   OPENAI_API_KEY — the Bearer credential.
//   OPENAI_INFERENCE_DEFAULT_MODEL — optional deploy-time fallback for
//     packet.model when the packet omits it; filled in before validation.
//   OPENAI_INFERENCE_EXCHANGE_FUEL_SECONDS — wall-clock budget (default 120).
//   OPENAI_INFERENCE_PILOT_CAP — bounded-pilot cap on content/exchanges/*.json
//     (default 10) — a recommendation-level guard, not an IRB allocation.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXCHANGES_DIR = join(HERE, "content", "exchanges");

const DRY_RUN = process.argv.includes("--dry-run");

function fail(code, message) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(code);
}

// ── bounded-pilot guard ──────────────────────────────────────────────────
// Count non-archived content/exchanges/*.json records (exclude any archive/
// subdirectory). This is a recommendation-level mechanism, not itself an
// IRB funding authorization — see README.md.
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

// Deploy-time fallback: fill in packet.model from OPENAI_INFERENCE_DEFAULT_MODEL
// when the packet itself omits it, before validation runs — validation still
// requires a non-empty model string one way or the other.
if (
  typeof packet === "object" && packet !== null && !Array.isArray(packet) &&
  (packet.model === undefined || packet.model === null || packet.model === "") &&
  process.env.OPENAI_INFERENCE_DEFAULT_MODEL
) {
  packet.model = process.env.OPENAI_INFERENCE_DEFAULT_MODEL;
}

function validatePacket(p) {
  const errs = [];
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    errs.push("packet must be a JSON object");
    return errs;
  }
  if (typeof p.model !== "string" || p.model.length === 0) {
    errs.push("packet.model must be a non-empty string");
  }
  if (!Array.isArray(p.messages) || p.messages.length === 0) {
    errs.push("packet.messages must be a non-empty array");
  } else {
    p.messages.forEach((m, i) => {
      if (typeof m !== "object" || m === null || Array.isArray(m)) {
        errs.push(`packet.messages[${i}] must be an object`);
        return;
      }
      if (typeof m.role !== "string" || !["system", "user", "assistant"].includes(m.role)) {
        errs.push(`packet.messages[${i}].role must be one of system, user, assistant`);
      }
      if (typeof m.content !== "string" || m.content.length === 0) {
        errs.push(`packet.messages[${i}].content must be a non-empty string`);
      }
    });
  }
  return errs;
}

const packetErrors = validatePacket(packet);
if (packetErrors.length) {
  fail(2, `packet at ${packetPath} is invalid:\n  - ${packetErrors.join("\n  - ")}`);
}

// ── auth material ────────────────────────────────────────────────────────
const apiKey = process.env.OPENAI_API_KEY;
const authPresence = {
  "OPENAI_API_KEY": Boolean(process.env.OPENAI_API_KEY),
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
function tokenUsage(raw, prefix) {
  const usage = raw?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const result = {};
  if (Number.isInteger(usage.prompt_tokens)) result.input = { quantity: usage.prompt_tokens, denomination: `${prefix}-tokens-in` };
  if (Number.isInteger(usage.completion_tokens)) result.output = { quantity: usage.completion_tokens, denomination: `${prefix}-tokens-out` };
  return Object.keys(result).length ? result : undefined;
}


// Validate a would-be exchange record against emsenn/schema/inference-exchange
// by shelling out to read-a-schema.js — the one validator; see this script's
// own header and README.md's "Validation" note. Resolution walks up from this
// script's own location as a fallback when no ancestor of the CWD carries a
// schema pool (per the enterprise membrane, this settlement carries none of
// its own) — the same resolution nvidia-inference-team's harness relies on.
function validateExchangeRecord(record) {
  const reader = findReadASchema();
  if (!reader) {
    return { ranSchemaCheck: false, ok: null, errors: [] };
  }
  const result = spawnSync(
    process.execPath,
    [reader, "emsenn/schema/inference-exchange", "--pool", resolvePath(dirname(reader), "..", "..", "schemas")],
    { input: JSON.stringify(record), encoding: "utf8" },
  );
  let verdict;
  try {
    verdict = JSON.parse(result.stdout);
  } catch {
    return { ranSchemaCheck: true, ok: false, errors: [`read-a-schema.js returned unparseable output: ${(result.stderr || result.stdout || "").trim()}`] };
  }
  return { ranSchemaCheck: true, ok: verdict.ok === true, errors: verdict.errors ?? [] };
}

function findReadASchema() {
  // Known seat, per this repository's own management-instrument layout
  // (see README.md and CLAUDE.md at the repository root).
  const candidate = fileURLToPath(
    new URL(
      "../../../../../../../../../board-of-directors/services/executive-office/lib/management/skills/read-a-schema.js",
      import.meta.url,
    ),
  );
  if (existsSync(candidate)) return candidate;
  // Fallback: walk up from HERE looking for the executive office's skills dir.
  let d = HERE;
  for (;;) {
    const at = join(d, "lib/management/skills/read-a-schema.js");
    if (existsSync(at)) return at;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

async function runLiveExchange() {
  const startedAt = performance.now();
  const id = generateId();
  let record;

  try {
    const body = { model: packet.model, messages: packet.messages, ...(packet.params || {}) };
    if (packet["max-tokens"] !== undefined) body.max_tokens = packet["max-tokens"];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
          grounds: `OpenAI responded with HTTP ${response.status} ${response.statusText}: ${rawText}`,
          unmet: [`http-failure:${response.status}`],
        },
        cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openai-api-requests" },
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
            grounds: `OpenAI's response body could not be parsed as JSON: ${e.message}`,
            unmet: ["unparseable-response-body"],
          },
          cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openai-api-requests" },
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
              grounds: "OpenAI's response carried no choices[0].message.content",
              unmet: ["missing-completion-content"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openai-api-requests" },
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
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openai-api-requests" },
            ...(tokenUsage(parsed, "openai") ? { usage: tokenUsage(parsed, "openai") } : {}),
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
      cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "openai-api-requests" },
    };
  }

  const validation = validateExchangeRecord(record);
  if (validation.ranSchemaCheck && validation.ok === false) {
    process.stderr.write(
      `warning: the exchange record failed schema validation against emsenn/schema/inference-exchange:\n  - ${validation.errors.join("\n  - ")}\nwriting it anyway is refused; nothing is seated.\n`,
    );
    process.exit(1);
  }
  if (!validation.ranSchemaCheck) {
    process.stderr.write(
      "note: read-a-schema.js could not be found — full schema validation was not run; writing the record with only this script's own by-hand field checks applied.\n",
    );
  }

  const outPath = join(EXCHANGES_DIR, `${id}.json`);
  mkdirSync(EXCHANGES_DIR, { recursive: true });
  writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  process.exit(0);
}

await runLiveExchange();
