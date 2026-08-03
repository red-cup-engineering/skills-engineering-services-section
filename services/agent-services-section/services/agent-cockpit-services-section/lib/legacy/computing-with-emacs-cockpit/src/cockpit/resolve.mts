/**
 * cockpit/resolve — the pure morphisms from config to plan, and to an Emacs call.
 *
 * `resolveCockpit` is the heart of the package: a cockpit config plus a request
 * (a chosen agent, a cwd, optionally a bound session) becomes a fully-resolved
 * `CockpitPlan`. When a session is bound, the chat pane is namespaced and tinted
 * by the session's persona, carries the session's identity env, and a leading
 * "world" pane holds the persona card. When the agent declares an `identity`, the
 * session is embodied as a discrete, persistent character using the agent's own
 * upstream capabilities — Claude Code's `--session-id`, `--name`,
 * `--append-system-prompt`, and a per-character `CLAUDE_CONFIG_DIR` whose memory
 * imports the shared deeper memory — so each session is its own self with its own
 * data while still sharing memory with its siblings. `emacsInvocation` computes
 * the argv that launches an Emacs against an init dir.
 */
import { isAbsolute, resolve as resolvePath } from "node:path";
import {
  agentById,
  defaultAgent,
  streamsFor,
  type CockpitConfig,
} from "./cockpit-config.mjs";
import type { AgentEndpoint } from "./agent-endpoint.mjs";
import type { CharacterProvision, CockpitPane, CockpitPlan } from "./cockpit-plan.mjs";
import { personaSlug, type Persona } from "./persona.mjs";
import { sessionEnv, shortSessionId, type CockpitSession } from "./session.mjs";

/** Resolve a possibly-relative path against an absolute base. */
function under(base: string, path: string): string {
  return isAbsolute(path) ? path : resolvePath(base, path);
}

/** Expand `{key}` placeholders in a template from VARS (unknown keys are kept). */
function expand(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? `{${key}}`);
}

/** Build the embodiment system-prompt for a character (config template, else default). */
export function buildEmbodiment(config: CockpitConfig, persona: Persona, session: CockpitSession): string {
  const vars: Record<string, string> = {
    persona: persona.name,
    glyph: persona.glyph,
    session: session.id,
    bio: persona.bio ?? "",
  };
  if (config.embodiment !== undefined) return expand(config.embodiment, vars).trim();
  return [
    `You are ${persona.name} (${persona.glyph}), a distinct, persistent Claude character in the 561 Group — not a generic assistant and not interchangeable with the other Claudes.`,
    persona.bio ?? "",
    `You have your own data, memory, and continuity (session ${session.id}); you also share deeper memory and systems with your sibling Claudes. Keep your own voice and continuity across your sessions.`,
  ].filter((part) => part !== "").join(" ");
}

/** Build the seed for a character's own memory file (imports the shared memory). */
function buildMemorySeed(
  persona: Persona,
  session: CockpitSession,
  agent: AgentEndpoint,
  sharedMemory: readonly string[],
): string {
  const lines = [
    `# ${persona.name}`,
    "",
    `I am ${persona.name} (${persona.glyph}), a discrete ${agent.label} character in the 561 Group, with my own data, memory, and continuity. My session id is \`${session.id}\`.`,
  ];
  if (persona.bio !== undefined) lines.push("", persona.bio);
  lines.push(
    "",
    "What I record here is my own memory; it persists across my sessions.",
    "I also share deeper memory with the other Claudes and the general systems, imported below.",
  );
  if (sharedMemory.length > 0) {
    lines.push("", "## Shared memory", "", ...sharedMemory.map((path) => `@${path}`));
  }
  lines.push("");
  return lines.join("\n");
}

/** What embodying a session as a character contributes to the chat pane and plan. */
interface CharacterResolution {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly provision?: CharacterProvision;
}

