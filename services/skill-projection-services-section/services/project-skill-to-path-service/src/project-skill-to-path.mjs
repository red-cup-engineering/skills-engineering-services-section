import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { renderAgentSkillMarkdown } from "@red-cup-engineering/skills-services-section";

/**
 * Project one skill record and its source script into the directory shape
 * the Agent Skills harness reads: `<targetDirectory>/<record.name>/SKILL.md`
 * plus `<targetDirectory>/<record.name>/scripts/<basename(sourcePath)>`.
 * This is the only package in the skills split that writes to disk.
 *
 * SKILL.md is rendered by IMPORTING `renderAgentSkillMarkdown` from
 * `@red-cup-engineering/skills-services-section` rather than hand-rolling
 * YAML — the legacy `project-a-skill.js` carried its own `yamlScalar`
 * quoter; that duplication is exactly what this split removes. One
 * consequence worth stating plainly: the shared renderer routes the body
 * through semantic-linefeed normalization (one sentence per line), while
 * the legacy hand-rolled `skillMarkdown()` preserved the source's raw line
 * breaks verbatim. Frontmatter (`name`, `description`) is unaffected either
 * way — those lines pass through the normalizer untouched — but a body
 * whose prose is not already written one-sentence-per-line will render
 * differently under this service than it did under the legacy script. That
 * is a real, documented behavioural difference from reusing the house
 * renderer, not a bug in this projection.
 *
 * Precondition: `targetDirectory`'s parent exists (projection does not
 *   invent a place to put a skill); `sourcePath` names a file that exists;
 *   `record.name` and `record.description` are present.
 * Input: `{ record, body, sourcePath, targetDirectory }`.
 * Output: a receipt — `{ ok, name, directory, skillPath, scriptPath }` —
 *   naming exactly what was written.
 * Postcondition: `<targetDirectory>/<record.name>/SKILL.md` exists carrying
 *   ONLY `name` and `description` in frontmatter, plus the prose body;
 *   `<targetDirectory>/<record.name>/scripts/<basename(sourcePath)>` is
 *   byte-identical to `sourcePath`.
 */
export async function projectSkillToPath({ record, body, sourcePath, targetDirectory }) {
  if (!record || typeof record.name !== "string" || record.name === "") {
    throw new TypeError("record.name is required to name the projected directory");
  }
  if (typeof sourcePath !== "string" || sourcePath === "") throw new TypeError("sourcePath is required");
  if (typeof targetDirectory !== "string" || targetDirectory === "") throw new TypeError("targetDirectory is required");
  if (!existsSync(sourcePath)) throw new Error(`no such source script: ${sourcePath}`);

  const targetRoot = resolve(targetDirectory);
  if (!existsSync(dirname(targetRoot))) {
    throw new Error(`targetDirectory's parent does not exist: ${dirname(targetRoot)}`);
  }

  const flatName = basename(sourcePath);
  const dir = join(targetRoot, record.name);
  const skillPath = join(dir, "SKILL.md");
  const scriptPath = join(dir, "scripts", flatName);

  const markdown = renderAgentSkillMarkdown({ name: record.name, description: record.description, body });
  const sourceBytes = readFileSync(sourcePath);

  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(skillPath, markdown);
  writeFileSync(scriptPath, sourceBytes);

  return {
    ok: true,
    name: record.name,
    directory: dir,
    skillPath,
    scriptPath,
  };
}
