#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { assertActorAddress } from "@red-cup-engineering/claude-harness-projection-service";
import { runMain } from "@red-cup-engineering/javascript-file-main-guard-service";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVENT = "UserPromptSubmit";
const MAX_BYTES = 4000;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export function readIdentity(policy, root = process.cwd()) {
  assertActorAddress(policy.actor, "Claude harness policy");
  const s = policy.rootSeating;
  if (!s?.character || !s?.incumbency || typeof policy.rootOffice !== "string")
    return { state: "unavailable", reason: "root seating is unavailable" };
  try {
    const character = readJson(resolve(root, s.character));
    const incumbency = readJson(resolve(root, s.incumbency));
    if (
      incumbency.holder !== character.id ||
      incumbency.office !== policy.rootOffice ||
      incumbency.recognition !== "t" ||
      incumbency.induction !== "t"
    )
      return {
        state: "unavailable",
        reason: "root seating is not recognized and inducted",
      };
    return {
      state: "recognized",
      actor: policy.actor,
      office: incumbency.office,
      character: character.id,
      incumbency: incumbency.id,
    };
  } catch (error) {
    return {
      state: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}
function appendEntries(prefix, entries, bytes) {
  let text = prefix;
  for (const entry of entries) {
    const separator = text === prefix ? "" : "; ";
    if (byteLength(text) + byteLength(separator) + byteLength(entry) > bytes)
      continue;
    text += `${separator}${entry}`;
  }
  return text;
}
export function renderContext(value, bytes = MAX_BYTES) {
  if (!value || typeof value !== "object") return "context: unavailable";
  if (value.kind === "coding-context.relevance.refusal") {
    const reason = value.reason ?? "request refused";
    // The projector's refusal already carries why it could not fit
    // (requiredBytes/maxBytes/promptBytes); surface that instead of
    // discarding it, so a refused turn is diagnosable from the transcript
    // alone rather than a bare, unexplained "refused (reason)".
    const sizes = [
      typeof value.requiredBytes === "number" ? `needed ${value.requiredBytes}b` : null,
      typeof value.maxBytes === "number" ? `budget ${value.maxBytes}b` : null,
      typeof value.promptBytes === "number" ? `prompt ${value.promptBytes}b` : null,
    ].filter((entry) => entry !== null);
    return sizes.length > 0
      ? `context: refused (${reason}; ${sizes.join(", ")})`
      : `context: refused (${reason})`;
  }
  if (value.kind === "coding-context.unavailable" || value.isError)
    return `context: unavailable (${value.reason ?? "request failed"})`;
  const invocations = new Set();
  const descriptions = new Set();
  for (const row of value.packages ?? []) {
    if (row?.package)
      descriptions.add(
        `package ${row.package}${row.packagePath ? ` at ${row.packagePath}` : ""}`,
      );
    for (const bin of row?.bins ?? [])
      if (bin?.bin && bin?.target)
        invocations.add(
          `invoke ${bin.bin}: ${value.metadata?.root ? `${value.metadata.root}/` : ""}${row.packagePath}/${bin.target.replace(/^\.\//u, "")}`,
        );
    for (const exported of row?.exports ?? [])
      if (row?.package)
        descriptions.add(
          `export ${exported === "." ? row.package : `${row.package}/${String(exported).replace(/^\.\//u, "")}`}`,
        );
  }
  for (const row of value.scripts ?? [])
    if (row?.bin && row?.target)
      invocations.add(
        `invoke ${row.bin}: ${value.metadata?.root ? `${value.metadata.root}/` : ""}${row.packagePath}/${row.target.replace(/^\.\//u, "")}`,
      );
  if (invocations.size + descriptions.size === 0)
    return "context: no matching declared capability";
  return appendEntries(
    "relevant capability evidence: ",
    [...invocations, ...descriptions],
    bytes,
  );
}
export async function queryContext(prompt, mcpPath, signal) {
  const url = readJson(mcpPath)?.mcpServers?.["jsnode-server"]?.url;
  if (typeof url !== "string")
    throw new Error("configured jsnode-server MCP endpoint is unavailable");
  const client = new Client({ name: "claude-per-turn-context", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const abort = () => {
    void client.close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await client.connect(transport);
    const result = await client.callTool(
      {
        name: "jsnode_context",
        arguments: { prompt, limit: 4, maxBytes: 4000 },
      },
      undefined,
      { signal },
    );
    if (result.isError)
      return {
        kind: "coding-context.unavailable",
        isError: true,
        reason: result.content?.[0]?.text ?? "MCP context request failed",
      };
    return (
      result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}")
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    await client.close();
  }
}
export async function withTimeout(call, milliseconds = 3000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("context deadline exceeded");
      controller.abort(error);
      reject(error);
    }, milliseconds);
  });
  try {
    return await Promise.race([call(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export async function emitPerTurnDuty({
  input,
  expectedEvent = EVENT,
  policyPath = resolve(ROOT, "content/harness/claude-agent-harness.json"),
  mcpPath = resolve(
    process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    ".mcp.json",
  ),
  callContext = queryContext,
  root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
} = {}) {
  if (
    !input ||
    input.hook_event_name !== EVENT ||
    expectedEvent !== EVENT ||
    typeof input.prompt !== "string"
  )
    throw new Error(
      `per-turn duty is admitted only for ${EVENT} with its exact prompt`,
    );
  const policy = readJson(policyPath);
  const identity = readIdentity(policy, root);
  let context;
  try {
    context = await withTimeout((signal) =>
      callContext(input.prompt, mcpPath, signal),
    );
  } catch (error) {
    context = {
      kind: "coding-context.unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const identityLine =
    identity.state === "recognized"
      ? `actor: ${identity.actor}; office: ${identity.office}; character: ${identity.character}; incumbency: ${identity.incumbency}`
      : `identity: unavailable (${identity.reason})`;
  const reservedLines = [identityLine, policy.shortReminder].filter(Boolean);
  const contextBytes = MAX_BYTES - byteLength(reservedLines.join("\n")) - 1;
  return Object.freeze({
    hookSpecificOutput: {
      hookEventName: EVENT,
      additionalContext: [...reservedLines, renderContext(context, contextBytes)].join("\n"),
    },
  });
}
await runMain(
  async ({ stdout }) =>
    stdout.write(
      JSON.stringify(
        await emitPerTurnDuty({
          input: await readBoundedHookInput(process.stdin),
          expectedEvent: cliArgument("--expected-event"),
        }),
      ),
    ),
  { moduleUrl: import.meta.url, exitCode: 1 },
);