/** Resolve the upstream-native character embodiment for a session, if the agent declares one. */
function characterResolution(
  config: CockpitConfig,
  agent: AgentEndpoint,
  cwd: string,
  session: CockpitSession,
): CharacterResolution {
  const identity = agent.identity;
  if (identity === undefined) return { args: [], env: {} };
  const persona = session.persona;
  const sharedMemory = (config.sharedMemory ?? []).map((path) => under(cwd, path));
  const embodiment = buildEmbodiment(config, persona, session);
  const vars: Record<string, string> = {
    cwd,
    slug: personaSlug(persona),
    persona: persona.name,
    glyph: persona.glyph,
    session: session.id,
    embodiment,
    home: "",
  };
  const home = identity.homeTemplate === undefined ? undefined : under(cwd, expand(identity.homeTemplate, vars));
  if (home !== undefined) vars["home"] = home;
  const expandArgs = (args?: readonly string[]): string[] => (args ?? []).map((arg) => expand(arg, vars));
  const args = [
    ...expandArgs(identity.sessionArgs),
    ...expandArgs(identity.nameArgs),
    ...expandArgs(identity.embodimentArgs),
  ];
  if (home === undefined || identity.homeEnv === undefined) return { args, env: {} };
  const memoryFile = resolvePath(home, identity.memoryFile ?? "CLAUDE.md");
  return {
    args,
    env: { [identity.homeEnv]: home },
    provision: {
      home,
      homeEnv: identity.homeEnv,
      memoryFile,
      memorySeed: buildMemorySeed(persona, session, agent, sharedMemory),
      sharedMemory,
    },
  };
}

/** The buffer prefix for a chat/monitor pane, namespaced by session when bound. */
function paneStem(agent: AgentEndpoint, session: CockpitSession | undefined): string {
  if (session === undefined) return `cwe-chat:${agent.id}`;
  return `${agent.id}·${personaSlug(session.persona)}·${shortSessionId(session.id)}`;
}

/** Merge the env layers: config-wide, then agent, then session identity, then character home. */
function chatEnv(
  config: CockpitConfig,
  agent: AgentEndpoint,
  session: CockpitSession | undefined,
  character: CharacterResolution,
): Record<string, string> {
  return {
    ...(config.env ?? {}),
    ...(agent.env ?? {}),
    ...(session === undefined ? {} : sessionEnv(session)),
    ...character.env,
  };
}

/** Build the chat pane for AGENT in CWD, bound to SESSION (and CHARACTER) when present. */
function chatPane(
  config: CockpitConfig,
  agent: AgentEndpoint,
  cwd: string,
  session: CockpitSession | undefined,
  character: CharacterResolution,
): CockpitPane {
  const chatCwd = agent.cwd === undefined ? cwd : under(cwd, agent.cwd);
  const stem = paneStem(agent, session);
  const env = chatEnv(config, agent, session, character);
  const args = [...(agent.args ?? []), ...character.args];
  return {
    id: `chat:${session?.id ?? agent.id}`,
    role: "chat",
    label: session === undefined ? agent.label : `${agent.label} · ${session.persona.name}`,
    buffer: `*${stem}*`,
    kind: agent.kind,
    command: agent.command,
    args,
    cwd: chatCwd,
    ...(Object.keys(env).length === 0 ? {} : { env }),
    ...(session === undefined ? {} : { persona: session.persona }),
  };
}

/** The leading "world" pane for a session: its persona card. */
function worldPane(agent: AgentEndpoint, cwd: string, session: CockpitSession): CockpitPane {
  return {
    id: `world:${session.id}`,
    role: "monitor",
    label: `${session.persona.glyph} ${session.persona.name} — world`,
    buffer: `*${paneStem(agent, session)}·world*`,
    kind: "world",
    content: personaCard(session, agent, cwd),
    persona: session.persona,
  };
}

