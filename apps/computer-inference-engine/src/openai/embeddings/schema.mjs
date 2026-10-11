/**
 * integrations/openai/embeddings/schema — JSON schemas for the
 * literal `/embeddings` wire shapes.
 */

import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";

const stringSequenceSchema = { type: "array", items: { type: "string" } };
const integerSequenceSchema = { type: "array", items: { type: "integer" } };
const integerSequenceSequenceSchema = { type: "array", items: integerSequenceSchema };

export const openaiEmbeddingsRequestSchema = {
  $id: "metroplat/codecs/text/json/openai/embeddings/request",
  title: "OpenAIEmbeddingsWireRequest",
  description: "The literal `/embeddings` request body: one input shape (text, texts, tokens, or token batches) against a model.",
  type: "object",
  required: ["model", "input"],
  properties: {
    model: { type: "string", minLength: 1 },
    input: { anyOf: [{ type: "string" }, stringSequenceSchema, integerSequenceSchema, integerSequenceSequenceSchema] },
    encoding_format: { enum: ["float", "base64"] },
    dimensions: { type: "integer", minimum: 1 },
    user: { type: "string" },
  },
  additionalProperties: true,
};

export const openaiEmbeddingSchema = {
  $id: "metroplat/codecs/text/json/openai/embeddings/embedding",
  title: "OpenAIEmbeddingWire",
  description: "One embedding vector result at its input index.",
  type: "object",
  required: ["object", "index", "embedding"],
  properties: {
    object: { const: "embedding" },
    index: { type: "integer", minimum: 0 },
    embedding: { type: "array", items: { type: "number" } },
  },
  additionalProperties: true,
};

export const openaiEmbeddingsResponseSchema = {
  $id: "metroplat/codecs/text/json/openai/embeddings/response",
  title: "OpenAIEmbeddingsWireResponse",
  description: "The literal `/embeddings` response body: a list of embedding results plus usage.",
  type: "object",
  required: ["object", "data", "model"],
  properties: {
    object: { const: "list" },
    data: { type: "array", items: openaiEmbeddingSchema },
    model: { type: "string", minLength: 1 },
    usage: {
      type: "object",
      required: ["prompt_tokens", "total_tokens"],
      properties: {
        prompt_tokens: { type: "integer", minimum: 0 },
        total_tokens: { type: "integer", minimum: 0 },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export const openaiEmbeddingsRequestContract = schemaFrom(openaiEmbeddingsRequestSchema);
export const openaiEmbeddingContract = schemaFrom(openaiEmbeddingSchema);
export const openaiEmbeddingsResponseContract = schemaFrom(openaiEmbeddingsResponseSchema);
