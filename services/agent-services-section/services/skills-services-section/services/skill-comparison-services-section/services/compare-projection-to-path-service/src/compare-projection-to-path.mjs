import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { renderAgentSkillMarkdown } from "@red-cup-engineering/skills-services-section";

/**
 * Compare a skill record's would-be projection against what actually sits
 * at a target directory, read-only. Never writes — this is the read side of
 * the same shape `project-skill-to-path-service` writes, useful to refuse
 * drift the way the legacy `project-a-skill.js --check` did.
 *
 * Precondition: none beyond argument shape — an absent projection is a
 *   reportable difference, not a refusal.
 * Input: `{ record, body, sourcePath, targetDirectory }` — the same shape
 *   `projectSkillToPath` takes.
 * Output: `{ ok, differences }` — `differences` is `[]` when `ok` is true.
 *   Each difference is `{ kind, path }`, `kind` one of
 *   `missing-skill-md`, `skill-md-differs`, `missing-script`,
 *   `script-differs`.
 * Postcondition: no file is created, modified, or deleted by this call, no
 *   matter what it finds.
 */
export async function compareProjectionToPath({ record, body, sourcePath, targetDirectory }) {
  if (!record || typeof record.name !== "string" || record.name === "") {
    throw new TypeError("record.name is required to name the projected directory");
  }
  if (typeof sourcePath !== "string" || sourcePath === "") throw new TypeError("sourcePath is required");
  if (typeof targetDirectory !== "string" || targetDirectory === "") throw new TypeError("targetDirectory is required");

  const differences = [];
  const dir = join(resolve(targetDirectory), record.name);
  const skillPath = join(dir, "SKILL.md");
  const flatName = basename(sourcePath);
  const scriptPath = join(dir, "scripts", flatName);

  const expectedMarkdown = renderAgentSkillMarkdown({ name: record.name, description: record.description, body });

  if (!existsSync(skillPath)) {
    differences.push({ kind: "missing-skill-md", path: skillPath });
  } else if (readFileSync(skillPath, "utf8") !== expectedMarkdown) {
    differences.push({ kind: "skill-md-differs", path: skillPath });
  }

  if (!existsSync(scriptPath)) {
    differences.push({ kind: "missing-script", path: scriptPath });
  } else if (!existsSync(sourcePath)) {
    differences.push({ kind: "missing-script", path: sourcePath });
  } else if (!readFileSync(scriptPath).equals(readFileSync(sourcePath))) {
    differences.push({ kind: "script-differs", path: scriptPath });
  }

  return { ok: differences.length === 0, differences };
}
