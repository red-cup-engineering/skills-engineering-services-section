#!/usr/bin/env node

const endpoint = process.env.CLAUDE_RELAY_URL ?? "http://127.0.0.1:19762/invoke";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
  if (process.env.CLAUDE_RELAY_CLIENT_TIMEOUT_MS !== undefined) throw new Error("CLAUDE_RELAY_CLIENT_TIMEOUT_MS is retired; cancel the durable customer task explicitly");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args: process.argv.slice(2), input: Buffer.concat(chunks).toString("utf8") }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error ?? `relay returned HTTP ${response.status}`);
  if (typeof value.stdout === "string") process.stdout.write(value.stdout);
  if (typeof value.stderr === "string") process.stderr.write(value.stderr);
  if (Number.isInteger(value.status) && value.status !== 0 && !(typeof value.stderr === "string" && value.stderr.trim() !== "")) {
    process.stderr.write(`private Claude relay child exited status ${value.status}${typeof value.signal === "string" && value.signal !== "" ? ` after signal ${value.signal}` : ""}\n`);
  }
  process.exitCode = Number.isInteger(value.status) ? value.status : 70;
} catch (error) {
  process.stderr.write(`private Claude relay unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 75;
}
