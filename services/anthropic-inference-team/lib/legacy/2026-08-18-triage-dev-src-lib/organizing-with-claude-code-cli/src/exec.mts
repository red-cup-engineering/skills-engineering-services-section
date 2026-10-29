/**
 * exec — drive the `claude` binary itself (NOT the Anthropic API).
 *
 * Two layers, mirroring the package-bin doctrine "the executable is the process
 * boundary":
 *   - `buildClaudeArgs` is PURE: it projects a typed options carrier into the
 *     argv vector `claude` expects. Every flag here is one the installed CLI
 *     actually advertises (`claude --help`), so this is the upstream capability
 *     surface, typed. No spawning, no IO — fully testable.
 *   - `runClaudePrint` is the ONLY side-effecting boundary: it spawns `claude`,
 *     feeds the prompt over stdin (so variadic flags like --add-dir can never
 *     swallow it), collects stdout/stderr, and — for json/stream-json output —
 *     hands the bytes to the events projection.
 *
 * The prompt is ALWAYS delivered on stdin; it is never an argv positional. That
 * keeps `buildClaudeArgs` independent of the prompt and immune to argv ordering.
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { action, carrierFrom, tm } from "@emsenn/relating";
import {
  ClaudeEventSchema,
  ClaudeResultSchema,
  parseClaudeEvents,
  resultEventOf,
  type ClaudeEvent,
  type ClaudeResult,
} from "./events.mjs";

export type ClaudeOutputFormat = "text" | "json" | "stream-json";
export type ClaudeInputFormat = "text" | "stream-json";
export type ClaudePermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "dontAsk"
  | "plan";

export const ClaudeOutputFormatSchema = { enum: ["text", "json", "stream-json"] } as const;

export const ClaudeInputFormatSchema = { enum: ["text", "stream-json"] } as const;

export const ClaudePermissionModeSchema = {
  enum: ["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"],
} as const;

/**
 * A typed projection of the `claude` print-mode flag surface. Only fields that
 * are set are emitted; everything defaults to the CLI's own defaults.
 */
