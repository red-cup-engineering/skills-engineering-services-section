import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { admitJavascriptOperationSkillSource } from "../../scripts/fabric/admit-javascript-operation-skill-source.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "admits a complete skill source",
    "input": {
      "type": "JavascriptOperationSkillSourceCandidate",
      "version": 1,
      "reading": {
        "type": "TextFileRead",
        "path": "demonstrating-a-skill.mjs",
        "text": "#!/usr/bin/env node\n/**\n * Returns the supplied value as the skill demonstration body.\n * @summary Demonstrates exact skill-source admission.\n * @param {string} value The value to return.\n * @returns {string} The same value.\n */\nexport function demonstrateSkill(value) {\n  return value;\n}\n\nif (import.meta.main) {\n  if (process.argv.includes(\"--help\")) process.stdout.write(\"demonstrateSkill — Returns the supplied value as the skill demonstration body.\\n\");\n  else {\n    process.stdin.setEncoding(\"utf8\");\n    let text = \"\";\n    for await (const chunk of process.stdin) text += chunk;\n    for (const line of text.split(\"\\n\")) if (line.trim()) process.stdout.write(JSON.stringify(demonstrateSkill(JSON.parse(line))) + \"\\n\");\n  }\n}\n"
      },
      "documentations": [
        {
          "type": "JavascriptFileExportDocumentation",
          "version": 1,
          "path": "demonstrating-a-skill.mjs",
          "name": "demonstrateSkill",
          "kind": "function",
          "signature": "demonstrateSkill(value)",
          "description": "Returns the supplied value as the skill demonstration body.",
          "parameters": [
            {
              "name": "value",
              "type": "string",
              "description": "The value to return."
            }
          ],
          "returns": {
            "type": "string",
            "description": "The same value."
          },
          "throws": [],
          "tags": [
            {
              "name": "summary",
              "text": "Demonstrates exact skill-source admission."
            }
          ]
        }
      ],
      "mainGuards": [
        {
          "type": "JavascriptFileMainGuard",
          "version": 1,
          "path": "demonstrating-a-skill.mjs",
          "start": 290,
          "end": 730
        }
      ]
    },
    "output": {
      "type": "JavascriptOperationSkillSource",
      "version": 1,
      "name": "demonstrating-a-skill",
      "summary": "Demonstrates exact skill-source admission.",
      "body": "Returns the supplied value as the skill demonstration body.",
      "scriptPath": "scripts/demonstrating-a-skill.mjs",
      "reading": {
        "type": "TextFileRead",
        "path": "demonstrating-a-skill.mjs",
        "text": "#!/usr/bin/env node\n/**\n * Returns the supplied value as the skill demonstration body.\n * @summary Demonstrates exact skill-source admission.\n * @param {string} value The value to return.\n * @returns {string} The same value.\n */\nexport function demonstrateSkill(value) {\n  return value;\n}\n\nif (import.meta.main) {\n  if (process.argv.includes(\"--help\")) process.stdout.write(\"demonstrateSkill — Returns the supplied value as the skill demonstration body.\\n\");\n  else {\n    process.stdin.setEncoding(\"utf8\");\n    let text = \"\";\n    for await (const chunk of process.stdin) text += chunk;\n    for (const line of text.split(\"\\n\")) if (line.trim()) process.stdout.write(JSON.stringify(demonstrateSkill(JSON.parse(line))) + \"\\n\");\n  }\n}\n"
      },
      "documentation": {
        "type": "JavascriptFileExportDocumentation",
        "version": 1,
        "path": "demonstrating-a-skill.mjs",
        "name": "demonstrateSkill",
        "kind": "function",
        "signature": "demonstrateSkill(value)",
        "description": "Returns the supplied value as the skill demonstration body.",
        "parameters": [
          {
            "name": "value",
            "type": "string",
            "description": "The value to return."
          }
        ],
        "returns": {
          "type": "string",
          "description": "The same value."
        },
        "throws": [],
        "tags": [
          {
            "name": "summary",
            "text": "Demonstrates exact skill-source admission."
          }
        ]
      },
      "mainGuard": {
        "type": "JavascriptFileMainGuard",
        "version": 1,
        "path": "demonstrating-a-skill.mjs",
        "start": 290,
        "end": 730
      }
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await admitJavascriptOperationSkillSource(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/fabric/admit-javascript-operation-skill-source.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
