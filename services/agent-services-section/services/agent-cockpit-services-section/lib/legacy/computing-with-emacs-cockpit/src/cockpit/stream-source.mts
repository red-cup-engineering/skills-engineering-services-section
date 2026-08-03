/**
 * cockpit/stream-source — a monitorable stream the cockpit watches beside the chat.
 *
 * A stream source is the data behind one *monitor pane*: the place where a user
 * watches context injections, hook calls, and messages flow past the live chat.
 * It is environment-agnostic — `path`/`command` are resolved against the cockpit
 * `cwd` at realize time, so the 561 paths live in a config, not here.
 */

/** How a stream's rows are produced and what they mean. */
export type StreamKind =
  | "context-injection"
  | "hook-call"
  | "message"
  | "file"
  | "command";

/** A monitorable stream: a file tailed, or a command streamed, into a monitor pane. */
export interface StreamSource {
  /** stable id, referenced by an agent's `streamIds`. */
  readonly id: string;
  /** human label shown on the monitor pane. */
  readonly label: string;
  /** what the stream carries; drives default presentation. */
  readonly kind: StreamKind;
  /** a file to tail, relative to the cockpit cwd (for file-shaped streams). */
  readonly path?: string;
  /** a command to stream, run in the cockpit cwd (for command-shaped streams). */
  readonly command?: string;
  /** optional one-line description of the stream. */
  readonly description?: string;
}

/** Type guard for a plausible stream source carrier. */
export function isStreamSource(value: unknown): value is StreamSource {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record["id"] === "string" && typeof record["label"] === "string" && typeof record["kind"] === "string";
}
