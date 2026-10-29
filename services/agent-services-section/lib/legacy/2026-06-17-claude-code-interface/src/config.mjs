// src/config.mjs -- resolve, for one Claude Code session: which SWARM root we bind to, and
// which SWARM office this session serves as. The office is a real SWARM agent definition;
// the harness does not invent a parallel identity. Office precedence:
//   options.agent  ->  env SWARM_AGENT  ->  <SWARM_ROOT>/harness.json {"agent": "..."}  ->  "programmer"
//
// Root resolution and office loading are delegated to SWARM (resolveSwarmRoot, loadAgent),
// so the harness stays a thin carrier: SWARM owns what an office is and which exist.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadAgent, resolveSwarmRoot } from "./swarm.mjs";

export const DEFAULT_OFFICE = "programmer";

function readHarnessFile(root) {
  const path = join(root, "harness.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null; // fail open: a malformed harness.json must not break a session
  }
}

// Resolve the office NAME by precedence, without loading it yet.
export function resolveOfficeName(options = {}) {
  const env = options.env ?? process.env;
  const root = resolveSwarmRoot(options);
  if (options.agent) return String(options.agent);
  if (env.SWARM_AGENT) return String(env.SWARM_AGENT);
  const harness = readHarnessFile(root);
  if (harness && typeof harness.agent === "string" && harness.agent) return harness.agent;
  return DEFAULT_OFFICE;
}

// A stable per-session id. Prefer Claude's own session_id from the hook payload; otherwise
// derive a deterministic id from the transcript path / cwd so capture rows for one session
// land in one stream. Date is intentionally NOT used (keeps ids reproducible across hooks).
export function sessionIdFrom(payload = {}, options = {}) {
  if (payload.session_id) return String(payload.session_id);
  const seed = payload.transcript_path ?? options.cwd ?? process.cwd();
  return `session-${createHash("sha256").update(String(seed)).digest("hex").slice(0, 16)}`;
}

// The full resolved session config: swarm root + the loaded office agent + session id.
// loadAgent throws a helpful error (listing available offices) for an unknown office.
export function resolveSession(payload = {}, options = {}) {
  const root = resolveSwarmRoot(options);
  const officeName = resolveOfficeName(options);
  const agent = loadAgent(officeName, { ...options, root });
  return {
    root,
    office: officeName,
    agent,
    sessionId: sessionIdFrom(payload, options),
  };
}
