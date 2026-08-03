import assert from "node:assert/strict";
import test from "node:test";
import { validateSkillAgainstSchema } from "../src/validate-skill-against-schema.mjs";

const SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "test/schema/minimal-skill",
  type: "object",
  required: ["type", "name"],
  additionalProperties: false,
  properties: {
    type: { const: "skill" },
    name: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
  },
};

test("reports ok for a conforming record", () => {
  const result = validateSkillAgainstSchema({ type: "skill", name: "making-a-widget" }, SCHEMA);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("reports a violation with pointer, message, and keyword", () => {
  const result = validateSkillAgainstSchema({ type: "skill", name: "Not Kebab Case" }, SCHEMA);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^\/name: .*\(pattern\)$/u);
});

test("reports a missing required property", () => {
  const result = validateSkillAgainstSchema({ type: "skill" }, SCHEMA);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("(required)")));
});

test("reports an additional property the schema forbids", () => {
  const result = validateSkillAgainstSchema({ type: "skill", name: "a-name", extra: true }, SCHEMA);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("(additionalProperties)")));
});
