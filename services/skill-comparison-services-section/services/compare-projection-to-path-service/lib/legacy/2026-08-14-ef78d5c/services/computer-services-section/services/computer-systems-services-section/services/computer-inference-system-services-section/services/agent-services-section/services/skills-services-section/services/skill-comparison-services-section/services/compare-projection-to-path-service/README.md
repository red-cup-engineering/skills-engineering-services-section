# Compare Projection to Path Service

Compares a skill record's would-be projection against what actually sits at a target directory — read-only. This is the read side of `project-skill-to-path-service`'s write side; it plays the role the legacy `project-a-skill.js --check` played, but as a pure, importable function rather than a CLI flag.

## Hoare triple

### `async compareProjectionToPath({ record, body, sourcePath, targetDirectory })`

- **Precondition:** none beyond argument shape — an absent projection is a reportable difference, not a refusal.
- **Input:** `{ record, body, sourcePath, targetDirectory }` — the same shape `projectSkillToPath` takes.
- **Output:** `{ ok, differences }`. `differences` is `[]` when `ok` is true. Each difference is `{ kind, path }`, `kind` one of:
  - `missing-skill-md` — the target directory has no `SKILL.md`.
  - `skill-md-differs` — `SKILL.md` exists but its content differs from what `renderAgentSkillMarkdown` would produce for this record and body.
  - `missing-script` — the target's `scripts/<basename>` does not exist, or the source script named by `sourcePath` no longer does.
  - `script-differs` — the projected script exists but is not byte-identical to `sourcePath`.
- **Postcondition:** no file is created, modified, or deleted by this call, no matter what it finds — this package NEVER writes.

```js
import { compareProjectionToPath } from "@red-cup-engineering/compare-projection-to-path-service";

const { ok, differences } = await compareProjectionToPath({
  record: { type: "skill", name: "making-a-widget", description: "Makes a widget." },
  body: "Free prose about widgets.",
  sourcePath: "lib/professional-repertoire/skills/make-a-widget.js",
  targetDirectory: ".claude/skills",
});
```
