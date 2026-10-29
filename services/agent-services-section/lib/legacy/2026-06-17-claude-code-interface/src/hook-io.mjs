// src/hook-io.mjs -- shared IO for the Claude Code hook scripts. Hooks receive a JSON payload
// on stdin and may emit a JSON object on stdout. Everything here is fail-open: a hook must
// never block the user's prompt or the session Stop, so reading is defensive and emission is
// best-effort. A failed hook should exit 0 having done nothing.

export async function readPayload() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Emit additional context for SessionStart / UserPromptSubmit hooks in Claude Code's shape.
export function emitContext(hookEventName, additionalContext) {
  if (!additionalContext || !additionalContext.trim()) return;
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`,
  );
}

// Run a hook body fail-open: any throw is swallowed so the exit code stays 0.
export async function runHook(body) {
  try {
    const payload = await readPayload();
    await body(payload);
  } catch {
    // fail open: never block the session
  }
  process.exitCode = 0;
}
