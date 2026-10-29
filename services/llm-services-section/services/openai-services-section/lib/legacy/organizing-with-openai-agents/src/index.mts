/**
 * @emsenn/organizing-with-openai-agents — computing with OpenAI-dialect agents.
 *
 * The codex/claude agent capabilities, realized for ANY OpenAI-compatible
 * endpoint — the built-in openai / nvidia / groq / cerebras clouds or a custom
 * EndpointSpec:
 *
 *   endpoints — resolve an endpoint ref and project key presence (redacted)
 *   inference — bind an OpenaiAgentInfer to any endpoint (generalizes codexInfer)
 *   topology  — the openai-agent as a settled meme carrier (embodies / runs / via
 *               endpoint), generalized off codex-topology's GPT-5 pinning
 *   run       — the agentic chat-run driver, run-trace projection (findings/cost),
 *               and the cross-agent handoff primitive
 *   pulse     — the message-triggered step: chat → log → derive state → judge →
 *               (inward + aperiodic) dream, for continuous learning
 *   session   — the six-capability coding-agent session computer
 *               (capsule/finding/impact/recall/endpoints/chat)
 *
 * Generalized out of @emsenn/computing-with-openai-codex so each computer mounts
 * into the same relational substrate and can interoperate, talk, and hand off.
 * Strictly upstream of the 561 Group Operations Manifold: the manifold consumes
 * this library; this library never imports or assumes it.
 */
export * from "./endpoints.mjs";
export * from "./inference.mjs";
export * from "./topology.mjs";
export * from "./run.mjs";
export * from "./pulse.mjs";
export * from "./memory.mjs";
export * as session from "./session/index.mjs";
