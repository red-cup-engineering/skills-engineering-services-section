# Validate Skill Against Schema Service

Validates a candidate skill record against a Draft 2020-12 JSON Schema by IMPORTING `@red-cup-engineering/json-schema-services-section` and calling `createSchema` / `validateInstance` directly — never by spawning `node read-a-schema.js` as a subprocess and piping JSON over stdin, which is how the legacy `project-a-skill.js` did it.

## Why this is its own package

`transformJavascriptScriptToSkill` (in the sibling `transform-javascript-script-to-skill-service`) is deliberately pure — no filesystem, no schema. Validation needs a schema, and a schema lives on disk somewhere the caller resolves (a pool walk, a fixed path, a test fixture) — that resolution is not this service's business either. So this service takes the already-parsed schema as an argument and stays exactly as filesystem-free as its sibling; only the top-level orchestration that composes transform → validate → project ever touches disk directly.

## Hoare triple

### `validateSkillAgainstSchema(record, schema)`

- **Precondition:** `schema` is a plain object admissible as a Draft 2020-12 schema — the shape `skill.schema.json` is on disk as, already `JSON.parse`d.
- **Input:** `record` (any JSON-compatible value), `schema`.
- **Output:** `{ ok, errors }` — `errors` is `[]` when `ok` is true, otherwise one human-readable string per violation, each carrying the JSON Pointer it failed at and the keyword that failed.
- **Postcondition:** no exception for an invalid instance — an exception means the schema itself was not admissible (unsupported keyword, missing `$id`), a caller error distinct from an instance failing to validate.

```js
import { readFileSync } from "node:fs";
import { validateSkillAgainstSchema } from "@red-cup-engineering/validate-skill-against-schema-service";

const schema = JSON.parse(readFileSync("lib/schemas/skill.schema.json", "utf8"));
const { ok, errors } = validateSkillAgainstSchema(record, schema);
```
