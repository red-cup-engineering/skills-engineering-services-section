/**
 * cockpit/cockpit-plan — the resolved window layout, ready for any realizer.
 *
 * A cockpit plan is the read-model of a cockpit: one chat pane plus an ordered
 * set of monitor panes, each fully resolved (commands, cwd, tail paths). It is
 * the contract between this library and a realizer — the Emacs elisp consumer
 * builds windows straight from it, but a web or tmux realizer could too. When a
 * session is bound, the plan also carries its persona so the realizer can paint
 * each session as its own character.
 */
import type { Persona } from "./persona.mjs";
import type { CockpitSession } from "./session.mjs";

/** A single pane in the resolved plan. */
export interface CockpitPane {
  /** stable id within the plan. */
  readonly id: string;
  /** chat = the live agent; monitor = a watched stream. */
  readonly role: "chat" | "monitor";
  /** label shown on the pane. */
  readonly label: string;
  /** suggested buffer/window name for the realizer. */
  readonly buffer: string;
  /** the agent or stream kind that produced this pane. */
  readonly kind: string;
  /** chat pane: the program to run. */
  readonly command?: string;
  /** chat pane: the program's arguments. */
  readonly args?: readonly string[];
  /** chat pane working directory (absolute, resolved). */
  readonly cwd?: string;
  /** monitor pane: an absolute file path to tail. */
  readonly path?: string;
  /** monitor pane: a command to stream. */
  readonly streamCommand?: string;
  /** monitor pane: inline content to render (e.g. the session's world card). */
  readonly content?: string;
  /** chat pane: identity/environment variables to export to the process. */
  readonly env?: Record<string, string>;
  /** chat pane: the session's persona, for header tinting. */
  readonly persona?: Persona;
}

/**
 * The per-character data/memory home the realizer must materialize before launch.
 *
 * `home` is the directory the agent's `homeEnv` points at (e.g. CLAUDE_CONFIG_DIR);
 * `memoryFile`/`memorySeed` is the character's own memory, seeded once and never
 * clobbered, so it accumulates across that character's sessions while importing
 * the shared deeper memory.
 */
export interface CharacterProvision {
  /** the per-character home directory to ensure exists. */
  readonly home: string;
  /** the env var that points the agent at `home`. */
  readonly homeEnv: string;
  /** the character's own memory file (absolute). */
  readonly memoryFile: string;
  /** the seed content written only when `memoryFile` does not yet exist. */
  readonly memorySeed: string;
  /** shared memory files (absolute) the realizer ensures exist (seeded empty). */
  readonly sharedMemory: readonly string[];
}

/** A resolved cockpit: a chat pane and its monitor panes. */
export interface CockpitPlan {
  readonly kind: "computing-with-emacs.cockpit-plan";
  /** the chosen agent's id. */
  readonly agentId: string;
  /** the chosen agent's label. */
  readonly label: string;
  /** the cockpit's working directory (absolute). */
  readonly cwd: string;
  /** the bound session, when this cockpit is session-scoped. */
  readonly session?: CockpitSession;
  /** the per-character home/memory to materialize, when the agent embodies characters. */
  readonly character?: CharacterProvision;
  /** the live chat pane. */
  readonly chat: CockpitPane;
  /** the monitor panes, in declared order. */
  readonly monitors: readonly CockpitPane[];
}
