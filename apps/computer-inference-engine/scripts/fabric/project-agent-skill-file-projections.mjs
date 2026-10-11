#!/usr/bin/env node
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { canonical } from "@red-cup-engineering/json-services-section";
import { projectAgentSkillMarkdown } from "@red-cup-engineering/computer-inference-engine/fabric/project-agent-skill-markdown";
import { admitTextFileCreationProjection } from "@red-cup-engineering/computer-file-engineering-services-section/admit-text-file-creation-projection";
import { admitTextFileCreationProjectionSet } from "@red-cup-engineering/computer-file-engineering-services-section/admit-text-file-creation-projection-set";

function requireSkillSource(value) {
  if (value?.type !== "JavascriptOperationSkillSource" || value.version !== 1) throw new TypeError("input must be an admitted JavascriptOperationSkillSource@1");
  return value;
}

function operationDocumentation(documentation) {
  const lines = ["## Operation", "", documentation.signature];
  if (documentation.parameters.length > 0) {
    lines.push("", "### Parameters", "");
    for (const parameter of documentation.parameters) lines.push("- " + parameter.name + (parameter.type ? " (" + parameter.type + ")" : "") + ": " + parameter.description);
  }
  if (documentation.returns !== null) lines.push("", "### Returns", "", (documentation.returns.type ? documentation.returns.type + ": " : "") + documentation.returns.description);
  if (documentation.throws.length > 0) {
    lines.push("", "### Refusals", "");
    for (const refusal of documentation.throws) lines.push("- " + (refusal.type ? refusal.type + ": " : "") + refusal.description);
  }
  return lines.join("\n");
}

/**
 * Projects one admitted JavaScript operation skill source into a complete immutable skill file set.
 * @param {object} skillSource An admitted JavascriptOperationSkillSource.
 * @returns {object} An admitted TextFileCreationProjectionSet for SKILL.md and the identical executable script.
 */
export function projectAgentSkillFileProjections(skillSource) {
  const admitted = requireSkillSource(skillSource);
  const markdown = projectAgentSkillMarkdown({
    type: "AgentSkillMarkdownSpecification",
    version: 1,
    name: admitted.name,
    description: admitted.summary,
    body: admitted.body + "\n\n" + operationDocumentation(admitted.documentation),
  });
  const files = [
    markdown,
    admitTextFileCreationProjection({ type: "TextFileCreationProjection", version: 1, path: admitted.name + "/scripts/" + basename(admitted.reading.path), text: admitted.reading.text, mode: 0o755 }),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const invalid = files.find((file) => file.type !== "TextFileCreationProjection");
  if (invalid) throw new TypeError("projected skill file was refused: " + invalid.code + " " + invalid.message);
  const filesDigest = "sha256:" + createHash("sha256").update(files.map(canonical).join("\n") + "\n").digest("hex");
  const projection = admitTextFileCreationProjectionSet({ type: "TextFileCreationProjectionSet", version: 1, files, filesDigest });
  if (projection.type !== "TextFileCreationProjectionSet") throw new TypeError("projected skill set was refused: " + projection.code + " " + projection.message);
  return projection;
}

if (import.meta.main) {
  const { once } = await import("node:events");
  const { readFile } = await import("node:fs/promises");
  const { parseJavascriptArgv } = await import("@red-cup-engineering/javascript-node-services-section/argv");
  const { readJavascriptFileExportDocumentation } = await import("@red-cup-engineering/read-javascript-file-export-documentation-service");
  const { parseLines, serializeLines } = await import("@red-cup-engineering/jsonl-services-section");
  const parsed = parseJavascriptArgv({ type: "JavascriptArgvParsingRequest", version: 1, argumentVector: { type: "JavascriptArgumentVector", version: 1, arguments: process.argv }, options: { help: { type: "boolean", short: "h", default: false } }, allowPositionals: false, strict: true });
  if (parsed.options.help) {
    const source = await readFile(new URL(import.meta.url), "utf8");
    const [documentation] = readJavascriptFileExportDocumentation({ type: "TextFileRead", path: "scripts/project-agent-skill-file-projections.mjs", text: source });
    const helpOutput = documentation.name + " — " + documentation.description + "\n\n" + documentation.signature + "\n";
    if (!process.stdout.write(helpOutput)) await once(process.stdout, "drain");
  } else {
    process.stdin.setEncoding("utf8");
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    const output = serializeLines(parseLines(text).map(projectAgentSkillFileProjections));
    if (!process.stdout.write(output)) await once(process.stdout, "drain");
  }
}
