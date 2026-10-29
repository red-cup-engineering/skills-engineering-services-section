#!/usr/bin/env node
// PostToolUse hook -- capture a tool-call envelope (tool name + bounded input view) as an
// experience row in the session capture stream. No context is injected. Capturing only; the
// durable write happens at Stop. Fail-open.

import { runHook } from "../src/hook-io.mjs";
import { resolveSession } from "../src/config.mjs";
import { captureToolCall } from "../src/capture.mjs";

runHook(async (payload) => {
  const session = resolveSession(payload, {});
  captureToolCall(session.root, session, payload);
});