export interface ClaudeRunOptions {
  /** The user prompt. Delivered over stdin, never as an argv positional. */
  readonly prompt?: string;
  /** Print mode (`-p`/`--print`). Defaults to true for this driver. */
  readonly print?: boolean;
  /** Output transport: text (default), json (single envelope), stream-json (JSONL). */
  readonly outputFormat?: ClaudeOutputFormat;
  /** Input transport for stdin (text default, or realtime stream-json). */
  readonly inputFormat?: ClaudeInputFormat;
  /** Model alias ("opus"/"sonnet"/"haiku"/"fable") or full id. */
  readonly model?: string;
  /** Comma-separated fallback model(s) when the primary is overloaded. */
  readonly fallbackModel?: string;
  /** Reasoning effort: low | medium | high | xhigh | max. */
  readonly effort?: string;
  // ----- session continuity (the "chat session" half the user asked for) -----
  /** Use a specific session UUID for the conversation. */
  readonly sessionId?: string;
  /** Resume a conversation: a session id, or true for the most-recent picker. */
  readonly resume?: string | boolean;
  /** Continue the most recent conversation in this directory. */
  readonly continue?: boolean;
  /** When resuming/continuing, branch into a fresh session id. */
  readonly forkSession?: boolean;
  /** Do not persist this session to disk. */
  readonly noSessionPersistence?: boolean;
  /** Display name for the session. */
  readonly name?: string;
  // ----- context injection -----
  /** Replace the default system prompt. */
  readonly systemPrompt?: string;
  /** Append to the default system prompt (context injection). */
  readonly appendSystemPrompt?: string;
  /** Additional directories tool access (and CLAUDE.md discovery) is allowed in. */
  readonly addDirs?: readonly string[];
  // ----- tooling / MCP -----
  /** Allow-list of tools (comma-joined into one token). */
  readonly allowedTools?: readonly string[];
  /** Deny-list of tools. */
  readonly disallowedTools?: readonly string[];
  /** Restrict to this built-in tool set ("" disables all, "default" for all). */
  readonly tools?: readonly string[];
  /** MCP server configs: file paths or inline JSON strings. */
  readonly mcpConfig?: readonly string[];
  /** Use ONLY the --mcp-config servers, ignoring all other MCP configuration. */
  readonly strictMcpConfig?: boolean;
  // ----- settings / agents / hooks -----
  /** Settings file path or inline JSON (carries hooks, permissions, env…). */
  readonly settings?: string;
  /** Which setting sources to load: subset of user,project,local. */
  readonly settingSources?: readonly string[];
  /** Single named agent for the session. */
  readonly agent?: string;
  /** Inline JSON defining custom agents. */
  readonly agents?: string;
  /** Include hook lifecycle events in the stream (stream-json only). */
  readonly includeHookEvents?: boolean;
  // ----- structured output / budget / permissions -----
  /** JSON Schema for structured-output validation. */
  readonly jsonSchema?: string;
  /** Hard ceiling on API spend in dollars. */
  readonly maxBudgetUsd?: number;
  /** Permission mode for the session. */
  readonly permissionMode?: ClaudePermissionMode;
  /** Bypass all permission checks (sandboxes only). */
  readonly dangerouslySkipPermissions?: boolean;
  // ----- misc upstream switches -----
  /** Minimal mode: skip hooks/LSP/plugins/auto-memory/CLAUDE.md discovery. */
  readonly bare?: boolean;
  /** Start with all customizations disabled (troubleshooting). */
  readonly safeMode?: boolean;
  /** Verbose mode. */
  readonly verbose?: boolean;
  /** Emit partial message chunks as they arrive (stream-json only). */
  readonly includePartialMessages?: boolean;
  /** Escape hatch: extra raw args appended verbatim. */
  readonly extraArgs?: readonly string[];
}

export const ClaudeRunOptionsSchema = {
  $id: "organizing/claude/code-cli/exec/run-options",
  type: "object",
  title: "ClaudeRunOptions",
  properties: {
    prompt: { type: "string" },
    print: { type: "boolean" },
    outputFormat: ClaudeOutputFormatSchema,
    inputFormat: ClaudeInputFormatSchema,
    model: { type: "string", minLength: 1 },
    fallbackModel: { type: "string", minLength: 1 },
    effort: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 },
    resume: { anyOf: [{ type: "string", minLength: 1 }, { type: "boolean" }] },
    continue: { type: "boolean" },
    forkSession: { type: "boolean" },
    noSessionPersistence: { type: "boolean" },
    name: { type: "string", minLength: 1 },
    systemPrompt: { type: "string" },
    appendSystemPrompt: { type: "string" },
    addDirs: { type: "array", items: { type: "string", minLength: 1 } },
    allowedTools: { type: "array", items: { type: "string", minLength: 1 } },
    disallowedTools: { type: "array", items: { type: "string", minLength: 1 } },
    tools: { type: "array", items: { type: "string" } },
    mcpConfig: { type: "array", items: { type: "string" } },
    strictMcpConfig: { type: "boolean" },
    settings: { type: "string" },
    settingSources: { type: "array", items: { type: "string", minLength: 1 } },
    agent: { type: "string", minLength: 1 },
    agents: { type: "string" },
    includeHookEvents: { type: "boolean" },
    jsonSchema: { type: "string" },
    maxBudgetUsd: { type: "number", minimum: 0 },
    permissionMode: ClaudePermissionModeSchema,
    dangerouslySkipPermissions: { type: "boolean" },
    bare: { type: "boolean" },
    safeMode: { type: "boolean" },
    verbose: { type: "boolean" },
    includePartialMessages: { type: "boolean" },
    extraArgs: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
} as const;

export const claudeRunOptionsCarrier = carrierFrom(ClaudeRunOptionsSchema);

