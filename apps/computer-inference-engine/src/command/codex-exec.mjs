/**
 * Codex (`codex exec`) as an inference provider. The prompt goes on stdin; the
 * final answer is read from the -o file; with webSearch the run has live web
 * search and counts the searches it completed. The child sees only an allowlist
 * of environment variables, so API and publication secrets never enter it; its
 * saved ChatGPT login stays in CODEX_HOME. The sandbox is read-only in a fresh
 * temporary directory.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exchangeRecorder, promptOfMessages, resolveExecutable, runBounded } from "./exchange.mjs";
import { isClosedJsonSchema } from "../dispatch/direct-endpoint-provider.mjs";

const CHILD_ENVIRONMENT = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "TMPDIR", "CODEX_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"];

/** Redact secrets from a diagnostic tail before it enters a record. */
export function redactDiagnostic(text, env = process.env) {
  let value = String(text || "").slice(-8192).replace(/\x1b\[[0-9;]*m/gu, "");
  for (const [key, secret] of Object.entries(env)) if (/(?:token|secret|password|api.?key)/iu.test(key) && secret?.length >= 8) value = value.split(secret).join("[redacted]");
  return value.replace(/\b(?:Bearer\s+|(?:access_token|refresh_token|api_key|authorization|password|cookie)["']?\s*[:=]\s*["']?)[^\s,"';]+/giu, "[redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+|[A-Za-z0-9_-]{64,})\b/gu, "[redacted]")
    .split("\n").filter(Boolean).slice(-6).join("\n").slice(-2000);
}

/**
 * Run one chat packet through codex exec.
 * @param {{model?: string, messages: Array<{role: string, content: string}>, params?: {webSearch?: boolean}}} packet
 * @param {{executable?: string, env?: object, timeoutMs?: number}} [options]
 * @returns an exchange record; a completion's raw carries { completedSearches }
 */
export async function runCodexExecExchange(packet, { executable = process.env.CODEX_BIN ?? "codex", env = process.env, timeoutMs = null, signal } = {}) {
  const record = exchangeRecorder(packet, "codex-cli-invocations");
  const binary = resolveExecutable(executable, env);
  if (!binary) return record.refusal(`the \`${executable}\` binary was not found; no subprocess was spawned`, ["codex-binary-absent"], 0);
  const { system, prompt } = promptOfMessages(packet.messages);
  const cwd = await mkdtemp(join(tmpdir(), "codex-exec-"));
  const outputPath = join(cwd, "final.md");
  // Codex decodes under a schema only when it is closed (its structured outputs are strict).
  const outputSchema = packet.params?.outputSchema;
  const schemaPath = outputSchema !== undefined && isClosedJsonSchema(outputSchema) ? join(cwd, "output-schema.json") : undefined;
  if (schemaPath !== undefined) await writeFile(schemaPath, JSON.stringify(outputSchema));
  let completedSearches = 0, failure = "", usage;
  const onStdoutLine = (line) => {
    if (!line.trim()) return;
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.type === "item.completed" && event.item?.type === "web_search" && (!event.item.status || event.item.status === "completed")) completedSearches += 1;
    if (event.type === "turn.completed" && event.usage) usage = event.usage;
    if (event.type === "error" || event.type === "turn.failed") failure = redactDiagnostic(event.error?.message || event.message, env) || failure;
  };
  try {
    const args = ["exec", ...(packet.model && packet.model !== "default" ? ["--model", packet.model] : []), "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", ...(packet.params?.webSearch ? ["-c", 'web_search="live"'] : []), ...(schemaPath === undefined ? [] : ["--output-schema", schemaPath]), "--json", "-o", outputPath, "-"];
    const childEnv = Object.fromEntries(CHILD_ENVIRONMENT.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
    const result = await runBounded(binary, args, { input: [...system, prompt].join("\n\n"), env: childEnv, cwd, timeoutMs, signal, onStdoutLine });
    if (result.cancelled) return record.refusal("receiver cancelled the command exchange", ["receiver-cancelled"]);
    const detail = failure || redactDiagnostic(result.stderr, env);
    if (result.error) return record.refusal(`the codex subprocess could not run: ${result.error.message}`, ["subprocess-spawn-error"], 0);
    if (result.timedOut) return record.refusal(`the codex subprocess exceeded ${timeoutMs}ms${detail ? `: ${detail}` : ""}`, ["subprocess-timeout"]);
    if (result.status !== 0) return record.refusal(`the codex subprocess exited ${result.status ?? result.signal}${detail ? `: ${detail}` : ""}`, [`subprocess-exit:${result.status ?? result.signal}`]);
    if (failure) return record.refusal(`the codex turn failed: ${failure}`, ["codex-turn-failed"]);
    const text = existsSync(outputPath) ? await readFile(outputPath, "utf8") : "";
    if (!text.trim()) return record.refusal("codex produced no final answer", ["missing-completion-content"]);
    return record.completion({ model: packet.model ?? "default", text, raw: { completedSearches, ...(usage ? { usage } : {}) }, usagePrefix: "codex" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
