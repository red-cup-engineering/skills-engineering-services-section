# Project Skill to Path Service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Projects one skill record and its source script into the directory shape the Agent Skills harness reads. The only package among the skills-split services that writes to disk.

## Hoare triple

### `async projectSkillToPath({ record, body, sourcePath, targetDirectory })`

- **Precondition:** `targetDirectory`'s parent exists — projection does not invent a place to put a skill. `sourcePath` names a file that exists. `record.name` and `record.description` are present.
- **Input:** `record` (a skill record, e.g. from `@red-cup-engineering/transform-javascript-script-to-skill-service`), `body` (the prose to become the SKILL.md body), `sourcePath` (the source script's path), `targetDirectory` (the node to project into).
- **Output:** a receipt — `{ ok, name, directory, skillPath, scriptPath }` — naming exactly what was written.
- **Postcondition:** `<targetDirectory>/<record.name>/SKILL.md` exists carrying ONLY `name` and `description` in frontmatter, plus the prose body. `<targetDirectory>/<record.name>/scripts/<basename(sourcePath)>` is byte-identical to `sourcePath`.

## SKILL.md is rendered, never hand-rolled

This service imports `renderAgentSkillMarkdown` from `@red-cup-engineering/skills-services-section` rather than carrying its own YAML quoter. The legacy `project-a-skill.js` hand-rolled a `yamlScalar` function; that duplication is exactly what this split removes.

One consequence is worth stating plainly: the shared renderer routes the body through semantic-linefeed normalization (one sentence per line). The legacy hand-rolled `skillMarkdown()` preserved the source's raw line breaks verbatim. Frontmatter (`name`, `description`) is unaffected either way, since the normalizer passes frontmatter lines through untouched — but a body whose source prose is not already written one-sentence-per-line will render with different line breaks than the legacy projector produced. That is a real, documented behavioural difference from reusing the Group renderer as instructed, not a defect in this projection.

```js
import { projectSkillToPath } from "@red-cup-engineering/project-skill-to-path-service";

const receipt = await projectSkillToPath({
  record: { type: "skill", name: "making-a-widget", description: "Makes a widget." },
  body: "Free prose about widgets.",
  sourcePath: "lib/professional-repertoire/skills/make-a-widget.js",
  targetDirectory: ".claude/skills",
});
```
