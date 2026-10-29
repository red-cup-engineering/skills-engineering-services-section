#!/usr/bin/env node
// run-one-exchange.mjs — the Claude Code Inference Team's exchange harness.
//
// Reads a context packet (JSON: model, messages, optional max-tokens/params),
// and either (--dry-run) validates the packet, resolves the model/max-tokens
// defaults, and reports the local `claude` binary's PATH *presence* (never
// login validity) with no invocation and nothing written, or spawns exactly
// one bounded `claude -p` (print-mode) subprocess, constrained to pure text
// inference — an empty tool allowlist, no MCP servers, no project/user
// settings — bounded by a fuel-seconds budget, and settles to exactly one of
// two typed outcomes: completion or refusal. See README.md and
// content/contracts/claude-code-inference-service.json for the contract this
// realizes, and lib/schemas/inference-exchange.schema.json (in the
// executive office's schema pool) for the class every written exchange
// record is validated against.
//
// This is a fresh implementation — it shares no code or dependency with
// MetroPlat's own Claude client or with this section's own
// anthropic-inference-team, which both remain out of scope and untouched.
// Unlike every sibling team in this section, this unit's endpoint is not an
// HTTPS API: it is the local `claude` CLI in print mode.
//
// Usage:
//   node run-one-exchange.mjs path/to/packet.json [--dry-run]
//
// Env:
//   CLAUDE_CODE_INFERENCE_EXCHANGE_FUEL_SECONDS — wall-clock budget (default 300).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, delimiter as PATH_DELIMITER, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXCHANGES_DIR = join(HERE, "content", "exchanges");

const FUEL_SECONDS = Number(process.env.CLAUDE_CODE_INFERENCE_EXCHANGE_FUEL_SECONDS ?? 300);
const DRY_RUN = process.argv.includes("--dry-run");

const DEFAULT_MODEL = "claude-opus-4-8";
const CLAUDE_BIN = "claude";

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function emit(value) {
  const output = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  const outputPath = arg("--output-file");
  if (outputPath) writeFileSync(outputPath, output, "utf8"); else process.stdout.write(output);
}

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

// packet.model may be absent — this unit defaults it to DEFAULT_MODEL rather
// than failing validation, same as the anthropic-inference-team sibling.
// messages must still be present and valid. max-tokens, if present, must be
// a positive integer — it is accepted and echoed for shape-compatibility
// with the sibling packets' shape, but the claude CLI's print mode carries
// no flag that bounds completion length, so it is NOT enforced on the wire.
// See README.md's "What could not be realized as stated".
function validatePacket(p) {
  const errs = [];
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    errs.push("packet must be a JSON object");
    return errs;
  }
  if (p.model !== undefined && (typeof p.model !== "string" || p.model.length === 0)) {
    errs.push("packet.model, if present, must be a non-empty string");
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
  if (p["max-tokens"] !== undefined && (!Number.isInteger(p["max-tokens"]) || p["max-tokens"] < 1)) {
    errs.push("packet['max-tokens'], if present, must be a positive integer");
  }
  if (p.params !== undefined && (typeof p.params !== "object" || p.params === null || Array.isArray(p.params))) {
    errs.push("packet.params, if present, must be an object");
  }
  if (p.params?.outputSchema !== undefined) {
    if (typeof p.params.outputSchema !== "object" || p.params.outputSchema === null || Array.isArray(p.params.outputSchema)) {
      errs.push("packet.params.outputSchema must be a JSON Schema object");
    } else if (Buffer.byteLength(JSON.stringify(p.params.outputSchema), "utf8") > 32_768) {
      errs.push("packet.params.outputSchema must not exceed 32768 UTF-8 bytes");
    }
  }
  return errs;
}

const packetErrors = validatePacket(packet);
if (packetErrors.length) {
  fail(2, `packet at ${packetPath} is invalid:\n  - ${packetErrors.join("\n  - ")}`);
}

// Resolve the effective model — defaulted when the caller omitted it — so
// both the dry-run report and the live invocation (and the written exchange
// record's echoed packet) agree on what was actually sent. max-tokens is
// carried through as given (never defaulted, since it is never enforced).
function resolvePacket(p) {
  const model = p.model !== undefined ? p.model : DEFAULT_MODEL;
  const modelDefaulted = p.model === undefined;
  const effectivePacket = { model, messages: p.messages };
  if (p["max-tokens"] !== undefined) effectivePacket["max-tokens"] = p["max-tokens"];
  if (p.params !== undefined) effectivePacket.params = p.params;
  return { effectivePacket, modelDefaulted };
}

const { effectivePacket, modelDefaulted } = resolvePacket(packet);

