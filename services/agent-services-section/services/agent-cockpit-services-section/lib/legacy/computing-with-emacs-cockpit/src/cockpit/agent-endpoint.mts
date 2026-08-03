/**
 * cockpit/agent-endpoint — a chat agent the cockpit can drive in a live pane.
 *
 * An agent endpoint is the data behind the *chat pane*: the external program the
 * cockpit runs in a terminal buffer (a Claude CLI, a Codex CLI, an OpenAI TUI).
 * It names which streams to monitor beside it (`streamIds`), so the chooser and
 * the pane plan are projections of this carrier, not of hard-coded knowledge.
 */

/** Whether the chat program is a line CLI or a full-screen terminal UI. */
export type AgentKind = "cli" | "tui";

/**
 * How an agent embodies a session as a discrete, persistent character, using the
 * agent's own upstream capabilities. Every field is optional and agent-specific —
 * it is the data that maps the generic cockpit session onto, e.g., Claude Code's
 * `--session-id`, `--name`, `--append-system-prompt`, and `CLAUDE_CONFIG_DIR`.
 * Templates expand `{cwd} {persona} {slug} {glyph} {session} {embodiment} {home}`.
 */
export interface AgentIdentity {
  /** argv that pins the upstream session id (e.g. ["--session-id","{session}"]). */
  readonly sessionArgs?: readonly string[];
  /** argv that sets the session's display name (e.g. ["--name","{persona}"]). */
  readonly nameArgs?: readonly string[];
  /** argv that embodies the character (e.g. ["--append-system-prompt","{embodiment}"]). */
  readonly embodimentArgs?: readonly string[];
  /** env var that relocates the per-character data/memory home (e.g. "CLAUDE_CONFIG_DIR"). */
  readonly homeEnv?: string;
  /** template for the per-character home dir (e.g. "{cwd}/var/characters/{slug}"). */
  readonly homeTemplate?: string;
  /** the memory file seeded in the home dir (relative to it; default "CLAUDE.md"). */
  readonly memoryFile?: string;
}

/** A chat agent endpoint: the program run in the cockpit's chat pane. */
export interface AgentEndpoint {
  /** stable id, used by the chooser and `resolve-cockpit --agent`. */
  readonly id: string;
  /** human label shown in the chooser and on the chat pane. */
  readonly label: string;
  /** cli (line) or tui (full-screen) — drives terminal handling. */
  readonly kind: AgentKind;
  /** the executable program (resolved on PATH by the realizer). */
  readonly command: string;
  /** arguments passed to the program. */
  readonly args?: readonly string[];
  /** working directory override; defaults to the cockpit cwd when omitted. */
  readonly cwd?: string;
  /** optional one-line description shown in the chooser. */
  readonly description?: string;
  /** ids of the streams to monitor beside this agent (order = pane order). */
  readonly streamIds?: readonly string[];
  /** environment variables to export to this agent's chat process. */
  readonly env?: Readonly<Record<string, string>>;
  /** how this agent embodies a session as a discrete character (upstream-native). */
  readonly identity?: AgentIdentity;
}

/** Type guard for a plausible agent endpoint carrier. */
export function isAgentEndpoint(value: unknown): value is AgentEndpoint {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["label"] === "string" &&
    typeof record["command"] === "string"
  );
}
