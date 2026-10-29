/**
 * session — the OpenAI-dialect coding-agent session computer.
 *
 * The same four capabilities the codex session computer exposes (capsule,
 * finding, impact, recall) over the shared @emsenn/organizing-with-llm-agents/session
 * substrate, branded for this package and stored under .data/openai-agents — plus
 * two capabilities specific to driving any OpenAI-compatible endpoint:
 *
 *   endpoints — list the built-in OpenAI-dialect endpoints and whether each has a
 *               key present (the redacted holography projection; never a value)
 *   chat      — drive a real inference turn against an endpoint, print the reply,
 *               and record the run's findings into the session log
 *
 * Findings are recorded in the SAME vocabulary codex and claude-code-cli use, so a
 * session's memory recalls across providers — the interop substrate in practice.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gitStatus } from "@emsenn/computing/git";

import { action, carrierFrom, mark, negate, tm, valueOf, witnessedPotential } from "@emsenn/relating";
import { canonical as canonicalJson, requireJsonValue } from "@emsenn/relating/writing";
import {
  appendSessionFindings,
  computeImpact,
  finding,
  findRepoRoot,
  loadWorkspace,
  recallSessionSubject,
  renderSessionRecall,
  type Finding,
} from "@emsenn/organizing-with-llm-agents/session";
import { dataMountRoot } from "@emsenn/organizing-with-llm-agents/mount";
import { availableEndpoints, resolveEndpoint, firstAvailableEndpoint } from "../endpoints.mjs";
import { openaiAgentInfer } from "../inference.mjs";
import { runChat, runFindings } from "../run.mjs";

export interface CliResult { readonly code: number; readonly output: string }

export const CliResultSchema = { "$id": "organizing/agents/openai/session/cli-result", "title": "OpenaiAgentSessionCliResult", "additionalProperties": false, type: "object", required: ["code", "output"], properties: { "code": { type: "integer" }, "output": { type: "string" } } } as const;

export const cliResultCarrier = carrierFrom(CliResultSchema);

export const CapsuleFileSliceSchema = { "$id": "organizing/agents/openai/session/capsule-file-slice", "title": "OpenaiAgentCapsuleFileSlice", "additionalProperties": false, type: "object", required: ["path", "bytes", "truncated", "sha256", "text"], properties: { "path": { type: "string", "minLength": 1 }, "bytes": { type: "integer", "minimum": 0 }, "truncated": { type: "boolean" }, "sha256": { type: "string", "minLength": 1 }, "text": { type: "string" } } } as const;

export const SessionCapsuleSchema = { "$id": "organizing/agents/openai/session/capsule", "title": "OpenaiAgentSessionCapsule", "additionalProperties": false, type: "object", required: ["id", "generatedAt", "repoRoot", "packages", "terms", "files"], properties: { "id": { type: "string", "minLength": 1 }, "generatedAt": { type: "string", "minLength": 1 }, "repoRoot": { type: "string", "minLength": 1 }, "packages": { type: "array", items: { type: "string", "minLength": 1 } }, "terms": { type: "array", items: { type: "array", items: { type: "string" } } }, "files": { type: "array", items: CapsuleFileSliceSchema } } } as const;

export const capsuleFileSliceCarrier = carrierFrom(CapsuleFileSliceSchema);

export const sessionCapsuleCarrier = carrierFrom(SessionCapsuleSchema);

export const canonicalizeCliResultAction = action({
  verb: "organizing.agents.openai.session.canonicalize-cli-result",
  description: "Canonicalize an OpenAI-dialect session CLI result carrier.",
  domain: cliResultCarrier,
  codomain: cliResultCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeCapsuleFileSliceAction = action({
  verb: "organizing.agents.openai.session.canonicalize-capsule-file-slice",
  description: "Canonicalize an OpenAI-dialect session capsule file slice carrier.",
  domain: capsuleFileSliceCarrier,
  codomain: capsuleFileSliceCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const canonicalizeSessionCapsuleAction = action({
  verb: "organizing.agents.openai.session.canonicalize-capsule",
  description: "Canonicalize an OpenAI-dialect session capsule carrier.",
  domain: sessionCapsuleCarrier,
  codomain: sessionCapsuleCarrier,
  runTerm: tm.lam(tm.var(0)),
});

export const actions = Object.freeze([
  canonicalizeCliResultAction,
  canonicalizeCapsuleFileSliceAction,
  canonicalizeSessionCapsuleAction,
]);

const PACKAGE_CONTEXT_FILES = ["package.json", "README.md", "src/index.mts", "src/index.ts", "tsconfig.json"] as const;
const DEFAULT_MAX_BYTES = 24 * 1024;

const USAGE = `openai-agent-session — OpenAI-dialect coding-agent session computer

usage:
  openai-agent-session capsule  --packages a,b [--files x,y] [--max-bytes N]
  openai-agent-session finding  --session <id> --subject a,b,c --predicate <p> [--object <json>]
                                [--charge affirmed|denied] [--note <text>]
  openai-agent-session impact   [--json]
  openai-agent-session recall   --session <id> --subject a,b,c
  openai-agent-session endpoints [--json]
  openai-agent-session chat     --session <id> [--endpoint id] [--model m] [--system t]
                                (--prompt <text> | prompt… | stdin) [--json]
`;

function id(value: unknown): string {
  return createHash("sha256").update(canonicalJson(requireJsonValue(value, "session id value"))).digest("hex").slice(0, 16);
}
// capsule/impact artifacts live alongside the shared data mount; findings live IN
// it, under one namespace, so the session, the pulse, and the TUI share memory.
const storeRoot = (repoRoot: string): string => path.join(repoRoot, ".data", "openai-agents");
const MOUNT_NAMESPACE = "openai-agent";
const mountRoot = (repoRoot: string): string => dataMountRoot({ root: path.join(repoRoot, "data") });
const csv = (value: string | undefined): readonly string[] =>
  value === undefined ? [] : value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

type Flags = Readonly<{ options: Readonly<Record<string, string>>; positionals: readonly string[]; bools: ReadonlySet<string> }>;
function parse(args: readonly string[]): Flags {
  const options: Record<string, string> = {};
  const positionals: string[] = [];
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "json") { bools.add(key); continue; }
      const next = args[i + 1];
      if (next === undefined) throw new Error(`flag --${key} needs a value`);
      options[key] = next; i++;
    } else positionals.push(arg);
  }
  return { options, positionals, bools };
}
const need = (flags: Flags, key: string): string => {
  const value = flags.options[key];
  if (value === undefined) throw new Error(`missing required --${key}`);
  return value;
};

async function readSlice(repoRoot: string, relative: string, maxBytes: number) {
  const absolute = path.resolve(repoRoot, relative);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`)) return undefined;
  try {
    const buffer = await readFile(absolute);
    const truncated = buffer.byteLength > maxBytes;
    return {
      path: relative,
      bytes: buffer.byteLength,
      truncated,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      text: (truncated ? buffer.subarray(0, maxBytes) : buffer).toString("utf8"),
    };
  } catch { return undefined; }
}

async function cmdCapsule(flags: Flags): Promise<string> {
  const repoRoot = await findRepoRoot();
  const store = storeRoot(repoRoot);
  await mkdir(path.join(store, "capsules"), { recursive: true });
  const workspace = await loadWorkspace(repoRoot);
  const names = csv(flags.options["packages"]);
  const pkgs = names.map((n) => {
    const pkg = workspace.byName.get(n) ?? workspace.packages.find((p) => p.relativePath === n);
    if (!pkg) throw new Error(`no package matched ${n}`);
    return pkg;
  });
  const candidatePaths = [
    ...pkgs.flatMap((p) => PACKAGE_CONTEXT_FILES.map((f) => `${p.relativePath}/${f}`)),
    ...csv(flags.options["files"]),
  ];
  const maxBytes = flags.options["max-bytes"] ? Number(flags.options["max-bytes"]) : DEFAULT_MAX_BYTES;
  const slices = (await Promise.all([...new Set(candidatePaths)].map((p) => readSlice(repoRoot, p, maxBytes))))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .sort((a, b) => a.path.localeCompare(b.path));
  const terms = pkgs.map((p) => ["openai-agent", "package", p.name]);
  const capsuleId = id({ kind: "openai-agent-capsule", packages: names, files: slices.map((s) => [s.path, s.sha256]) });
  const capsule = { id: capsuleId, generatedAt: new Date().toISOString(), repoRoot, packages: names, terms, files: slices };
  await writeFile(path.join(store, "capsules", `${capsuleId}.json`), `${JSON.stringify(capsule, null, 2)}\n`);
  return `capsule ${capsuleId}: ${slices.length} slices from ${names.length} package(s) → ${path.relative(repoRoot, path.join(store, "capsules", `${capsuleId}.json`))}`;
}

async function cmdFinding(flags: Flags): Promise<string> {
  const repoRoot = await findRepoRoot();
  const sessionId = need(flags, "session");
  const subject = csv(need(flags, "subject"));
  const predicate = need(flags, "predicate");
  const chargeName = (flags.options["charge"] ?? "affirmed");
  const at = new Date().toISOString();
  const witness = { source: "openai-agent", session: sessionId, subject, predicate, at };
  const f = finding({
    session: sessionId, subject, predicate, at,
    charge: chargeName === "denied"
      ? negate(witnessedPotential(mark(witness)))
      : witnessedPotential(mark(witness)),
    ...(flags.options["object"] === undefined ? {} : { object: parseObject(flags.options["object"]) }),
    ...(flags.options["note"] === undefined ? {} : { note: flags.options["note"] }),
  });
  await recordFindings(repoRoot, [f]);
  return `finding recorded · session ${sessionId} · ${subject.join("/")} ${predicate} = ${valueOf(f.charge).name}`;
}

async function cmdImpact(flags: Flags): Promise<string> {
  const repoRoot = await findRepoRoot();
  const store = storeRoot(repoRoot);
  await mkdir(path.join(store, "impact"), { recursive: true });
  const workspace = await loadWorkspace(repoRoot);
  const impact = computeImpact(workspace, await gitStatus(repoRoot));
  const impactId = id({ kind: "openai-agent-impact", changed: impact.changedFiles.map((e) => e.path) });
  await writeFile(path.join(store, "impact", `${impactId}.json`), `${JSON.stringify({ id: impactId, ...impact }, null, 2)}\n`);
  if (flags.bools.has("json")) return JSON.stringify({ id: impactId, ...impact }, null, 2);
  if (impact.packageImpacts.length === 0 && impact.rootChanges.length === 0) return "impact: working tree clean";
  return [
    `change impact ${impactId}:`,
    ...impact.packageImpacts.map((p) => `  ${p.package}  (${p.changedFiles.length} files${p.directDependents.length ? `, ${p.directDependents.length} dependents` : ""})`),
    ...(impact.rootChanges.length ? [`  root: ${impact.rootChanges.length} change(s)`] : []),
    impact.suggestedCommands.length ? "  suggested:" : "  suggested: (none)",
    ...impact.suggestedCommands.map((c) => `    ${c}`),
  ].join("\n");
}

async function cmdRecall(flags: Flags): Promise<string> {
  const repoRoot = await findRepoRoot();
  const sessionId = need(flags, "session");
  const subject = csv(need(flags, "subject"));
  const recall = await recallSessionSubject(mountRoot(repoRoot), MOUNT_NAMESPACE, sessionId, subject);
  if (recall.entries.length === 0) return `recall: no findings for session ${sessionId}`;
  return renderSessionRecall(recall);
}

function cmdEndpoints(flags: Flags): string {
  const projections = availableEndpoints();
  if (flags.bools.has("json")) return JSON.stringify(projections, null, 2);
  return [
    "endpoints (OpenAI dialect):",
    ...projections.map((p) =>
      `  ${p.apiKey.present ? "✓" : "·"} ${p.endpoint.padEnd(10)} ${p.baseUrl}` +
      `${p.defaultModel ? `  (default ${p.defaultModel})` : ""}` +
      `  key:${p.apiKey.present ? `present via ${p.apiKey.envVarName}` : "absent"}`,
    ),
  ].join("\n");
}

async function cmdChat(flags: Flags): Promise<string> {
  const repoRoot = await findRepoRoot();
  const sessionId = need(flags, "session");
  const prompt = flags.options["prompt"] ?? (flags.positionals.length > 0 ? flags.positionals.join(" ") : await readStdin());
  if (prompt.trim().length === 0) throw new Error("chat: no prompt (give --prompt, positional text, or stdin)");

  const endpointId = flags.options["endpoint"] ?? firstAvailableEndpoint()?.endpoint;
  if (endpointId === undefined) throw new Error("chat: no endpoint key present; set one of NVIDIA_API_KEY/GROQ_API_KEY/CEREBRAS_API_KEY/OPENAI_API_KEY or pass --endpoint");
  const endpoint = resolveEndpoint(endpointId);
  const infer = openaiAgentInfer(endpoint);
  const outcome = await runChat(infer, {
    id: sessionId,
    prompt,
    ...(flags.options["model"] === undefined ? {} : { model: flags.options["model"] }),
    ...(flags.options["system"] === undefined ? {} : { system: flags.options["system"] }),
  });
  await recordFindings(repoRoot, runFindings(outcome.run, { at: new Date().toISOString() }));

  if (flags.bools.has("json")) {
    return JSON.stringify({
      session: sessionId,
      endpoint: outcome.result.endpoint,
      model: outcome.result.model,
      regime: outcome.classification.regime,
      settled: outcome.classification.settled,
      cost: outcome.cost,
      text: outcome.result.text,
    }, null, 2);
  }
  const usage = outcome.result.usage;
  return [
    `chat · session ${sessionId} · ${outcome.result.endpoint}/${outcome.result.model} · ${outcome.classification.regime}` +
      (usage ? ` · tokens ${usage.input ?? "?"}/${usage.output ?? "?"}` : ""),
    "",
    outcome.result.text,
  ].join("\n");
}

function parseObject(value: string): unknown { try { return JSON.parse(value); } catch { return value; } }

async function recordFindings(repoRoot: string, findings: readonly Finding[]): Promise<void> {
  if (findings.length === 0) return;
  const at = new Date().toISOString();
  await appendSessionFindings(mountRoot(repoRoot), MOUNT_NAMESPACE, findings, at);
}

async function readStdin(): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Run the OpenAI-dialect session computer over an argv vector. */
export async function runSessionCli(argv: readonly string[]): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { code: command === undefined ? 1 : 0, output: USAGE };
  }
  try {
    const flags = parse(rest);
    switch (command) {
      case "capsule": return { code: 0, output: await cmdCapsule(flags) };
      case "finding": return { code: 0, output: await cmdFinding(flags) };
      case "impact": return { code: 0, output: await cmdImpact(flags) };
      case "recall": return { code: 0, output: await cmdRecall(flags) };
      case "endpoints": return { code: 0, output: cmdEndpoints(flags) };
      case "chat": return { code: 0, output: await cmdChat(flags) };
      default: return { code: 1, output: `unknown command: ${command}\n\n${USAGE}` };
    }
  } catch (error) {
    return { code: 1, output: `error: ${(error as Error).message}` };
  }
}
