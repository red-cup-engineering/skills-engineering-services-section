import { readFileSync } from "node:fs";
import { createSchema } from "@red-cup-engineering/json-schema-services-section";
import { validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section/validate-schema-instance";

function schema(name) {
  return createSchema(JSON.parse(readFileSync(new URL(`../../content/context/schemas/${name}.schema.json`, import.meta.url), "utf8"))).schema;
}

export const CONTEXT_PACKET_REQUEST_SCHEMA = schema("request");
export const CONTEXT_PACKET_RESULT_SCHEMA = schema("result");
export const CONTEXT_PACKET_REFUSAL_SCHEMA = schema("refusal");

export const CONTEXT_PACKET_EAVT = Object.freeze({
  entity: "$.id",
  attributes: Object.freeze({
    "$.profile": "urn:attribute:context-packet:profile",
    "$.objective": "urn:attribute:context-packet:objective",
    "$.createdBy": "urn:attribute:context-packet:created-by",
    "$.segments[*].ni": "urn:attribute:context-packet:segment",
    "$.knowledge[*].relation": "urn:attribute:context-packet:knowledge-relation",
  }),
  derived: true,
});

function admit(value, schemaValue, label) {
  const result = validateSchemaInstance({ instance: value, schema: schemaValue });
  if (!result.ok) throw new TypeError(`${label} failed schema validation: ${JSON.stringify(result.errors)}`);
  return value;
}

export const admitContextPacketRequest = (value) => admit(value, CONTEXT_PACKET_REQUEST_SCHEMA, "context packet request");
export const admitContextPacketResult = (value) => admit(value, CONTEXT_PACKET_RESULT_SCHEMA, "context packet result");
export const admitContextPacketRefusal = (value) => admit(value, CONTEXT_PACKET_REFUSAL_SCHEMA, "context packet refusal");
