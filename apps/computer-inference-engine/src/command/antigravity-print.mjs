/**
 * Antigravity CLI (`agy`) in print mode as an inference provider: the Google AI
 * Pro subscription's weekly compute, reached on the local Google login in
 * ~/.gemini/antigravity-cli. The packet goes on stdin as one stream-json user
 * message (print mode takes its text prompt only as an argument, which bounds
 * its size); the turn runs sandboxed in a fresh temporary directory with an
 * allowlisted environment, so API and publication secrets never enter it, and
 * no tool permission is ever granted. Optional provider-validated JSON output
 * via params.outputSchema, read from the result's structured_output.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactDiagnostic } from "./codex-exec.mjs";
import { exchangeRecorder, promptOfMessages, resolveExecutable, runBounded } from "./exchange.mjs";

const CHILD_ENVIRONMENT = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"];

// The weekly compute cap is the subscription's only meter; a turn refused on it
// is named so allocation reads the pool as spent rather than the provider as down.
const QUOTA_REFUSAL = /quota|rate.?limit|resource.?exhausted|usage limit|\b429\b|weekly/iu;

/** The agy argument list for one packet; the prompt arrives on stdin. */
export function antigravityPrintArguments({ model, outputSchema }) {
  const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--sandbox"];
  if (model && model !== "default") args.push("--model", model);
  if (outputSchema !== undefined) {
    if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) throw new TypeError("Antigravity print JSON schema must be an object");
    args.push("--json-schema", JSON.stringify(outputSchema));
  }
  // An empty attached print prompt: the turn comes from the stream-json input.
  args.push("-p=");
  return args;
}

/**
 * Run one chat packet ({model, messages, params?: {outputSchema?}}) through agy.
 * @param {{executable?: string, env?: object, timeoutMs?: number}} [options]
 */
export async function runAntigravityPrintExchange(packet, { executable = process.env.ANTIGRAVITY_BIN ?? "agy", env = process.env, timeoutMs = null, signal } = {}) {
  const record = exchangeRecorder(packet, "antigravity-cli-invocations");
  const binary = resolveExecutable(executable, env);
  if (!binary) return record.refusal(`the \`${executable}\` binary was not found; no subprocess was spawned`, ["antigravity-binary-absent"], 0);
  const outputSchema = packet.params?.outputSchema;
  const { system, prompt } = promptOfMessages(packet.messages);
  const input = `${JSON.stringify({ event: "user", message: { role: "user", content: [{ type: "text", text: [...system, prompt].join("\n\n") }] } })}\n`;
  let result;
  const onStdoutLine = (line) => {
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.event === "result") result = event.result;
  };
  const cwd = await mkdtemp(join(tmpdir(), "antigravity-print-"));
  try {
    const childEnv = Object.fromEntries(CHILD_ENVIRONMENT.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
    const run = await runBounded(binary, antigravityPrintArguments({ model: packet.model, outputSchema }), { input, env: childEnv, cwd, timeoutMs, signal, onStdoutLine });
    if (run.cancelled) return record.refusal("receiver cancelled the command exchange", ["receiver-cancelled"]);
    const detail = redactDiagnostic(result?.error || run.stderr, env);
    if (run.error) return record.refusal(`the agy subprocess could not run: ${run.error.message}`, ["subprocess-spawn-error"], 0);
    if (run.timedOut) return record.refusal(`the agy subprocess exceeded ${timeoutMs}ms${detail ? `: ${detail}` : ""}`, ["subprocess-timeout"]);
    if (result === undefined) return record.refusal(`the agy subprocess exited ${run.status ?? run.signal} without a result${detail ? `: ${detail}` : ""}`, [`subprocess-exit:${run.status ?? run.signal}`]);
    if (result.status !== "SUCCESS") return record.refusal(`the agy turn ended ${result.status}${detail ? `: ${detail}` : ""}`, [QUOTA_REFUSAL.test(detail) ? "antigravity-weekly-compute-exhausted" : "antigravity-turn-failed"]);
    if (outputSchema !== undefined && (typeof result.structured_output !== "object" || result.structured_output === null || Array.isArray(result.structured_output))) {
      return record.refusal("the agy turn completed without the validated structured_output the packet requires", ["missing-validated-structured-output"]);
    }
    const text = outputSchema !== undefined ? JSON.stringify(result.structured_output) : String(result.response ?? "").trim();
    if (!text) return record.refusal("the agy turn carried no response text", ["missing-completion-content"]);
    const { conversation_id: conversation, usage, duration_seconds: seconds, num_turns: turns } = result;
    return record.completion({ model: packet.model ?? "default", text, finishReason: "stop", raw: { conversation, usage, seconds, turns }, usagePrefix: "antigravity" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