function pushValue(argv: string[], flag: string, value: string | undefined): void {
  if (value !== undefined && value.length > 0) argv.push(flag, value);
}

function pushList(argv: string[], flag: string, values: readonly string[] | undefined): void {
  if (values !== undefined && values.length > 0) argv.push(flag, values.join(","));
}

/**
 * Project run options into the argv vector for `claude` (excluding the leading
 * executable name and the prompt, which is fed on stdin). Pure and total.
 */
export function buildClaudeArgs(options: ClaudeRunOptions): string[] {
  const argv: string[] = [];
  if (options.print !== false) argv.push("--print");
  pushValue(argv, "--output-format", options.outputFormat);
  pushValue(argv, "--input-format", options.inputFormat);
  pushValue(argv, "--model", options.model);
  pushValue(argv, "--fallback-model", options.fallbackModel);
  pushValue(argv, "--effort", options.effort);

  pushValue(argv, "--session-id", options.sessionId);
  if (typeof options.resume === "string") pushValue(argv, "--resume", options.resume);
  else if (options.resume === true) argv.push("--resume");
  if (options.continue === true) argv.push("--continue");
  if (options.forkSession === true) argv.push("--fork-session");
  if (options.noSessionPersistence === true) argv.push("--no-session-persistence");
  pushValue(argv, "--name", options.name);

  pushValue(argv, "--system-prompt", options.systemPrompt);
  pushValue(argv, "--append-system-prompt", options.appendSystemPrompt);
  for (const dir of options.addDirs ?? []) argv.push("--add-dir", dir);

  pushList(argv, "--allowedTools", options.allowedTools);
  pushList(argv, "--disallowedTools", options.disallowedTools);
  if (options.tools !== undefined) argv.push("--tools", options.tools.join(","));
  for (const cfg of options.mcpConfig ?? []) argv.push("--mcp-config", cfg);
  if (options.strictMcpConfig === true) argv.push("--strict-mcp-config");

  pushValue(argv, "--settings", options.settings);
  pushList(argv, "--setting-sources", options.settingSources);
  pushValue(argv, "--agent", options.agent);
  pushValue(argv, "--agents", options.agents);
  if (options.includeHookEvents === true) argv.push("--include-hook-events");

  pushValue(argv, "--json-schema", options.jsonSchema);
  if (options.maxBudgetUsd !== undefined) argv.push("--max-budget-usd", String(options.maxBudgetUsd));
  pushValue(argv, "--permission-mode", options.permissionMode);
  if (options.dangerouslySkipPermissions === true) argv.push("--dangerously-skip-permissions");

  if (options.bare === true) argv.push("--bare");
  if (options.safeMode === true) argv.push("--safe-mode");
  if (options.verbose === true) argv.push("--verbose");
  if (options.includePartialMessages === true) argv.push("--include-partial-messages");

  argv.push(...(options.extraArgs ?? []));
  return argv;
}

/** Options for the spawn boundary itself (not part of the argv). */
export interface ClaudeSpawnOptions {
  /** The claude executable; defaults to "claude" on PATH. */
  readonly bin?: string;
  /** Working directory for the child. */
  readonly cwd?: string;
  /** Extra environment for the child (merged over process.env). */
  readonly env?: Readonly<Record<string, string>>;
  /** Kill the child after this many ms. */
  readonly timeoutMs?: number;
  /** Receive raw stdout chunks as they arrive (for live streaming). */
  readonly onStdout?: (chunk: string) => void;
  /** Receive raw stderr chunks as they arrive. */
  readonly onStderr?: (chunk: string) => void;
}

export const ClaudeSpawnOptionsSchema = {
  $id: "organizing/claude/code-cli/exec/spawn-options",
  type: "object",
  title: "ClaudeSpawnOptions",
  properties: {
    bin: { type: "string", minLength: 1 },
    cwd: { type: "string", minLength: 1 },
    env: { type: "object", additionalProperties: { type: "string" } },
    timeoutMs: { type: "number", minimum: 0 },
    onStdout: {},
    onStderr: {},
  },
  additionalProperties: false,
} as const;

