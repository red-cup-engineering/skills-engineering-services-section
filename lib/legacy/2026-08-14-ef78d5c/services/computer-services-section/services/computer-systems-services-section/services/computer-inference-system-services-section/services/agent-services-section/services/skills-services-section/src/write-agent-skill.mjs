import { prepareMarkdownFileText, writeMarkdownFile } from "@red-cup-engineering/write-markdown-file-service";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function yamlScalar(value) {
  const text = String(value);
  if (/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/u.test(text) && !/\s$/u.test(text)) return text;
  return `"${text.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n")}"`;
}

export function renderAgentSkillMarkdown({ name, description, body }) {
  if (typeof name !== "string" || !SKILL_NAME.test(name)) throw new TypeError("name must be lowercase kebab-case");
  if (typeof description !== "string" || description.trim().length === 0) throw new TypeError("description must be nonempty");
  if (typeof body !== "string" || body.trim().length === 0) throw new TypeError("body must be nonempty");
  return prepareMarkdownFileText(`---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description.trim())}\n---\n\n${body.trim()}\n`);
}

export async function writeAgentSkill({ root, directory = undefined, name, description, body, mode = "create" }) {
  const targetDirectory = directory ?? name;
  if (typeof targetDirectory !== "string" || !SKILL_NAME.test(targetDirectory)) {
    throw new TypeError("directory must be one lowercase kebab-case path segment");
  }
  return writeMarkdownFile({
    root,
    path: `${targetDirectory}/SKILL.md`,
    text: renderAgentSkillMarkdown({ name, description, body }),
    mode,
  });
}
