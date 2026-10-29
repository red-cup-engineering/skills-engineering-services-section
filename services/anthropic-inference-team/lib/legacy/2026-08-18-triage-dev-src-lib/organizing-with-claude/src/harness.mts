// Read the live Claude Code substrate (.mcp.json, .claude/settings.json) and
// settle it into the claude-code-cli-harness-topology; plan the canonical
// You<->MCP<->561 Group Operations Manifold wiring. Read-first: nothing here writes config.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { action, carrierFrom, tm } from "@emsenn/relating";
import {
  claudeCodeCliHarness,
  OPERATIONS_MANIFOLD_HUB,
  type ClaudeCodeCliHarnessCarrier,
} from "./claude/code/cli-harness/index.mjs";

export type { ClaudeCodeCliHarnessCarrier };

export interface ReadOptions {
  readonly root?: string;
  readonly id?: string;
  readonly model?: string;
}

export const ReadOptionsSchema = {
  $id: "organizing/claude/harness/read-options",
  type: "object",
  title: "ClaudeHarnessReadOptions",
  properties: {
    root: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const readOptionsCarrier = carrierFrom(ReadOptionsSchema);

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** A server points at 561 Group Operations Manifold if its id or config mentions the hub. */
function hubOf(id: string, config: unknown): string {
  const blob = `${id} ${JSON.stringify(config ?? "")}`;
  return blob.includes(OPERATIONS_MANIFOLD_HUB) ? OPERATIONS_MANIFOLD_HUB : id;
}

/** Settle the live project substrate into the floor topology — the read direction. */
export function readHarness(opts: ReadOptions = {}): ClaudeCodeCliHarnessCarrier {
  const root = opts.root ?? process.cwd();
  const mcp = readJson(join(root, ".mcp.json")) as { mcpServers?: Record<string, unknown> } | undefined;
  const settings = readJson(join(root, ".claude", "settings.json")) as { hooks?: Record<string, unknown> } | undefined;
  const servers = mcp?.mcpServers ?? {};
  const mcpServers = Object.keys(servers).map((id) => ({ id, pointsAt: hubOf(id, servers[id]) }));
  const hooks = Object.keys(settings?.hooks ?? {});
  return claudeCodeCliHarness({
    id: opts.id ?? "this",
    model: opts.model ?? "opus",
    mcpServers,
    hooks,
  });
}

/** The canonical harness: one mcp-server discovering 561 Group Operations Manifold — the standing law
 *  that every tool and read routes You<->MCP<->561 Group Operations Manifold. */
export function planHarness(opts: ReadOptions = {}): ClaudeCodeCliHarnessCarrier {
  return claudeCodeCliHarness({
    id: opts.id ?? "this",
    model: opts.model ?? "opus",
    mcpServers: [{ id: OPERATIONS_MANIFOLD_HUB, pointsAt: OPERATIONS_MANIFOLD_HUB }],
    hooks: ["SessionStart", "UserPromptSubmit", "Stop"],
  });
}

export function pointsAtOperationsManifold(h: ClaudeCodeCliHarnessCarrier): boolean {
  return h.mcpServers.some((s) => s.pointsAt === OPERATIONS_MANIFOLD_HUB);
}

export interface ApplyOptions {
  readonly root?: string;
  /** The 561 Group Operations Manifold MCP hub URL the wired server points at. */
  readonly hubUrl?: string;
  /** Write to disk; otherwise dry-run. */
  readonly write?: boolean;
}

export const ApplyOptionsSchema = {
  $id: "organizing/claude/harness/apply-options",
  type: "object",
  title: "ClaudeHarnessApplyOptions",
  properties: {
    root: { type: "string", minLength: 1 },
    hubUrl: { type: "string", minLength: 1 },
    write: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

export const applyOptionsCarrier = carrierFrom(ApplyOptionsSchema);

export interface ApplyResult {
  readonly path: string;
  readonly before: unknown;
  readonly after: { readonly mcpServers: Record<string, unknown> };
  readonly wrote: boolean;
}

export const ApplyResultSchema = {
  $id: "organizing/claude/harness/apply-result",
  type: "object",
  title: "ClaudeHarnessApplyResult",
  required: ["path", "before", "after", "wrote"],
  properties: {
    path: { type: "string", minLength: 1 },
    before: {},
    after: {
      type: "object",
      required: ["mcpServers"],
      properties: {
        mcpServers: { type: "object", additionalProperties: {} },
      },
      additionalProperties: false,
    },
    wrote: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

export const applyResultCarrier = carrierFrom(ApplyResultSchema);

export const canonicalizeReadOptionsAction = action({
  verb: "organizing.claude.harness.canonicalize-read-options",
  description: "Canonicalize Claude harness read options.",
  domain: readOptionsCarrier,
  codomain: readOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeApplyOptionsAction = action({
  verb: "organizing.claude.harness.canonicalize-apply-options",
  description: "Canonicalize Claude harness apply options.",
  domain: applyOptionsCarrier,
  codomain: applyOptionsCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeApplyResultAction = action({
  verb: "organizing.claude.harness.canonicalize-apply-result",
  description: "Canonicalize a Claude harness apply result.",
  domain: applyResultCarrier,
  codomain: applyResultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const harnessActions = Object.freeze([
  canonicalizeReadOptionsAction,
  canonicalizeApplyOptionsAction,
  canonicalizeApplyResultAction,
]);

/** Project the canonical You<->MCP<->561 Group Operations Manifold wiring into .mcp.json — the write
 *  direction. Merges (never clobbers) existing servers; only the settings/hooks
 *  side is gated elsewhere. The computer wires the harness; nothing is hand-edited. */
export function applyMcpConfig(opts: ApplyOptions = {}): ApplyResult {
  const root = opts.root ?? process.cwd();
  const path = join(root, ".mcp.json");
  const before = readJson(path) as { mcpServers?: Record<string, unknown> } | undefined;
  const servers: Record<string, unknown> = { ...(before?.mcpServers ?? {}) };
  servers[OPERATIONS_MANIFOLD_HUB] = { type: "http", url: opts.hubUrl ?? "http://127.0.0.1:18805/hub/mcp" };
  const after = { mcpServers: servers };
  if (opts.write === true) writeFileSync(path, `${JSON.stringify(after, null, 2)}\n`);
  return { path, before: before ?? null, after, wrote: opts.write === true };
}

export function renderHarness(h: ClaudeCodeCliHarnessCarrier): string {
  const servers =
    h.mcpServers.length === 0
      ? "(none)"
      : h.mcpServers.map((s) => `${s.id} -> ${s.pointsAt}`).join(", ");
  return [
    `harness: ${h.term}  (agent ${h.agent}, model ${h.model})`,
    `  mcp-servers: ${servers}`,
    `  hooks: ${h.hooks.length === 0 ? "(none)" : h.hooks.join(", ")}`,
    `  You<->MCP<->561 Group Operations Manifold: ${pointsAtOperationsManifold(h) ? "wired" : "MISSING — no mcp-server points at 561 Group Operations Manifold"}`,
    `  utterances settled: ${h.utterances.length}`,
  ].join("\n");
}
