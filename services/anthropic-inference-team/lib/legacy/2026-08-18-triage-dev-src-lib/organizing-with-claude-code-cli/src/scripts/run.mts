#!/usr/bin/env node
/**
 * claude-run — drive the `claude` binary in print mode with a composed harness.
 *
 * This is the side-effecting boundary the rest of the library stays pure of: it
 * maps flags (and an optional --harness plan JSON: MCP servers, hooks, injected
 * context) into ClaudeRunOptions and spawns `claude`. The prompt is read from
 * --prompt, the trailing positionals, or stdin. stdout/stderr stream through, so
 * `claude-run --output-format json … | claude-session trace` is the canonical
 * project-this-session pipeline.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import {
  runClaudePrint,
  type ClaudeInputFormat,
  type ClaudeOutputFormat,
  type ClaudePermissionMode,
  type ClaudeRunOptions,
} from "../exec.mjs";
import { planRunOptions, type HarnessPlan } from "../harness.mjs";

const VALUE = new Set([
  "--model", "--fallback-model", "--effort", "--output-format", "--input-format",
  "--session-id", "--name", "--system-prompt", "--append-system-prompt", "--settings",
  "--agent", "--agents", "--json-schema", "--permission-mode", "--max-budget-usd",
  "--prompt", "--harness", "--bin",
]);
const LIST = new Set(["--allowed-tools", "--allowedTools", "--disallowed-tools", "--tools", "--setting-sources"]);
const REPEAT = new Set(["--add-dir", "--mcp-config"]);
const BOOL = new Set([
  "--continue", "--fork-session", "--strict-mcp-config", "--bare", "--safe-mode",
  "--verbose", "--include-partial-messages", "--include-hook-events",
  "--dangerously-skip-permissions", "--no-session-persistence",
]);

function usage(): never {
  process.stderr.write(
    "usage: claude-run [--model m] [--output-format text|json|stream-json] [--session-id uuid]\n" +
    "                  [--resume [id]] [--continue] [--append-system-prompt t] [--add-dir d]...\n" +
    "                  [--allowed-tools a,b] [--mcp-config cfg]... [--permission-mode m]\n" +
    "                  [--harness plan.json] [--bin path] [--prompt p | -- prompt... | stdin]\n",
  );
  process.exit(2);
}

function parse(argv: readonly string[]): {
  options: Record<string, string>;
  lists: Record<string, string>;
  repeats: Record<string, string[]>;
  bools: Set<string>;
  resume?: string | boolean;
  positionals: string[];
} {
  const options: Record<string, string> = {};
  const lists: Record<string, string> = {};
  const repeats: Record<string, string[]> = {};
  const bools = new Set<string>();
  const positionals: string[] = [];
  let resume: string | boolean | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (arg === "--resume") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) { resume = next; i++; } else resume = true;
      continue;
    }
    if (BOOL.has(arg)) { bools.add(arg); continue; }
    if (VALUE.has(arg)) { options[arg] = req(argv, ++i, arg); continue; }
    if (LIST.has(arg)) { lists[arg] = req(argv, ++i, arg); continue; }
    if (REPEAT.has(arg)) { (repeats[arg] ??= []).push(req(argv, ++i, arg)); continue; }
    if (arg === "-h" || arg === "--help") usage();
    if (arg.startsWith("-")) { process.stderr.write(`unknown flag: ${arg}\n`); usage(); }
    positionals.push(arg);
  }
  return { options, lists, repeats, bools, ...(resume === undefined ? {} : { resume }), positionals };
}

function req(argv: readonly string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) { process.stderr.write(`flag ${flag} needs a value\n`); usage(); }
  return value;
}

function csv(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const p = parse(process.argv.slice(2));
  const harness: ClaudeRunOptions =
    p.options["--harness"] !== undefined
      ? planRunOptions(JSON.parse(readFileSync(p.options["--harness"], "utf8")) as HarnessPlan)
      : {};

  const prompt = p.options["--prompt"] ?? (p.positionals.length > 0 ? p.positionals.join(" ") : await readStdin());
  const outputFormat = p.options["--output-format"] as ClaudeOutputFormat | undefined;
  const inputFormat = p.options["--input-format"] as ClaudeInputFormat | undefined;
  const permissionMode = p.options["--permission-mode"] as ClaudePermissionMode | undefined;
  const allowedTools = csv(p.lists["--allowed-tools"] ?? p.lists["--allowedTools"]);
  const disallowedTools = csv(p.lists["--disallowed-tools"]);
  const tools = csv(p.lists["--tools"]);
  const settingSources = csv(p.lists["--setting-sources"]);

  const flagOptions: ClaudeRunOptions = {
    ...(prompt.length === 0 ? {} : { prompt }),
    ...(outputFormat === undefined ? {} : { outputFormat }),
    ...(inputFormat === undefined ? {} : { inputFormat }),
    ...(p.options["--model"] === undefined ? {} : { model: p.options["--model"] }),
    ...(p.options["--fallback-model"] === undefined ? {} : { fallbackModel: p.options["--fallback-model"] }),
    ...(p.options["--effort"] === undefined ? {} : { effort: p.options["--effort"] }),
    ...(p.options["--session-id"] === undefined ? {} : { sessionId: p.options["--session-id"] }),
    ...(p.resume === undefined ? {} : { resume: p.resume }),
    ...(p.bools.has("--continue") ? { continue: true } : {}),
    ...(p.bools.has("--fork-session") ? { forkSession: true } : {}),
    ...(p.bools.has("--no-session-persistence") ? { noSessionPersistence: true } : {}),
    ...(p.options["--name"] === undefined ? {} : { name: p.options["--name"] }),
    ...(p.options["--system-prompt"] === undefined ? {} : { systemPrompt: p.options["--system-prompt"] }),
    ...(p.options["--append-system-prompt"] === undefined ? {} : { appendSystemPrompt: p.options["--append-system-prompt"] }),
    ...(p.repeats["--add-dir"] === undefined ? {} : { addDirs: p.repeats["--add-dir"] }),
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(disallowedTools === undefined ? {} : { disallowedTools }),
    ...(tools === undefined ? {} : { tools }),
    ...(p.repeats["--mcp-config"] === undefined ? {} : { mcpConfig: p.repeats["--mcp-config"] }),
    ...(p.bools.has("--strict-mcp-config") ? { strictMcpConfig: true } : {}),
    ...(p.options["--settings"] === undefined ? {} : { settings: p.options["--settings"] }),
    ...(settingSources === undefined ? {} : { settingSources }),
    ...(p.options["--agent"] === undefined ? {} : { agent: p.options["--agent"] }),
    ...(p.options["--agents"] === undefined ? {} : { agents: p.options["--agents"] }),
    ...(p.bools.has("--include-hook-events") ? { includeHookEvents: true } : {}),
    ...(p.options["--json-schema"] === undefined ? {} : { jsonSchema: p.options["--json-schema"] }),
    ...(p.options["--max-budget-usd"] === undefined ? {} : { maxBudgetUsd: Number(p.options["--max-budget-usd"]) }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(p.bools.has("--dangerously-skip-permissions") ? { dangerouslySkipPermissions: true } : {}),
    ...(p.bools.has("--bare") ? { bare: true } : {}),
    ...(p.bools.has("--safe-mode") ? { safeMode: true } : {}),
    ...(p.bools.has("--verbose") ? { verbose: true } : {}),
    ...(p.bools.has("--include-partial-messages") ? { includePartialMessages: true } : {}),
  };

  // Flags win over the harness plan where they overlap.
  const options: ClaudeRunOptions = { ...harness, ...flagOptions };
  const outcome = await runClaudePrint(options, {
    ...(p.options["--bin"] === undefined ? {} : { bin: p.options["--bin"] }),
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  return outcome.code ?? 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stderr.write(`claude-run: ${(error as Error).message}\n`);
  process.exit(1);
});