/** Render a session's persona card — its sense of who it is in this world. */
export function personaCard(session: CockpitSession, agent: AgentEndpoint, cwd: string): string {
  const persona = session.persona;
  return [
    `# ${persona.glyph} ${persona.name}`,
    "",
    `A ${agent.label} session embodied as its own character.`,
    "",
    `- persona: \`${persona.name}\``,
    `- glyph: \`${persona.glyph}\``,
    `- colour: \`${persona.color}\``,
    ...(persona.bio === undefined ? [] : [`- bio: ${persona.bio}`]),
    `- agent: \`${agent.id}\` (${agent.label})`,
    `- session: \`${session.id}\``,
    `- cwd: \`${cwd}\``,
    "",
    "## Identity env",
    "",
    ...Object.entries(sessionEnv(session)).map(([key, value]) => `- \`${key}=${value}\``),
    "",
    "This session is not the generic harness; it is itself — its own data and",
    "memory, sharing deeper memory with its sibling characters.",
    "",
  ].join("\n");
}

/** Build the stream monitor panes AGENT watches, resolved against CWD. */
function streamPanes(config: CockpitConfig, agent: AgentEndpoint, cwd: string): readonly CockpitPane[] {
  return streamsFor(config, agent).map((stream): CockpitPane => ({
    id: `monitor:${stream.id}`,
    role: "monitor",
    label: stream.label,
    buffer: `*cwe-monitor:${stream.id}*`,
    kind: stream.kind,
    ...(stream.path === undefined ? {} : { path: under(cwd, stream.path) }),
    ...(stream.command === undefined ? {} : { streamCommand: stream.command }),
  }));
}

/** A request to resolve a cockpit: which agent, where, and (optionally) bound session. */
export interface ResolveRequest {
  /** the chosen agent id; the default agent when omitted. */
  readonly agentId?: string;
  /** the cockpit working directory (absolutized). */
  readonly cwd: string;
  /** the bound session; when set, the cockpit is session-scoped and persona-tinted. */
  readonly session?: CockpitSession;
}

/** Resolve a cockpit config and a request into a complete window plan. */
export function resolveCockpit(config: CockpitConfig, request: ResolveRequest): CockpitPlan {
  const base = isAbsolute(request.cwd) ? request.cwd : resolvePath(request.cwd);
  const session = request.session;
  const agentId = request.agentId ?? session?.agentId;
  const agent = agentId === undefined ? defaultAgent(config) : agentById(config, agentId);
  if (agent === undefined) throw new RangeError("cockpit config: no agents to resolve");
  const character = session === undefined ? { args: [], env: {} } : characterResolution(config, agent, base, session);
  const monitors = [
    ...(session === undefined ? [] : [worldPane(agent, base, session)]),
    ...streamPanes(config, agent, base),
  ];
  return {
    kind: "computing-with-emacs.cockpit-plan",
    agentId: agent.id,
    label: agent.label,
    cwd: base,
    ...(session === undefined ? {} : { session }),
    ...(character.provision === undefined ? {} : { character: character.provision }),
    chat: chatPane(config, agent, base, session, character),
    monitors,
  };
}

/** A request to launch an Emacs as a cockpit host against an init directory. */
export interface EmacsInvocationRequest {
  /** the package init directory (passed as `--init-directory`). */
  readonly initDirectory: string;
  /** the directory Emacs should treat as `default-directory` (passed as `--chdir`). */
  readonly cwd?: string;
  /** elisp forms to evaluate after startup (each passed as `--eval`). */
  readonly eval?: readonly string[];
  /** extra raw arguments appended verbatim. */
  readonly args?: readonly string[];
}

/** Compute the argv (after `emacs`) that launches a package as an Emacs cockpit. */
export function emacsInvocation(request: EmacsInvocationRequest): readonly string[] {
  const evals = (request.eval ?? []).flatMap((form) => ["--eval", form]);
  return [
    "--init-directory",
    request.initDirectory,
    ...(request.cwd === undefined ? [] : ["--chdir", request.cwd]),
    ...evals,
    ...(request.args ?? []),
  ];
}
