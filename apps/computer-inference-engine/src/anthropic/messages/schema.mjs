/**
 * Literal Anthropic Messages API wire types (non-streaming core).
 *
 * The real Anthropic Messages request/response boundary (schema, validating
 * contracts, the codec, the streaming client) is owned by the published
 * `@red-cup-engineering/anthropic-inference-team` package (per the
 * 2026-09-05 ruling that a capability found inside MetroPlat is not
 * MetroPlat's to keep) — consumers reach it directly by that import
 * specifier. This file keeps only the zero-runtime-cost TypeScript types
 * MetroPlat's own inference orchestration (`./inference.mts`,
 * `../inference-client.mts`) needs; they compile away and are not
 * duplicated capability.
 */

/** Forward-compatible SSE event; per-event interpretation remains in the pure inference reading. */

