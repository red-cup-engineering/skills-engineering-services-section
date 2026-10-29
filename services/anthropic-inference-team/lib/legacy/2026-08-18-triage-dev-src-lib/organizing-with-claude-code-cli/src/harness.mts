/**
 * harness — compose the artifacts that make a `claude` session powerful, and
 * settle them into the relational cli-harness topology.
 *
 * This is the "meet-or-beat the claude-enhancing tooling" surface: a session is
 * only as capable as the context injected into it, the MCP servers it can reach,
 * and the hooks that fire around it. This module turns a typed, declarative plan
 * into:
 *   - an `--mcp-config` JSON document (arbitrary http/sse/stdio servers),
 *   - a `--settings` JSON document carrying hooks (and permissions/env),
 *   - injected context (system / appended system prompt, extra dirs, capsules),
 *   - a `ClaudeRunOptions` fragment ready to spread into `runClaudePrint`, and
 *   - a settled `ClaudeCodeCliHarnessCarrier` (the @emsenn/organizing-with-claude
 *     diamond floor) so the wiring is MOTIVATED by the relational mathematics,
 *     not just emitted as config.
 *
 * It is strictly HUB-AGNOSTIC and upstream of the 561 Group Operations Manifold:
 * the manifold is merely one possible value a caller may pass as a server's
 * `pointsAt` coordinate or as `hub`. Nothing here imports or assumes it.
 */
import {
  claudeCodeCliHarness,
  type ClaudeCodeCliHarnessCarrier,
} from "@emsenn/organizing-with-claude/claude/code/cli-harness";
import { action, carrierFrom, tm } from "@emsenn/relating";
import type { ClaudeRunOptions } from "./exec.mjs";

// ---------- MCP servers ----------

/** An MCP server reachable over HTTP or SSE (a tooling endpoint, e.g. a hub). */
export interface HttpMcpServerSpec {
  readonly name: string;
  readonly type: "http" | "sse";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** The relational hub this server discovers; defaults to the server name. */
  readonly pointsAt?: string;
}

