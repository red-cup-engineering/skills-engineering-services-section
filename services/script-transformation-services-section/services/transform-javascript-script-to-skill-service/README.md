# Transform JavaScript Script to Skill Service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

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


## Source-witnessed skill repertoire pages (candidate discovery)

`deriveScriptSkillPage(entries, {query, after, limit})` consumes **original source-enumerated, unique, lexicographically ordered** Engineering JavaScript file observations and returns bounded candidate pages. Each record needs `repository` (the real Red Cup owner), `path`, an exact 40-character Git commit, the complete script `source` and matching raw UTF-8 `sha256`. It reuses `transformJavascriptScriptToSkill` and rejects absent leading JSDoc, unknown declaration tags, source hash mismatches, and unnamed script descriptions. `nextAfter` paginates by original repository/path, never by an ephemeral array index.

The reader **scans its supplied source stream**, but emits only the requested page (1–100 candidates). This bounds returned records and downstream harness context, not the cost of rescanning the iterable or verifying Git membership. A caller at hundred-thousand scale should use its original source-index/changed-file cursor and bounded repository selection, not load a million full scripts into a model. The owner must independently prove the enumerated files belong to the stated Git commits before admission; `gitMembershipVerified:false` is deliberate. A byte-identical JSDoc header does not establish installed runtime, correct operation semantics, a trusted author, Coesite procedural adoption, Actor authority, or a customer-paid outcome. Every returned candidate declares all four as false.

The receiving operator is the original [Coesite Operations agency repertoire](https://github.com/coesite-operations/operations-services-section) and actual AOE Agency reader, then the existing [skill-to-path projector](https://github.com/red-cup-engineering/project-skill-to-path-service) **only for selected, separately admitted skills**. Claude/Codex harnesses and MetroPlat continue to resolve real source-owned Office, Duty, Skill, Character/Incumbency and grants. This function adds no alternate skill registry or deployment side channel. The downstream Coesite `cultivate-operational-repertoire` practice is the intended operating consumer; first verify its exact source and release before claiming adoption.

The `test/script-skill-page.test.mjs` suite generates 100,000 source observations *in an iterator*, checks stable 12-item paging and candidate bounds and refuses hostile/invalid source. The fixture count demonstrates selected-output boundedness, **not** 100,000 actual qualified skills, O(1) lookup or an installed host benchmark.
