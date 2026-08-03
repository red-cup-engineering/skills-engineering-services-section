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
// content/contracts/claude-code-inference-service.rml for the contract this
// realizes. The typed caller owns the sole WitnessJournal settlement; this adapter
// carries no exchange history. The exchange record it emits on stdout still
// carries recordedAt and, when the claude CLI's own JSON output returned a
// usage object, a witnessed usage object (see tokenUsage below) -- both are
// wire-format fields for the caller to forward, not a local write.
//
// This service has no umbrella-client dependency and remains independent of
// this section's own anthropic-inference-team.
// Unlike every sibling team in this section, this unit's endpoint is not an
// HTTPS API: it is the local `claude` CLI in print mode.
//
// Usage:
//   node run-one-exchange.mjs path/to/packet.json [--dry-run]
//
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, delimiter as PATH_DELIMITER, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { runClaudeWithCapacity } from "./src/claude-capacity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

if (process.env.CLAUDE_CODE_INFERENCE_EXCHANGE_FUEL_SECONDS !== undefined) throw new Error("CLAUDE_CODE_INFERENCE_EXCHANGE_FUEL_SECONDS is retired; cancel the durable lot explicitly");
const DRY_RUN = process.argv.includes("--dry-run");

const DEFAULT_MODEL = "claude-opus-4-8";
const PRIVATE_RELAY_CLIENT = join(HERE, "src", "claude-via-private-relay.mjs");
const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN
  ?? (existsSync(PRIVATE_RELAY_CLIENT) ? PRIVATE_RELAY_CLIENT : "claude");