export const HttpMcpServerSpecSchema = {
  $id: "organizing/claude/code-cli/harness/http-mcp-server",
  type: "object",
  title: "ClaudeCodeCliHttpMcpServerSpec",
  required: ["name", "type", "url"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { enum: ["http", "sse"] },
    url: { type: "string", minLength: 1 },
    headers: { type: "object", additionalProperties: { type: "string" } },
    pointsAt: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const httpMcpServerSpecCarrier = carrierFrom(HttpMcpServerSpecSchema);

/** An MCP server spawned as a local stdio process. */
export interface StdioMcpServerSpec {
  readonly name: string;
  readonly type?: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** The relational hub this server discovers; defaults to the server name. */
  readonly pointsAt?: string;
}

export const StdioMcpServerSpecSchema = {
  $id: "organizing/claude/code-cli/harness/stdio-mcp-server",
  type: "object",
  title: "ClaudeCodeCliStdioMcpServerSpec",
  required: ["name", "command"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { const: "stdio" },
    command: { type: "string", minLength: 1 },
    args: { type: "array", items: { type: "string" } },
    env: { type: "object", additionalProperties: { type: "string" } },
    pointsAt: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const stdioMcpServerSpecCarrier = carrierFrom(StdioMcpServerSpecSchema);

export type McpServerSpec = HttpMcpServerSpec | StdioMcpServerSpec;

export const McpServerSpecSchema = {
  $id: "organizing/claude/code-cli/harness/mcp-server",
  title: "ClaudeCodeCliMcpServerSpec",
  anyOf: [
    HttpMcpServerSpecSchema,
    StdioMcpServerSpecSchema,
  ],
} as const;

export const McpServerSpecCarrierSchema = {
  $id: "organizing/claude/code-cli/harness/mcp-server",
  type: "object",
  title: "ClaudeCodeCliMcpServerSpec",
  required: ["value"],
  properties: {
    value: McpServerSpecSchema,
  },
  additionalProperties: false,
} as const;

export const mcpServerSpecCarrier = carrierFrom(McpServerSpecCarrierSchema);

function isHttp(server: McpServerSpec): server is HttpMcpServerSpec {
  return server.type === "http" || server.type === "sse";
}

/** The `.mcp.json`-shaped object claude loads via `--mcp-config`. */
export function mcpConfigObject(servers: readonly McpServerSpec[]): {
  readonly mcpServers: Readonly<Record<string, unknown>>;
} {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    mcpServers[server.name] = isHttp(server)
      ? { type: server.type, url: server.url, ...(server.headers ? { headers: server.headers } : {}) }
      : {
          type: "stdio",
          command: server.command,
          ...(server.args ? { args: [...server.args] } : {}),
          ...(server.env ? { env: server.env } : {}),
        };
  }
  return { mcpServers };
}

/** The inline JSON string to pass as a `--mcp-config` argument. */
export function mcpConfigJson(servers: readonly McpServerSpec[]): string {
  return JSON.stringify(mcpConfigObject(servers));
}

// ---------- hooks ----------

/** The claude hook lifecycle events a session can fire on. */
export type HookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "Stop"
  | "SubagentStop"
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "PreCompact";

export const HookEventSchema = {
  enum: [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "Stop",
    "SubagentStop",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "PreCompact",
  ],
} as const;

/** One hook: a command that fires on an event, optionally matched to a tool. */
export interface HookSpec {
  readonly event: HookEvent;
  /** Tool matcher (PreToolUse/PostToolUse), e.g. "Bash" or "Edit|Write". */
  readonly matcher?: string;
  /** The command to run (the thing the hook DOES). */
  readonly command: string;
  /** Per-hook timeout in seconds. */
  readonly timeout?: number;
}

export const HookSpecSchema = {
  $id: "organizing/claude/code-cli/harness/hook",
  type: "object",
  title: "ClaudeCodeCliHookSpec",
  required: ["event", "command"],
  properties: {
    event: HookEventSchema,
    matcher: { type: "string", minLength: 1 },
    command: { type: "string", minLength: 1 },
    timeout: { type: "number", minimum: 0 },
  },
  additionalProperties: false,
} as const;

export const hookSpecCarrier = carrierFrom(HookSpecSchema);

/** The `settings.json`-shaped `hooks` block claude understands. */
export function hooksObject(hooks: readonly HookSpec[]): Readonly<Record<string, unknown>> {
  const byEvent = new Map<string, { matcher?: string; hooks: unknown[] }[]>();
  for (const spec of hooks) {
    const command = { type: "command", command: spec.command, ...(spec.timeout === undefined ? {} : { timeout: spec.timeout }) };
    const groups = byEvent.get(spec.event) ?? byEvent.set(spec.event, []).get(spec.event)!;
    const existing = groups.find((group) => group.matcher === spec.matcher);
    if (existing) existing.hooks.push(command);
    else groups.push({ ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }), hooks: [command] });
  }
  return Object.fromEntries(byEvent.entries());
}

// ---------- context injection ----------

/** What context to inject into the session. */
export interface ContextSpec {
  /** Replace the default system prompt entirely. */
  readonly systemPrompt?: string;
  /** Text appended to the system prompt (the usual injection point). */
  readonly appendSystemPrompt?: string;
  /** Extra directories to grant tool access and CLAUDE.md discovery. */
  readonly addDirs?: readonly string[];
  /** Pre-gathered context blobs (e.g. session capsules) to append, in order. */
  readonly capsules?: readonly string[];
}

export const ContextSpecSchema = {
  $id: "organizing/claude/code-cli/harness/context",
  type: "object",
  title: "ClaudeCodeCliContextSpec",
  properties: {
    systemPrompt: { type: "string" },
    appendSystemPrompt: { type: "string" },
    addDirs: { type: "array", items: { type: "string", minLength: 1 } },
    capsules: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
} as const;

export const contextSpecCarrier = carrierFrom(ContextSpecSchema);

/** Fold capsules + appendSystemPrompt into a single appended-context string. */
export function composeAppendedContext(spec: ContextSpec): string | undefined {
  const parts = [...(spec.capsules ?? []), ...(spec.appendSystemPrompt === undefined ? [] : [spec.appendSystemPrompt])]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length === 0 ? undefined : parts.join("\n\n");
}

// ---------- the plan ----------

/** A declarative plan for a powerful claude session. */
export interface HarnessPlan {
  /** Instance id for the relational topology (e.g. a session id). */
  readonly id?: string;
  /** Agent the harness embodies; defaults to the id. */
  readonly agent?: string;
  /** Claude model the session runs (alias or full id). */
  readonly model?: string;
  /** MCP servers the session can reach (tooling). */
  readonly mcpServers?: readonly McpServerSpec[];
  /** Use ONLY these MCP servers (ignore ambient configuration). */
  readonly strictMcpConfig?: boolean;
  /** Hooks that fire around the session. */
  readonly hooks?: readonly HookSpec[];
  /** Context injected into the session. */
  readonly context?: ContextSpec;
  /** Tool allow-list. */
  readonly allowedTools?: readonly string[];
  /** Tool deny-list. */
  readonly disallowedTools?: readonly string[];
  /** Extra settings merged into the generated settings document. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Permissions block for the settings document. */
  readonly permissions?: Readonly<Record<string, unknown>>;
  /** Skills/commands/subagents to record on the relational floor. */
  readonly skills?: readonly string[];
  readonly commands?: readonly string[];
  readonly subagents?: readonly string[];
}

export const HarnessPlanSchema = {
  $id: "organizing/claude/code-cli/harness/plan",
  type: "object",
  title: "ClaudeCodeCliHarnessPlan",
  properties: {
    id: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    mcpServers: { type: "array", items: McpServerSpecSchema },
    strictMcpConfig: { type: "boolean" },
    hooks: { type: "array", items: HookSpecSchema },
    context: ContextSpecSchema,
    allowedTools: { type: "array", items: { type: "string", minLength: 1 } },
    disallowedTools: { type: "array", items: { type: "string", minLength: 1 } },
    settings: { type: "object", additionalProperties: {} },
    permissions: { type: "object", additionalProperties: {} },
    skills: { type: "array", items: { type: "string", minLength: 1 } },
    commands: { type: "array", items: { type: "string", minLength: 1 } },
    subagents: { type: "array", items: { type: "string", minLength: 1 } },
  },
  additionalProperties: false,
} as const;

export const harnessPlanCarrier = carrierFrom(HarnessPlanSchema);

export const canonicalizeHttpMcpServerSpecAction = action({
  verb: "organizing.claude.code-cli.harness.canonicalize-http-mcp-server",
  description: "Canonicalize a Claude Code CLI HTTP/SSE MCP server spec.",
  domain: httpMcpServerSpecCarrier,
  codomain: httpMcpServerSpecCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeStdioMcpServerSpecAction = action({
  verb: "organizing.claude.code-cli.harness.canonicalize-stdio-mcp-server",
  description: "Canonicalize a Claude Code CLI stdio MCP server spec.",
  domain: stdioMcpServerSpecCarrier,
  codomain: stdioMcpServerSpecCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeMcpServerSpecAction = action({
  verb: "organizing.claude.code-cli.harness.canonicalize-mcp-server",
  description: "Canonicalize a Claude Code CLI MCP server spec.",
  domain: mcpServerSpecCarrier,
  codomain: mcpServerSpecCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeHookSpecAction = action({
  verb: "organizing.claude.code-cli.harness.canonicalize-hook",
  description: "Canonicalize a Claude Code CLI hook spec.",
  domain: hookSpecCarrier,
  codomain: hookSpecCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeContextSpecAction = action({
  verb: "organizing.claude.code-cli.harness.canonicalize-context",
  description: "Canonicalize a Claude Code CLI context spec.",
  domain: contextSpecCarrier,
  codomain: contextSpecCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeHarnessPlanAction = action({
  verb: "organizing.claude.code-cli.harness.canonicalize-plan",
  description: "Canonicalize a Claude Code CLI harness plan.",
  domain: harnessPlanCarrier,
  codomain: harnessPlanCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const harnessActions = Object.freeze([
  canonicalizeHttpMcpServerSpecAction,
  canonicalizeStdioMcpServerSpecAction,
  canonicalizeMcpServerSpecAction,
  canonicalizeHookSpecAction,
  canonicalizeContextSpecAction,
  canonicalizeHarnessPlanAction,
]);

/** The settings JSON document a plan implies (hooks + permissions + extras). */
export function settingsObject(plan: HarnessPlan): Readonly<Record<string, unknown>> {
  const hooks = plan.hooks && plan.hooks.length > 0 ? { hooks: hooksObject(plan.hooks) } : {};
  const permissions = plan.permissions ? { permissions: plan.permissions } : {};
  return Object.freeze({ ...(plan.settings ?? {}), ...permissions, ...hooks });
}

/** The settings JSON string to pass as `--settings`. */
export function settingsJson(plan: HarnessPlan): string {
  return JSON.stringify(settingsObject(plan));
}

/**
 * Project a plan into a `ClaudeRunOptions` fragment, ready to spread into
 * `runClaudePrint` (alongside the prompt and output-format). Only sets fields the
 * plan actually populates.
 */
export function planRunOptions(plan: HarnessPlan): ClaudeRunOptions {
  const servers = plan.mcpServers ?? [];
  const appended = plan.context ? composeAppendedContext(plan.context) : undefined;
  const settings = settingsObject(plan);
  return Object.freeze({
    ...(plan.model === undefined ? {} : { model: plan.model }),
    ...(servers.length === 0 ? {} : { mcpConfig: [mcpConfigJson(servers)] }),
    ...(plan.strictMcpConfig === true ? { strictMcpConfig: true } : {}),
    ...(Object.keys(settings).length === 0 ? {} : { settings: JSON.stringify(settings) }),
    ...(plan.context?.systemPrompt === undefined ? {} : { systemPrompt: plan.context.systemPrompt }),
    ...(appended === undefined ? {} : { appendSystemPrompt: appended }),
    ...(plan.context?.addDirs === undefined ? {} : { addDirs: plan.context.addDirs }),
    ...(plan.allowedTools === undefined ? {} : { allowedTools: plan.allowedTools }),
    ...(plan.disallowedTools === undefined ? {} : { disallowedTools: plan.disallowedTools }),
  });
}

/**
 * Settle a plan into the relational cli-harness diamond floor. The MCP/hook/
 * setting slots become utterances; each server's `pointsAt` is the load-bearing
 * coordinate (self by default, or a named hub a caller supplies). This is what
 * makes the wiring a settled fact in the relational mathematics, not just config.
 */
export function planTopology(plan: HarnessPlan): ClaudeCodeCliHarnessCarrier {
  const id = plan.id ?? "this";
  const settingNames = Object.keys(settingsObject(plan));
  return claudeCodeCliHarness({
    id,
    ...(plan.agent === undefined ? {} : { agent: plan.agent }),
    model: plan.model ?? "opus",
    mcpServers: (plan.mcpServers ?? []).map((server) => ({
      id: server.name,
      pointsAt: server.pointsAt ?? server.name,
    })),
    hooks: (plan.hooks ?? []).map((hook) => hook.event),
    ...(plan.skills === undefined ? {} : { skills: plan.skills }),
    ...(plan.commands === undefined ? {} : { commands: plan.commands }),
    ...(plan.subagents === undefined ? {} : { subagents: plan.subagents }),
    settings: settingNames,
  });
}
