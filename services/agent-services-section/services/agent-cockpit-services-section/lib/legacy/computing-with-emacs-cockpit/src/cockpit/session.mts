/**
 * cockpit/session — a single cockpit run as its own world.
 *
 * A cockpit session binds an agent to a persona under a stable id.  It is the
 * unit that makes "each claude its own character": every launch is a new session,
 * its identity carried into the chat process as env so the harness can scope that
 * session's sense of the world to it rather than to a shared "claude".
 */
import type { Persona } from "./persona.mjs";

/** A bound cockpit session. */
export interface CockpitSession {
  /** the stable session id (the world key carried as CWE_SESSION). */
  readonly id: string;
  /** the agent this session drives. */
  readonly agentId: string;
  /** the session's persona — its individual character. */
  readonly persona: Persona;
  /** an ISO start stamp, when known. */
  readonly startedAt?: string;
}

/** A short, display-friendly suffix of a session id (for unique buffer names). */
export function shortSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4) || "0000";
}

/** The identity env a session exports to its chat process. */
export function sessionEnv(session: CockpitSession): Record<string, string> {
  return {
    CWE_SESSION: session.id,
    CWE_PERSONA: session.persona.name,
    CWE_PERSONA_COLOR: session.persona.color,
    CWE_AGENT: session.agentId,
  };
}