function emit(value) {
  process.stdout.write(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
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

function claudeOutputMode(packet) {
  // Reasoning is text.  JSON is a deterministic carrier applied after the
  // provider returns, not a syntax the model must maintain while reasoning.
  // Keep the old Claude-validated structured path only for callers that
  // explicitly contracted for an output schema.
  return packet.params?.outputSchema === undefined ? "text" : "json";
}

const { effectivePacket, modelDefaulted } = resolvePacket(packet);

// Flatten packet.messages into a single claude -p prompt string. A system
// message maps to --append-system-prompt (joined, in order, if more than
// one is present); every other turn is flattened, in order, into the
// print-mode prompt argument. A single bare user turn is passed through
// verbatim rather than wrapped in a "User: " label, since claude -p's
// prompt argument is itself already a single user turn in that case.
// The claude binary is an agentic coding harness whose model is habituated to
// having Read/Grep/Bash tools. Run tool-less, it does not reliably say "I have
// no tools" — it improvises procedural narratives (a fabricated "reads return
// empty" failure story, or confidently fabricated file contents; both observed
// 2026-07-24 on wo-skills-authoring-a-die). This line forecloses that persona
// on EVERY packet rather than trusting each caller's per-class instruction.
const NO_TOOLS_PREAMBLE =
  "This invocation is pure text completion: you have NO tools, NO filesystem access, NO ability to read, list, or search files, and no command execution. Any file content you need is already quoted in the prompt; anything not quoted there is unknown to you. Never narrate tool calls, file reads, or their results — describing a read, an empty result, or quoting a file you were not given is fabrication and grounds for the exchange to be refused.";

function buildPromptParts(messages) {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");
  const appendSystemPrompt = [NO_TOOLS_PREAMBLE, ...systemParts].join("\n\n");
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
function resolveClaudeBinary() {
  if (CLAUDE_BIN.includes("/") && existsSync(CLAUDE_BIN)) return CLAUDE_BIN;
  const pathDirs = (process.env.PATH || "").split(PATH_DELIMITER).filter(Boolean);
  const exeNames = process.platform === "win32" ? [`${CLAUDE_BIN}.exe`, `${CLAUDE_BIN}.cmd`, CLAUDE_BIN] : [CLAUDE_BIN];
  for (const dir of pathDirs) {
    for (const exe of exeNames) {
      const candidate = join(dir, exe);
      if (existsSync(candidate)) return candidate;
    }
  }
  const userLocal = join(homedir(), ".local", "bin", CLAUDE_BIN);
  return existsSync(userLocal) ? userLocal : undefined;
}

const claudeExecutable = resolveClaudeBinary();
const claudePresent = claudeExecutable !== undefined;

// ── dry-run: validate, resolve, report presence — no invocation, no write ──
if (DRY_RUN) {
  const { prompt, appendSystemPrompt } = buildPromptParts(effectivePacket.messages);
  const wouldRunArgs = [
    "-p", "--model", effectivePacket.model, "--output-format", claudeOutputMode(effectivePacket),
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
          command: claudeExecutable ?? CLAUDE_BIN,
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

// Witnessed token usage: present only when the provider's own response body
// actually carried a usage object (never estimated). Denominated per this
// provider specifically -- never converted or summed with another
// provider's token counts.
function tokenUsage(raw, prefix) {
  const usage = raw?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const result = {};
  if (Number.isInteger(usage.input_tokens)) result.input = { quantity: usage.input_tokens, denomination: `${prefix}-tokens-in` };
  if (Number.isInteger(usage.output_tokens)) result.output = { quantity: usage.output_tokens, denomination: `${prefix}-tokens-out` };
  return Object.keys(result).length ? result : undefined;
}

function runLiveExchange() {
  const startedAt = performance.now();
  const id = generateId();
  let record;

  if (!claudePresent) {
    const wallTime = (performance.now() - startedAt) / 1000;
    record = {
      id,
      recordedAt: new Date().toISOString(),
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
      "-p", "--model", effectivePacket.model, "--output-format", claudeOutputMode(effectivePacket),
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

    const result = runClaudeWithCapacity(claudeExecutable ?? CLAUDE_BIN, args, {
      // The context packet is data, not process metadata. Stream it through
      // stdin so packet size is bounded by Claude's context window rather
      // than the operating system's argv limit (ARG_MAX).
      input: prompt,
      encoding: "utf8",
    });

    const wallTime = (performance.now() - startedAt) / 1000;

    if (result.error) {
      record = {
        id,
        recordedAt: new Date().toISOString(),
        packet: effectivePacket,
        outcome: "refusal",
        refusal: {
          grounds: `the claude subprocess could not be spawned or run: ${result.error.message}`,
          unmet: ["subprocess-spawn-error"],
        },
        cost: { "fuel-consumed": 0, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
      };
    } else if (result.signal) {
      record = {
        id,
        recordedAt: new Date().toISOString(),
        packet: effectivePacket,
        outcome: "refusal",
        refusal: {
          grounds: `the exchange subprocess was externally killed (signal ${result.signal})`,
          unmet: ["subprocess-signaled"],
        },
        cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
      };
    } else if (result.status !== 0) {
      record = {
        id,
        recordedAt: new Date().toISOString(),
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
      if (claudeOutputMode(effectivePacket) === "text") {
        parsed = { result: result.stdout, stop_reason: "unknown" };
      } else {
        try {
          parsed = JSON.parse(result.stdout);
        } catch (e) {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet: effectivePacket,
            outcome: "refusal",
            refusal: {
              grounds: `the explicitly structured Claude response could not be parsed as JSON: ${e.message}`,
              unmet: ["unparseable-structured-response-body"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        }
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
            recordedAt: new Date().toISOString(),
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
            recordedAt: new Date().toISOString(),
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
            recordedAt: new Date().toISOString(),
            packet: effectivePacket,
            outcome: "refusal",
            refusal: {
              grounds: "the claude CLI's response carried no non-empty .result text",
              unmet: ["missing-completion-content"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        } else if (
          // This invocation runs tool-less (--tools ""), so the model can never
          // truthfully report its own file reads or their failure. A completion
          // narrating them is fabricated procedure (observed 2026-07-24,
          // wo-skills-authoring-a-die: "all filesystem reads are returning
          // empty output"); settle it as a refusal so the dispatcher's failure
          // path rehires instead of stamping the fabrication fulfilled.
          // Patterns are deliberately narrow first-person operational claims,
          // not any mention of files, so authored text ABOUT filesystems
          // still passes.
          [
            /filesystem reads? (?:are|is|were|was)[^.\n]{0,40}(?:empty|fail|block|unavailable)/i,
            /\bI (?:cannot|can't|could not|couldn't) read (?:the |any )?(?:source )?files?\b/i,
            /\b(?:all |my )(?:file|filesystem) reads?\b[^.\n]{0,40}(?:empty|fail|return)/i,
          ].some((p) => p.test(parsed.result))
        ) {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet: effectivePacket,
            outcome: "refusal",
            refusal: {
              grounds: `the completion narrates first-person file reads or their failure, which this tool-less invocation can never truthfully produce — fabricated procedural narrative: ${parsed.result.slice(0, 300)}`,
              unmet: ["confabulated-tool-narrative"],
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
          };
        } else {
          record = {
            id,
            recordedAt: new Date().toISOString(),
            packet: effectivePacket,
            outcome: "completion",
            completion: {
              model: effectivePacket.model,
              text: effectivePacket.params?.outputSchema !== undefined ? JSON.stringify(parsed.structured_output) : parsed.result,
              "finish-reason": parsed.stop_reason ?? "unknown",
              raw: parsed,
            },
            cost: { "fuel-consumed": 1, "wall-time-seconds": wallTime, denomination: "claude-code-cli-invocations" },
            ...(tokenUsage(parsed, "claude-code") ? { usage: tokenUsage(parsed, "claude-code") } : {}),
          };
        }
      }
    }
  }

  emit(record);
  process.exit(0);
}

runLiveExchange();