// Flatten packet.messages into a single claude -p prompt string. A system
// message maps to --append-system-prompt (joined, in order, if more than
// one is present); every other turn is flattened, in order, into the
// print-mode prompt argument. A single bare user turn is passed through
// verbatim rather than wrapped in a "User: " label, since claude -p's
// prompt argument is itself already a single user turn in that case.
function buildPromptParts(messages) {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");
  const appendSystemPrompt = systemParts.length ? systemParts.join("\n\n") : undefined;
  let prompt;
  if (turns.length === 1 && turns[0].role === "user") {
    prompt = turns[0].content;
  } else {
    prompt = turns
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
  }
  return { prompt, appendSystemPrompt };
}

// ── claude binary presence ───────────────────────────────────────────────
// Presence only, exactly as --dry-run checks credential *presence* on the
// sibling HTTPS-backed teams — never login validity. Authentication is
// whatever the local `claude` CLI is already logged in as; this harness
// never inspects or validates that state.
function claudeBinaryPresent() {
  const pathDirs = (process.env.PATH || "").split(PATH_DELIMITER).filter(Boolean);
  const exeNames = process.platform === "win32" ? [`${CLAUDE_BIN}.exe`, `${CLAUDE_BIN}.cmd`, CLAUDE_BIN] : [CLAUDE_BIN];
  for (const dir of pathDirs) {
    for (const exe of exeNames) {
      if (existsSync(join(dir, exe))) return true;
    }
  }
  return false;
}

const claudePresent = claudeBinaryPresent();

// ── dry-run: validate, resolve, report presence — no invocation, no write ──
if (DRY_RUN) {
  const { prompt, appendSystemPrompt } = buildPromptParts(effectivePacket.messages);
  const wouldRunArgs = [
    "-p", "--model", effectivePacket.model, "--output-format", "json",
    "--tools", "", "--strict-mcp-config", "--setting-sources", "",
    ...(effectivePacket.params?.outputSchema === undefined ? [] : ["--json-schema", JSON.stringify(effectivePacket.params.outputSchema)]),
    ...(appendSystemPrompt !== undefined ? ["--append-system-prompt", appendSystemPrompt] : []),
  ];
  emit({
        ok: true,
        "dry-run": true,
        "packet-valid": true,
        "claude-binary-presence": { claude: claudePresent },
        "resolved-packet": {
          model: effectivePacket.model,
          "model-defaulted": modelDefaulted,
          "max-tokens": effectivePacket["max-tokens"] ?? null,
          "max-tokens-enforced-on-wire": false,
        },
        "would-run": {
          command: CLAUDE_BIN,
          args: wouldRunArgs,
          stdin: { encoding: "utf8", bytes: Buffer.byteLength(prompt, "utf8") },
        },
      });
  process.exit(0);
}

// Note: an absent claude binary is not a failure to proceed the same way the
// pilot guard or packet validation is — it settles as a refusal record, same
// shape as an HTTP failure on the sibling teams (see runLiveExchange below).

// ── live run ──────────────────────────────────────────────────────────────
function generateId() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = randomBytes(3).toString("hex");
  return `exchange-${stamp}-${rand}`;
}

