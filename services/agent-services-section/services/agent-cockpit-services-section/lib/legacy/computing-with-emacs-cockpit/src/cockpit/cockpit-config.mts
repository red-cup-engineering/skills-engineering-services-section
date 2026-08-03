/**
 * cockpit/cockpit-config — the parameterized environment binding.
 *
 * This is the one object that carries everything environment-specific: which
 * agents exist, which streams to watch, which agent is default. It is supplied as
 * data (a JSON document) on the dispatcher's stdin; the library holds no 561 paths
 * or commands of its own.
 */
import { isAgentEndpoint, type AgentEndpoint } from "./agent-endpoint.mjs";
import { isStreamSource, type StreamSource } from "./stream-source.mjs";
import type { Persona } from "./persona.mjs";

/** The cockpit's environment binding: agents, streams, and the default agent. */
export interface CockpitConfig {
  /** schema version, for forward migration. */
  readonly version?: number;
  /** the agents offered by the chooser. */
  readonly agents: readonly AgentEndpoint[];
  /** the streams agents may reference by id. */
  readonly streams?: readonly StreamSource[];
  /** the agent pre-selected by the chooser, when set. */
  readonly defaultAgentId?: string;
  /** the persona pool sessions draw their character from (else a built-in pool). */
  readonly personas?: readonly Persona[];
  /** environment variables exported to every chat process. */
  readonly env?: Readonly<Record<string, string>>;
  /** the embodiment system-prompt template; expands {persona} {glyph} {session} {bio} {shared}. */
  readonly embodiment?: string;
  /** paths (relative to cwd) of deeper memory every character imports — shared across characters. */
  readonly sharedMemory?: readonly string[];
}

/** Parse and validate an unknown carrier as a cockpit config (throws on malformed). */
export function asCockpitConfig(value: unknown): CockpitConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("cockpit config: expected a JSON object");
  }
  const record = value as Record<string, unknown>;
  const agents = record["agents"];
  if (!Array.isArray(agents) || !agents.every(isAgentEndpoint)) {
    throw new TypeError("cockpit config: `agents` must be an array of agent endpoints");
  }
  const streams = record["streams"];
  if (streams !== undefined && (!Array.isArray(streams) || !streams.every(isStreamSource))) {
    throw new TypeError("cockpit config: `streams` must be an array of stream sources");
  }
  return value as CockpitConfig;
}

/** Resolve the agent the chooser should pre-select: the default, else the first. */
export function defaultAgent(config: CockpitConfig): AgentEndpoint | undefined {
  if (config.defaultAgentId !== undefined) {
    const match = config.agents.find((agent) => agent.id === config.defaultAgentId);
    if (match !== undefined) return match;
  }
  return config.agents[0];
}

/** Find an agent endpoint by id (throws when absent). */
export function agentById(config: CockpitConfig, agentId: string): AgentEndpoint {
  const match = config.agents.find((agent) => agent.id === agentId);
  if (match === undefined) {
    throw new RangeError(`cockpit config: no agent with id \`${agentId}\` (have: ${config.agents.map((a) => a.id).join(", ")})`);
  }
  return match;
}

/** The streams an agent monitors, in declared order; falls back to all streams. */
export function streamsFor(config: CockpitConfig, agent: AgentEndpoint): readonly StreamSource[] {
  const all = config.streams ?? [];
  if (agent.streamIds === undefined) return all;
  return agent.streamIds
    .map((id) => all.find((stream) => stream.id === id))
    .filter((stream): stream is StreamSource => stream !== undefined);
}
