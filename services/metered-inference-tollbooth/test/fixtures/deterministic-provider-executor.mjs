import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

try {
  const message = JSON.parse(readFileSync(0, "utf8"));
  const part = (message.parts ?? []).find((value) => value?.mediaType === "application/rmn+cbor" && typeof value.raw === "string");
  if (!part) throw new Error("deterministic provider requires one RMN CBOR part");
  process.stdout.write(`${JSON.stringify({
    messageId: randomUUID(), role: "ROLE_AGENT",
    parts: [part, { text: "ready", metadata: { disposition: "completion" }, mediaType: "text/plain" }],
    metadata: { disposition: "completion", providerExecution: "deterministic-test-fixture" }
  })}\n`);
} catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
