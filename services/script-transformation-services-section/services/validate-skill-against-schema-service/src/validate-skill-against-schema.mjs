import { createSchema, schemaCorpus, validateInstance } from "@red-cup-engineering/json-schema-services-section";

/**
 * Validate a candidate skill record against a JSON Schema, by IMPORTING the
 * published Draft 2020-12 evaluator and calling it as a function — never by
 * spawning a subprocess and piping JSON over stdin. `read-a-schema.mjs` in
 * `@red-cup-engineering/json-schema-services-section` composes these same two
 * calls (`createSchema` then `validateInstance`) from its own CLI; this
 * service is that composition, reusable as a library call.
 *
 * Deliberately pure: it takes the already-parsed schema as an argument
 * rather than reading `skill.schema.json` off disk itself, so this
 * script-transformation service stays filesystem-free like its siblings —
 * the caller (who already knows which schema file answers) reads the bytes
 * and hands them in.
 *
 * Precondition: `schema` is a plain object admissible as a Draft 2020-12
 *   schema (the shape `skill.schema.json` is on disk as); `record` is any
 *   JSON-compatible value.
 * Input: `record`, `schema`.
 * Output: `{ ok, errors }` — `errors` is `[]` when `ok` is true, otherwise
 *   one human-readable string per violation, each carrying the JSON Pointer
 *   at which it failed.
 * Postcondition: no exception is thrown for an invalid instance — only for
 *   a schema that is not itself admissible (e.g. an unsupported keyword or a
 *   missing `$id`), which is a caller error, not an instance failing to
 *   validate.
 */
export function validateSkillAgainstSchema(record, schema) {
  const receipt = createSchema(schema, undefined, { allowUnknownAnnotations: true });
  const result = validateInstance(record, receipt.schema, schemaCorpus([receipt.schema]));
  const errors = result.errors.map((violation) => `${violation.pointer || "/"}: ${violation.message} (${violation.keyword})`);
  return { ok: result.ok, errors };
}
