#!/usr/bin/env node
import { defineType, instantiate } from "@red-cup-engineering/computer-data-engineering-services-section/type-system";
import { admitAgentSkillDescription } from "../../src/fabric/agent-skill-description.mjs";
import { normalizeLinefeeds } from "@red-cup-engineering/computer-text-content-engineering-services-section/normalize-linefeeds";
import { admitTextFileCreationProjection } from "@red-cup-engineering/computer-file-engineering-services-section/admit-text-file-creation-projection";

const specificationDefinition = defineType({
  id: "AgentSkillMarkdownSpecification@1", name: "AgentSkillMarkdownSpecification",
  description: "Complete input for projecting an agent skill into Markdown.", parents: [],
  schema: /** @type {const} */ ({
    type: "object", additionalProperties: false,
    required: ["type", "version", "name", "description", "body"],
    properties: {
      type: { const: "AgentSkillMarkdownSpecification" }, version: { const: 1 },
      name: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
      description: { type: "string" }, body: { type: "string", pattern: "\\S" },
    },
  }),
});
if (!specificationDefinition.ok) throw new TypeError(specificationDefinition.refusal.message);
/** Shared construction and admission contract for a skill Markdown specification. */
export const AgentSkillMarkdownSpecification = specificationDefinition.value;

function yamlScalar(value) {
  const text = String(value);
  if (/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/u.test(text) && !/\s$/u.test(text)) return text;
  return JSON.stringify(text);
}

/**
 * Projects one complete agent-skill Markdown specification into an admitted SKILL.md text-file projection.
 * @param {object} specification An AgentSkillMarkdownSpecification with a kebab-case name, discovery description, and instructional body.
 * @returns {object} An admitted TextFileCreationProjection for <name>/SKILL.md.
 */
export function projectAgentSkillMarkdown(specification) {
  const admitted = instantiate(AgentSkillMarkdownSpecification, specification);
  if (!admitted.ok) throw new TypeError("invalid AgentSkillMarkdownSpecification: " + admitted.refusal.issues.map(issue => issue.path + " " + issue.message).join("; "));
  specification = admitted.value;
  let description;
  try {
    description = admitAgentSkillDescription(specification.description, { body: specification.body }).text;
  } catch {
    throw new TypeError("description must be nonempty single-line text");
  }
  const text = normalizeLinefeeds("---\nname: " + specification.name + "\ndescription: " + yamlScalar(description) + "\n---\n\n" + specification.body.trim() + "\n");
  const projection = admitTextFileCreationProjection({ type: "TextFileCreationProjection", version: 1, path: specification.name + "/SKILL.md", text, mode: 0o644 });
  if (projection.type !== "TextFileCreationProjection") throw new TypeError("projected SKILL.md was refused: " + projection.code + " " + projection.message);
  return projection;
}

if (import.meta.main) {
  const { once } = await import("node:events");
  const { readFile } = await import("node:fs/promises");
  const { parseLines, serializeLines } = await import("@red-cup-engineering/jsonl-services-section");
  const { parseJavascriptArgv } = await import("@red-cup-engineering/javascript-node-services-section/argv");
  const { readJavascriptFileExportDocumentation } = await import("@red-cup-engineering/read-javascript-file-export-documentation-service");
  const parsed = parseJavascriptArgv({ type: "JavascriptArgvParsingRequest", version: 1, argumentVector: { type: "JavascriptArgumentVector", version: 1, arguments: process.argv }, options: { help: { type: "boolean", short: "h", default: false } }, allowPositionals: false, strict: true });
  if (parsed.options.help) {
    const source = await readFile(new URL(import.meta.url), "utf8");
    const [documentation] = readJavascriptFileExportDocumentation({ type: "TextFileRead", path: "scripts/project-agent-skill-markdown.mjs", text: source });
    const helpOutput = documentation.name + " — " + documentation.description + "\n\n" + documentation.signature + "\n";
    if (!process.stdout.write(helpOutput)) await once(process.stdout, "drain");
  } else {
    process.stdin.setEncoding("utf8");
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const output = serializeLines(parseLines(text).map(projectAgentSkillMarkdown));
    if (!process.stdout.write(output)) await once(process.stdout, "drain");
  }
}
