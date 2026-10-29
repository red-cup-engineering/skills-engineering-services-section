#!/usr/bin/env node
// Stop hook -- the session is ending. Capture the final assistant reply from the transcript,
// then consolidate the whole captured session into durable governed SWARM memory the way a
// native `swarm message` turn is processed (record + learn + dream + player tuple). This is
// the ONLY hook that posts durable memory. Fail-open: consolidation never throws, and any
// other error is swallowed so Stop is never blocked.

import { runHook } from "../src/hook-io.mjs";
import { resolveSession } from "../src/config.mjs";
import { captureAssistantReply, readLastAssistantText } from "../src/capture.mjs";
import { consolidateSession } from "../src/consolidate.mjs";

runHook(async (payload) => {
  const session = resolveSession(payload, {});
  const reply = readLastAssistantText(payload.transcript_path);
  if (reply) captureAssistantReply(session.root, session, reply);
  consolidateSession(session.root, session);
});