// Validate a would-be exchange record against emsenn/schema/inference-exchange
// by shelling out to read-a-schema.js — the one validator; see this script's
// own header and README.md's "Validation" note. Resolution walks up from this
// script's own location as a fallback when no ancestor of the CWD carries a
// schema pool (per the enterprise membrane, this settlement carries none of
// its own) — the same resolution the sibling teams' harnesses rely on.
function validateExchangeRecord(record) {
  const reader = findReadASchema();
  if (!reader) {
    return { ranSchemaCheck: false, ok: null, errors: [] };
  }
  const result = spawnSync(
    process.execPath,
    [reader, "emsenn/schema/inference-exchange"],
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
      "../../../../../../../board-of-directors/services/executive-office/lib/management/skills/read-a-schema.js",
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

function runLiveExchange() {
  const startedAt = Date.now();
  const id = generateId();
  let record;

  if (!claudePresent) {
    const wallTime = (Date.now() - startedAt) / 1000;
    record = {
      id,
      packet: effectivePacket,
      outcome: "refusal",
      refusal: {
        grounds: "the `claude` binary was not found on PATH — no subprocess was spawned",
        unmet: ["claude-binary-absent"],
      },
      cost: { "fuel-consumed": 0, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
    };
  } else {
    const { prompt, appendSystemPrompt } = buildPromptParts(effectivePacket.messages);
    const args = [
      "-p", "--model", effectivePacket.model, "--output-format", "json",
      // Constrain the subprocess to pure text inference: an empty tool
      // allowlist, zero MCP servers (no --mcp-config is given, and
      // --strict-mcp-config refuses every other MCP configuration source),
      // and no project/user settings loaded (CLAUDE.md, hooks, agents) —
      // so it cannot use tools or touch the filesystem.
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      ...(effectivePacket.params?.outputSchema === undefined ? [] : ["--json-schema", JSON.stringify(effectivePacket.params.outputSchema)]),
      ...(appendSystemPrompt !== undefined ? ["--append-system-prompt", appendSystemPrompt] : []),
    ];

    const result = spawnSync(CLAUDE_BIN, args, {
      // The context packet is data, not process metadata. Stream it through
      // stdin so packet size is bounded by Claude's context window rather
      // than the operating system's argv limit (ARG_MAX).
      input: prompt,
      encoding: "utf8",
      timeout: FUEL_SECONDS * 1000,
      killSignal: "SIGKILL",
    });

    const wallTime = (Date.now() - startedAt) / 1000;

    if (result.error) {
      record = {
        id,
        packet: effectivePacket,
        outcome: "refusal",
        refusal: {
          grounds: `the claude subprocess could not be spawned or run: ${result.error.message}`,
          unmet: ["subprocess-spawn-error"],
        },
        cost: { "fuel-consumed": 0, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
      };
    } else if (result.signal) {
      // Killed — either the fuel-seconds timeout fired (Node sends
      // killSignal on timeout) or something else signaled it. Either way
      // this settles as a refusal, never a hang.
      record = {
        id,
        packet: effectivePacket,
        outcome: "refusal",
        refusal: {
          grounds: `the exchange did not settle within the ${FUEL_SECONDS}-second fuel budget and the subprocess was killed (signal ${result.signal})`,
          unmet: ["subprocess-timeout"],
        },
        cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
      };
    } else if (result.status !== 0) {
      record = {
        id,
        packet: effectivePacket,
        outcome: "refusal",
        refusal: {
          grounds: `the claude subprocess exited non-zero (status ${result.status}): ${(result.stderr || result.stdout || "").slice(0, 500)}`,
          unmet: [`subprocess-exit:${result.status}`],
        },
        cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
      };
    } else {
      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch (e) {
        record = {
          id,
          packet: effectivePacket,
          outcome: "refusal",
          refusal: {
            grounds: `the claude subprocess's stdout could not be parsed as JSON: ${e.message}`,
            unmet: ["unparseable-response-body"],
          },
          cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
        };
      }

      if (!record) {
        // The CLI's own in-band error/refusal: is_error true (an API-level
        // error such as a bad model id, an auth failure, or the CLI's own
        // safety classifier declining), a non-"success" subtype, or a
        // stop_reason of "refusal" all settle as this contract's
        // outcome: "refusal", never "completion".
        const inBandRefusal =
          parsed?.is_error === true ||
          (parsed?.subtype !== undefined && parsed.subtype !== "success") ||
          parsed?.stop_reason === "refusal";

        if (inBandRefusal) {
          record = {
            id,
            packet: effectivePacket,
            outcome: "refusal",
            refusal: {
              grounds: `the claude CLI returned an in-band error or refusal (subtype: ${parsed?.subtype ?? "unknown"}, is_error: ${parsed?.is_error ?? "unknown"}, stop_reason: ${parsed?.stop_reason ?? "unknown"}): ${String(parsed?.result ?? "").slice(0, 500)}`,
              unmet: ["claude-cli-in-band-refusal"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        } else if (effectivePacket.params?.outputSchema !== undefined && (typeof parsed?.structured_output !== "object" || parsed.structured_output === null || Array.isArray(parsed.structured_output))) {
          record = {
            id,
            packet: effectivePacket,
            outcome: "refusal",
            refusal: {
              grounds: "the claude CLI completed without the provider-validated structured_output required by the accepted packet",
              unmet: ["missing-validated-structured-output"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        } else if (typeof parsed?.result !== "string" || parsed.result.length === 0) {
          record = {
            id,
            packet: effectivePacket,
            outcome: "refusal",
            refusal: {
              grounds: "the claude CLI's response carried no non-empty .result text",
              unmet: ["missing-completion-content"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        } else {
          record = {
            id,
            packet: effectivePacket,
            outcome: "completion",
            completion: {
              model: effectivePacket.model,
              text: effectivePacket.params?.outputSchema !== undefined ? JSON.stringify(parsed.structured_output) : parsed.result,
              "finish-reason": parsed.stop_reason ?? "unknown",
              raw: parsed,
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        }
      }
    }
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

  mkdirSync(EXCHANGES_DIR, { recursive: true });
  const outPath = join(EXCHANGES_DIR, `${id}.json`);
  writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  // The full exchange, including the potentially corpus-scale input packet,
  // stays in this provider's own evidence store. The calling contract gets a
  // compact locator and reads a bounded projection instead of recursively
  // carrying the customer's whole corpus through every ActivityStreams hop.
  emit({
    id: record.id,
    outcome: record.outcome,
    recordPath: outPath,
    cost: record.cost,
    ...(record.refusal === undefined ? {} : { refusal: record.refusal }),
  });
  process.exit(0);
}

runLiveExchange();
