/**
 * @emsenn/organizing-with-llm-agents/codecs — the LLM provider wire codecs. The two providers
 * share verbatim symbol names (encodeRequestBody, decodeResponse, decodeText,
 * decodeUsage, DecodedResponse), so each is its own nested namespace.
 */
export * as anthropic from "./anthropic/index.mjs";
export * as openai from "./openai/index.mjs";
export * as openaiChat from "./openai-chat/index.mjs";
