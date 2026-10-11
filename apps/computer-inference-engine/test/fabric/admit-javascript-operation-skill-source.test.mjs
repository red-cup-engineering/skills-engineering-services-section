import assert from "node:assert/strict";
import test from "node:test";
import { readJavascriptFileExportDocumentation } from "@red-cup-engineering/read-javascript-file-export-documentation-service";
import { readJavascriptFileMainGuards } from "@red-cup-engineering/javascript-file-services-section/read-javascript-file-main-guards";
import { admitJavascriptOperationSkillSource } from "../../scripts/fabric/admit-javascript-operation-skill-source.mjs";

const source = "#!/usr/bin/env node\n/**\n * Returns the supplied value as the skill demonstration body.\n * @summary Demonstrates exact skill-source admission.\n * @param {string} value The value to return.\n * @returns {string} The same value.\n */\nexport function demonstrateSkill(value) {\n  return value;\n}\n\nif (import.meta.main) {\n  if (process.argv.includes(\"--help\")) process.stdout.write(\"demonstrateSkill — Returns the supplied value as the skill demonstration body.\\n\");\n  else {\n    process.stdin.setEncoding(\"utf8\");\n    let text = \"\";\n    for await (const chunk of process.stdin) text += chunk;\n    for (const line of text.split(\"\\n\")) if (line.trim()) process.stdout.write(JSON.stringify(demonstrateSkill(JSON.parse(line))) + \"\\n\");\n  }\n}\n";
function candidate(text = source) {
  const reading = { type: "TextFileRead", path: "demonstrating-a-skill.mjs", text };
  return { type: "JavascriptOperationSkillSourceCandidate", version: 1, reading, documentations: readJavascriptFileExportDocumentation(reading), mainGuards: readJavascriptFileMainGuards(reading) };
}

test("admits one standard-JSDoc executable operation", () => {
  const admitted = admitJavascriptOperationSkillSource(candidate());
  assert.equal(admitted.type, "JavascriptOperationSkillSource", JSON.stringify(admitted));
  assert.equal(admitted.name, "demonstrating-a-skill");
  assert.equal(admitted.summary, "Demonstrates exact skill-source admission.");
  assert.equal(admitted.scriptPath, "scripts/demonstrating-a-skill.mjs");
  assert(Object.isFrozen(admitted));
});

test("refuses the retired @skill dialect", () => {
  const input = candidate(source.replace("@summary", "@skill"));
  assert.equal(admitJavascriptOperationSkillSource(input).code, "RETIRED_SKILL_TAG");
});

test("refuses a source without one real main guard", () => {
  const text = source.replace("if (import.meta.main)", "if (false)");
  const input = candidate(text);
  assert.equal(admitJavascriptOperationSkillSource(input).code, "MAIN_GUARD_COUNT");
});
