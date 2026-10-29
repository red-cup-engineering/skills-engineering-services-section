#!/usr/bin/env node
// SessionStart hook -- project a context spacesuit from SWARM memory for the configured office
// and inject it as additional context. READ-ONLY: this writes nothing durable ("context
// presence is not learning"). Fail-open: a missing .swarm or office just yields no context.

import { runHook, emitContext } from "../src/hook-io.mjs";
import { resolveSession } from "../src/config.mjs";
import { projectSpacesuit } from "../src/spacesuit.mjs";

runHook(async (payload) => {
  const session = resolveSession(payload, {});
  const suit = projectSpacesuit(session.root, session.agent, "");
  emitContext("SessionStart", suit.additionalContext);
});
