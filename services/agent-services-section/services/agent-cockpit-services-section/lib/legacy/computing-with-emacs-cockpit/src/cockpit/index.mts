/**
 * cockpit — the Emacs cockpit topology as data.
 *
 * Agent endpoints (the chat pane), stream sources (the monitor panes), the config
 * that binds them to an environment, and the pure morphisms that resolve a chosen
 * agent into a window plan or an Emacs launch invocation.
 */
export { isAgentEndpoint, type AgentEndpoint, type AgentKind, type AgentIdentity } from "./agent-endpoint.mjs";
export { isStreamSource, type StreamSource, type StreamKind } from "./stream-source.mjs";
export {
  asCockpitConfig,
  defaultAgent,
  agentById,
  streamsFor,
  type CockpitConfig,
} from "./cockpit-config.mjs";
export {
  DEFAULT_PERSONAS,
  assignPersona,
  personaByName,
  personaSlug,
  hashString,
  type Persona,
} from "./persona.mjs";
export {
  shortSessionId,
  sessionEnv,
  type CockpitSession,
} from "./session.mjs";
export { type CockpitPane, type CockpitPlan, type CharacterProvision } from "./cockpit-plan.mjs";
export {
  resolveCockpit,
  personaCard,
  buildEmbodiment,
  emacsInvocation,
  type ResolveRequest,
  type EmacsInvocationRequest,
} from "./resolve.mjs";