export const claudeSpawnOptionsCarrier = carrierFrom(ClaudeSpawnOptionsSchema);

/** The settled outcome of one `claude` print-mode run. */
export interface ClaudeRunOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly argv: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  /** Parsed events when outputFormat was json/stream-json; else undefined. */
  readonly events?: readonly ClaudeEvent[];
  /** The terminal `result` event when present. */
  readonly result?: ClaudeResult;
}

export const ClaudeRunOutcomeSchema = {
  $id: "organizing/claude/code-cli/exec/run-outcome",
  type: "object",
  title: "ClaudeRunOutcome",
  required: ["code", "signal", "argv", "stdout", "stderr"],
  properties: {
    code: { type: ["integer", "null"] },
    signal: { type: ["string", "null"] },
    argv: { type: "array", items: { type: "string" } },
    stdout: { type: "string" },
    stderr: { type: "string" },
    events: { type: "array", items: ClaudeEventSchema },
    result: ClaudeResultSchema,
  },
  additionalProperties: false,
} as const;

export const claudeRunOutcomeCarrier = carrierFrom(ClaudeRunOutcomeSchema);

export const canonicalizeClaudeRunOptionsAction = action({
  verb: "organizing.claude.code-cli.exec.canonicalize-run-options",
  description: "Canonicalize Claude Code CLI run options.",
  domain: claudeRunOptionsCarrier,
  codomain: claudeRunOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeClaudeSpawnOptionsAction = action({
  verb: "organizing.claude.code-cli.exec.canonicalize-spawn-options",
  description: "Canonicalize Claude Code CLI spawn options.",
  domain: claudeSpawnOptionsCarrier,
  codomain: claudeSpawnOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeClaudeRunOutcomeAction = action({
  verb: "organizing.claude.code-cli.exec.canonicalize-run-outcome",
  description: "Canonicalize a Claude Code CLI run outcome.",
  domain: claudeRunOutcomeCarrier,
  codomain: claudeRunOutcomeCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const execActions = Object.freeze([
  canonicalizeClaudeRunOptionsAction,
  canonicalizeClaudeSpawnOptionsAction,
  canonicalizeClaudeRunOutcomeAction,
]);

/**
 * Spawn `claude` in print mode, feed the prompt on stdin, and collect the run.
 * When outputFormat is json/stream-json the stdout is parsed into events and the
 * terminal result is surfaced. This is the only place a process is started.
 */
export function runClaudePrint(
  options: ClaudeRunOptions,
  spawnOptions: ClaudeSpawnOptions = {},
): Promise<ClaudeRunOutcome> {
  const argv = buildClaudeArgs(options);
  const bin = spawnOptions.bin ?? "claude";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd: spawnOptions.cwd ?? process.cwd(),
      env: { ...process.env, ...(spawnOptions.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (spawnOptions.timeoutMs !== undefined) {
      timer = setTimeout(() => child.kill("SIGKILL"), spawnOptions.timeoutMs);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      spawnOptions.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      spawnOptions.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      const parsed =
        options.outputFormat === "json" || options.outputFormat === "stream-json"
          ? safeParse(stdout)
          : undefined;
      const result = parsed === undefined ? undefined : resultEventOf(parsed);
      resolve(
        Object.freeze({
          code,
          signal,
          argv: Object.freeze([...argv]),
          stdout,
          stderr,
          ...(parsed === undefined ? {} : { events: parsed }),
          ...(result === undefined ? {} : { result }),
        }),
      );
    });
    if (options.prompt !== undefined) child.stdin.write(options.prompt);
    child.stdin.end();
  });
}

function safeParse(stdout: string): readonly ClaudeEvent[] | undefined {
  try {
    return parseClaudeEvents(stdout);
  } catch {
    return undefined;
  }
}
