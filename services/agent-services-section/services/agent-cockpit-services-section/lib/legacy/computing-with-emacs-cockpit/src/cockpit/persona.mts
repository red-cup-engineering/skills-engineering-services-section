/**
 * cockpit/persona — a session's individual character.
 *
 * Each cockpit session is given its *own* persona so concurrent sessions of the
 * same agent are not lumped together as one "claude": each gets a distinct name,
 * colour, and glyph that the realizer paints into the chat pane's header and that
 * the launched process carries as identity env.  The assignment is deterministic
 * in the session id (a stable hash), so a session always wears the same face, and
 * the pool is data — a config may supply its own `personas`.
 */

/** A session's visible character. */
export interface Persona {
  /** the character's name (used in buffer names and headers). */
  readonly name: string;
  /** a hex colour the realizer tints the chat header with. */
  readonly color: string;
  /** a short glyph shown beside the name. */
  readonly glyph: string;
  /** an optional one-line character bio woven into the embodiment prompt. */
  readonly bio?: string;
}

/** The built-in persona pool, used when a config supplies none. */
export const DEFAULT_PERSONAS: readonly Persona[] = Object.freeze([
  { name: "Marsh", color: "#1f9c8a", glyph: "◆" },
  { name: "Vex", color: "#b5179e", glyph: "✦" },
  { name: "Cinder", color: "#e8590c", glyph: "▲" },
  { name: "Wren", color: "#2f9e44", glyph: "❧" },
  { name: "Slate", color: "#1c7ed6", glyph: "■" },
  { name: "Juno", color: "#c2920a", glyph: "★" },
  { name: "Onyx", color: "#7048e8", glyph: "⬢" },
  { name: "Fenn", color: "#e03131", glyph: "❂" },
  { name: "Hale", color: "#0c8599", glyph: "◈" },
  { name: "Pike", color: "#5c940d", glyph: "✸" },
]);

/** A stable 32-bit FNV-1a hash of a string (no platform randomness). */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A buffer/path-safe slug for a persona name. */
export function personaSlug(persona: Persona): string {
  return persona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Deterministically assign a persona to SESSIONID from POOL (default pool). */
export function assignPersona(sessionId: string, pool: readonly Persona[] = DEFAULT_PERSONAS): Persona {
  if (pool.length === 0) throw new RangeError("assignPersona: persona pool is empty");
  const persona = pool[hashString(sessionId) % pool.length];
  if (persona === undefined) throw new RangeError("assignPersona: pool index out of range");
  return persona;
}

/** Resolve a persona by name from POOL, or synthesize one (deterministic colour). */
export function personaByName(name: string, pool: readonly Persona[] = DEFAULT_PERSONAS): Persona {
  const match = pool.find((persona) => persona.name.toLowerCase() === name.toLowerCase());
  if (match !== undefined) return match;
  // Synthesize a stable face for a named-but-unpooled persona.
  const base = DEFAULT_PERSONAS[hashString(name) % DEFAULT_PERSONAS.length];
  return { name, color: base?.color ?? "#1c7ed6", glyph: base?.glyph ?? "◆" };
}
