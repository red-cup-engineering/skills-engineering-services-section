/**
 * integrations/openai/models/schema — JSON schemas for the
 * literal `/models` and `/models/{id}` wire shapes.
 */

import { schemaFrom } from "@red-cup-engineering/json-schema-services-section/contracts";

export const openaiModelWireSchema = {
  $id: "metroplat/codecs/text/json/openai/models/model",
  title: "OpenAIModelWire",
  description: "One model listing: its id, creation time, and owning organization.",
  type: "object",
  required: ["id", "object", "created", "owned_by"],
  properties: {
    id: { type: "string", minLength: 1 },
    object: { const: "model" },
    created: { type: "integer", minimum: 0 },
    owned_by: { type: "string", minLength: 1 },
  },
  additionalProperties: true,
};

export const openaiModelsListResponseSchema = {
  $id: "metroplat/codecs/text/json/openai/models/list-response",
  title: "OpenAIModelsListWireResponse",
  description: "The literal `/models` response body: a list of model listings.",
  type: "object",
  required: ["object", "data"],
  properties: {
    object: { const: "list" },
    data: { type: "array", items: openaiModelWireSchema },
  },
  additionalProperties: true,
};

export const openaiModelWireContract = schemaFrom(openaiModelWireSchema);
export const openaiModelsListResponseContract = schemaFrom(openaiModelsListResponseSchema);
