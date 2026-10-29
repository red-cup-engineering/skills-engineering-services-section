/**
 * @emsenn/organizing-with-llm-agents — language-model inference in the computing domain,
 * operationalized as one package with each concern on a module subpath:
 *
 *   - `@emsenn/organizing-with-llm-agents/algebra`    — chat/conversation, endpoints, tools, inference
 *     request/result, exact cost arithmetic with bilattice budget admission.
 *   - `@emsenn/organizing-with-llm-agents/running`   — the agentic loop as lesson evidence (it
 *     projects onto @emsenn/animating/becoming/doing/working/learning/lessons).
 *   - `@emsenn/organizing-with-llm-agents/dreaming`   — aperiodic LLM dreaming over animating
 *     tasks and dream results.
 *   - `@emsenn/organizing-with-llm-agents/holography` — the inference host projected as charge readings.
 *   - `@emsenn/organizing-with-llm-agents/harness`    — LLM-facing agent harness carriers.
 *   - `@emsenn/organizing-with-llm-agents/codecs/anthropic` — the Anthropic Messages wire codec.
 *   - `@emsenn/organizing-with-llm-agents/codecs/openai`    — the OpenAI chat-completions wire codec.
 *   - `@emsenn/organizing-with-llm-agents/codecs/openai-chat` — the OpenAI chat wire as animating loop functor.
 *
 * The root re-exports each module under its own namespace for discoverability;
 * import the subpaths directly for the flat symbol surface of each module. The
 * codecs barrel is re-exported here as the `codecs` namespace (anthropic +
 * openai nested), but is not published as a `./codecs` subpath — the two
 * providers share verbatim symbol names, so import the nested subpaths directly.
 */
export * as algebra from "./algebra/index.mjs";
export * as running from "./running/index.mjs";
export * as dreaming from "./dreaming/index.mjs";
export * as holography from "./holography/index.mjs";
export * as harness from "./harness/index.mjs";
export * as session from "./session/index.mjs";
export * as mount from "./mount/index.mjs";
export * as codecs from "./codecs/index.mjs";
export * as openaiChat from "./codecs/openai-chat/index.mjs";
