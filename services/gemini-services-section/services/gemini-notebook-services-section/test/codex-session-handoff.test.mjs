import assert from "node:assert/strict";
import test from "node:test";
import { renderCodexSessionHandoff } from "../src/codex-session-handoff.mjs";
test("keeps a complete handoff under a fixed context budget", () => {
  const handoff = renderCodexSessionHandoff({ demand: "Reduce repeat context cost.", corrections: "Do not build competing harnesses.", changedPaths: ["src/context.mjs"], verification: "node --test", nextAction: "Run retrieval before reasoning." });
  assert.match(handoff, /Reduce repeat context cost/); assert.match(handoff, /src\/context\.mjs/); assert.ok(Buffer.byteLength(handoff) < 12 * 1024);
});
