import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5_000;
  while (!predicate() && Date.now() < deadline) await wait(20);
  assert.equal(predicate(), true, message);
}

test("client disconnect terminates the exact spawned native Claude child without orphaning it", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-relay-cancel-"));
  const marker = join(root, "native.pid"), fakeClaude = join(root, "fake-claude");
  const port = await freePort();
  writeFileSync(fakeClaude, `#!/bin/sh\necho $$ > ${JSON.stringify(marker)}\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n`);
  chmodSync(fakeClaude, 0o755);
  const relay = spawn(process.execPath, [new URL("../src/serve-private-claude-relay.mjs", import.meta.url).pathname], {
    env: { ...process.env, CLAUDE_RELAY_HOST: "127.0.0.1", CLAUDE_RELAY_PORT: String(port), CLAUDE_RELAY_CLAUDE_BIN: fakeClaude },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitFor(() => relay.stdout.readableLength > 0, "relay must become ready");
    relay.stdout.resume();
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/invoke`, {
      method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        args: ["-p", "--model", "claude-sonnet-4-6", "--output-format", "text", "--tools", "", "--strict-mcp-config", "--setting-sources", ""],
        input: "bounded cancellation assay",
      }),
    });
    await pending;
    await waitFor(() => existsSync(marker), "native child must have started");
    const pid = Number(readFileSync(marker, "utf8").trim());
    controller.abort();
    await waitFor(() => {
      try { process.kill(pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
    }, "native child must not survive the disconnected request");
  } finally {
    relay.kill("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  }
});
