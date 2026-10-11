import assert from "node:assert/strict";
import test from "node:test";
import { admitJavascriptOperationSkillSource } from "@red-cup-engineering/computer-inference-engine/fabric/admit-javascript-operation-skill-source";
import { readJavascriptFileExportDocumentation } from "@red-cup-engineering/read-javascript-file-export-documentation-service";
import { readJavascriptFileMainGuards } from "@red-cup-engineering/javascript-file-services-section/read-javascript-file-main-guards";
import { projectAgentSkillFileProjections } from "../../scripts/fabric/project-agent-skill-file-projections.mjs";

const script = "#!/usr/bin/env node\n/**\n * Echo the supplied value while demonstrating the body of an operation skill.\n * @summary Demonstrates a projected operation skill.\n * @param {string} value The value to echo.\n * @returns {string} The same value.\n */\nexport function demonstrateProjectedSkill(value) { return value; }\n\nif (import.meta.main) {\n  if (process.argv.includes(\"--help\")) process.stdout.write(\"demonstrateProjectedSkill — Echo the supplied value while demonstrating the body of an operation skill.\\n\");\n  else {\n    process.stdin.setEncoding(\"utf8\");\n    let text = \"\";\n    for await (const chunk of process.stdin) text += chunk;\n    for (const line of text.split(\"\\n\")) if (line.trim()) process.stdout.write(JSON.stringify(demonstrateProjectedSkill(JSON.parse(line))) + \"\\n\");\n  }\n}\n";
test("composes read documentation, read main guards, admission, and pure file projection", () => {
  const reading = { type: "TextFileRead", path: "demonstrating-a-projected-skill.mjs", text: script };
  const admitted = admitJavascriptOperationSkillSource({ type: "JavascriptOperationSkillSourceCandidate", version: 1, reading, documentations: readJavascriptFileExportDocumentation(reading), mainGuards: readJavascriptFileMainGuards(reading) });
  assert.equal(admitted.type, "JavascriptOperationSkillSource", JSON.stringify(admitted));
  const projected = projectAgentSkillFileProjections(admitted);
  assert.equal(projected.type, "TextFileCreationProjectionSet");
  assert.deepEqual(projected.files.map(({ path, mode }) => ({ path, mode })), [
    { path: "demonstrating-a-projected-skill/scripts/demonstrating-a-projected-skill.mjs", mode: 0o755 },
    { path: "demonstrating-a-projected-skill/SKILL.md", mode: 0o644 },
  ]);
  assert.equal(projected.files[0].text, script);
  assert.match(projected.files[1].text, /description: Demonstrates a projected operation skill\./u);
  assert.match(projected.files[1].text, /## Operation/u);
});
