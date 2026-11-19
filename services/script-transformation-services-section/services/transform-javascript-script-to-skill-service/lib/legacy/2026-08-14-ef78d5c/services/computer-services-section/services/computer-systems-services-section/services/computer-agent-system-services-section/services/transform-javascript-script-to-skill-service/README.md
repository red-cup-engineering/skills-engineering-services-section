# Transform JavaScript Script to Skill Service

Reads a JavaScript source file's leading `/** */` declaration header and transforms it into a candidate skill record and body, purely — no filesystem, no child process, no schema. Reads standard JSDoc (`@description`, `@param`, `@returns`, `@throws`), not an invented tag dialect: a script's own `@skill`/`@verb-phrase`/`@closure-kind`/`@precondition`/`@postcondition`/`@witness`/`@fuel`/`@model` header once displaced that vocabulary; this service reads what a JSDoc tool already reads instead, and refuses anything it does not recognize, those retired tags included.

## Hoare triples

### `readDeclarationsFromJavascript(source)`

- **Precondition:** `source` is a string (the full text of a JavaScript file).
- **Input:** `source`.
- **Output:** `{ declarations: [{ tag, value }], prose }`, or `null` when `source` carries no leading `/** */` block comment.
- **Postcondition:** only the FIRST block comment is read, so a stray comment later in the file cannot redeclare the header. A line matching `@tag value` opens a declaration; every following non-blank line continues that declaration's value (joined by a single space), so a long `@description` need not be one unreadable line. `prose` is every non-declaration line, joined by newlines and trimmed.

### `transformJavascriptScriptToSkill(source, filename)`

- **Precondition:** `source` is a JavaScript source string; `filename` is the flat basename the projected script will carry (never a path).
- **Input:** `source`, `filename`.
- **Output:** `{ record, body }` on success, or `{ error }` naming exactly what refused.
- **Postcondition:** `record.name` is always DERIVED from `filename` (its basename with `.js`/`.mjs` stripped) — never read from a declaration, since a script does not get to assert its own name when the name is what the harness already resolves it by on disk. `@description` is the only scalar, mapped straight to `description`. Repeating tags append: `@param` → `params`, `@returns` → `returns`, `@throws` → `throws`, each entry carrying its tag value verbatim (including any `{type}` the header wrote — this service does not parse a type or a name back out of that text). `record.script` is always DERIVED as `scripts/<filename>` — a declared `@script` is refused as an unknown tag, since projection decides where the script lands and a declaration would be a second claim about one fact. An unknown `@tag` is always a hard error, never silently ignored — this includes the retired `@skill`, `@verb-phrase`, `@closure-kind`, `@precondition`, `@postcondition`, `@witness`, `@fuel`, and `@model`, none of which this service maps anymore. `body` is the header's free prose, for a caller to render into a SKILL.md.

## Not responsible for

- Validating the record against `skill.schema.json` — see `@red-cup-engineering/validate-skill-against-schema-service`.
- Writing anything to disk — see `@red-cup-engineering/project-skill-to-path-service`.

```js
import { transformJavascriptScriptToSkill } from "@red-cup-engineering/transform-javascript-script-to-skill-service";

const { record, body, error } = transformJavascriptScriptToSkill(sourceText, "make-a-widget.js");
```
