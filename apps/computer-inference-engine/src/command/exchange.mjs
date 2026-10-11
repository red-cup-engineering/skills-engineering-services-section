/**
 * Shared parts of the command-line agent providers (Claude Code print mode,
 * Codex exec, Antigravity print mode): locating the executable, running one bounded child process with
 * the prompt on stdin, and settling the same exchange records the HTTP
 * providers settle: exactly one completion or refusal.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { generateExchangeId, tokenUsage } from "../openai/openai-compatible-chat-completion.mjs";

/**
 * Whether a provider descriptor is reached through a local command-line agent
 * (its endpoint is `command:<transport>`) rather than a network endpoint. Such
 * a provider spends a subscription's quota, never a zero-cash allowance.
 */
export function isCommandEndpoint(descriptor) {
  return typeof descriptor?.endpoint === "string" && descriptor.endpoint.startsWith("command:");
}

/** Resolve an executable by path or on PATH (then ~/.local/bin); undefined when absent. */
export function resolveExecutable(name, env = process.env) {
  if (name.includes("/")) return existsSync(name) ? name : undefined;
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  const userLocal = join(homedir(), ".local", "bin", name);
  return existsSync(userLocal) ? userLocal : undefined;
}

/** Split chat messages into system text and one prompt; a single user turn passes verbatim. */
export function promptOfMessages(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");
  const prompt = turns.length === 1 && turns[0].role === "user"
    ? turns[0].content
    : turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return { system, prompt };
}

/** A record builder bound to one exchange: refusal(grounds, unmet, fuel) and completion(fields). */
export function exchangeRecorder(packet, denomination) {
  const id = generateExchangeId(), startedAt = performance.now();
  const cost = (fuel) => ({ "fuel-consumed": fuel, "wall-time-seconds": (performance.now() - startedAt) / 1000, denomination });
  return {
    refusal: (grounds, unmet, fuel = 1) => ({ id, recordedAt: new Date().toISOString(), packet, outcome: "refusal", refusal: { grounds, unmet }, cost: cost(fuel) }),
    completion: ({ model, text, finishReason = "unknown", raw, usagePrefix }) => {
      const usage = usagePrefix ? tokenUsage({ usage: raw?.usage && { prompt_tokens: raw.usage.input_tokens, completion_tokens: raw.usage.output_tokens } }, usagePrefix) : undefined;
      return { id, recordedAt: new Date().toISOString(), packet, outcome: "completion", completion: { model, text, "finish-reason": finishReason, raw }, cost: cost(1), ...(usage ? { usage } : {}) };
    },
  };
}

/**
 * Run one child process with `input` on stdin, bounded by time and output size.
 * Resolves { status, signal, stdout, stderr, error, timedOut }; never rejects.
 */
export function runBounded(executable, args, { input = "", env = process.env, cwd, timeoutMs = null, maxOutput = 16 * 1024 * 1024, onStdoutLine, signal } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve({ status: null, signal: "SIGKILL", stdout: "", stderr: "", cancelled: true, timedOut: false }); return; }
    let stdout = "", stderr = "", size = 0, pending = "", timedOut = false, settled = false;
    const abort = () => child.kill("SIGKILL");
    const finish = (value) => { if (!settled) { settled = true; signal?.removeEventListener("abort", abort); resolve({ ...value, cancelled: signal?.aborted === true }); } };
    const child = spawn(executable, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = timeoutMs === null || timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const take = (chunk, into) => {
      size += chunk.length;
      if (size > maxOutput) { child.kill("SIGKILL"); return; }
      if (into === "out") {
        stdout += chunk;
        if (onStdoutLine) { pending += chunk; let end; while ((end = pending.indexOf("\n")) !== -1) { onStdoutLine(pending.slice(0, end)); pending = pending.slice(end + 1); } }
      } else stderr = (stderr + chunk).slice(-16_384);
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => take(c, "out"));
    child.stderr.on("data", (c) => take(c, "err"));
    child.stdin.on("error", () => {});
    child.on("error", (error) => { clearTimeout(timer); finish({ status: null, signal: null, stdout, stderr, error, timedOut }); });
    child.on("close", (status, signal) => { clearTimeout(timer); if (pending && onStdoutLine) onStdoutLine(pending); finish({ status, signal, stdout, stderr, error: undefined, timedOut }); });
    child.stdin.end(input);
  });
}
