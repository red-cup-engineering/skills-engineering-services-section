#!/usr/bin/env node
// UserPromptSubmit hook -- capture the user's prompt as an experience row in this session's
// capture stream, then inject a prompt-focused context spacesuit. Capturing is admitting
// experience (articulate), NOT durable learning; the durable, governed memory write happens
// only at Stop (consolidate). Fail-open throughout.

import { runHook, emitContext } from "../src/hook-io.mjs";
import { resolveSession } from "../src/config.mjs";
import { captureUserPrompt } from "../src/capture.mjs";
import { projectSpacesuit } from "../src/spacesuit.mjs";

runHook(async (payload) => {
  const session = resolveSession(payload, {});
  captureUserPrompt(session.root, session, payload);
  const suit = projectSpacesuit(session.root, session.agent, payload.prompt ?? "");
  emitContext("UserPromptSubmit", suit.additionalContext);
});
