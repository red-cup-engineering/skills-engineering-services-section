import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectAgentSkillFileProjections } from "../../scripts/fabric/project-agent-skill-file-projections.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "projects a complete operation skill",
    "input": {
      "type": "JavascriptOperationSkillSource",
      "version": 1,
      "name": "demonstrating-a-projected-skill",
      "summary": "Demonstrates a projected operation skill.",
      "body": "Echo the supplied value while demonstrating the body of an operation skill.",
      "scriptPath": "scripts/demonstrating-a-projected-skill.mjs",
      "reading": {
        "type": "TextFileRead",
        "path": "demonstrating-a-projected-skill.mjs",
        "text": "#!/usr/bin/env node\n/**\n * Echo the supplied value while demonstrating the body of an operation skill.\n * @summary Demonstrates a projected operation skill.\n * @param {string} value The value to echo.\n * @returns {string} The same value.\n */\nexport function demonstrateProjectedSkill(value) { return value; }\n\nif (import.meta.main) {\n  if (process.argv.includes(\"--help\")) process.stdout.write(\"demonstrateProjectedSkill — Echo the supplied value while demonstrating the body of an operation skill.\\n\");\n  else {\n    process.stdin.setEncoding(\"utf8\");\n    let text = \"\";\n    for await (const chunk of process.stdin) text += chunk;\n    for (const line of text.split(\"\\n\")) if (line.trim()) process.stdout.write(JSON.stringify(demonstrateProjectedSkill(JSON.parse(line))) + \"\\n\");\n  }\n}\n"
      },
      "documentation": {
        "type": "JavascriptFileExportDocumentation",
        "version": 1,
        "path": "demonstrating-a-projected-skill.mjs",
        "name": "demonstrateProjectedSkill",
        "kind": "function",
        "signature": "demonstrateProjectedSkill(value)",
        "description": "Echo the supplied value while demonstrating the body of an operation skill.",
        "parameters": [
          {
            "name": "value",
            "type": "string",
            "description": "The value to echo."
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
            "text": "Demonstrates a projected operation skill."
          }
        ]
      },
      "mainGuard": {
        "type": "JavascriptFileMainGuard",
        "version": 1,
        "path": "demonstrating-a-projected-skill.mjs",
        "start": 310,
        "end": 784
      }
    },
    "output": {
      "type": "TextFileCreationProjectionSet",
      "version": 1,
      "files": [
        {
          "type": "TextFileCreationProjection",
          "version": 1,
          "path": "demonstrating-a-projected-skill/scripts/demonstrating-a-projected-skill.mjs",
          "text": "#!/usr/bin/env node\n/**\n * Echo the supplied value while demonstrating the body of an operation skill.\n * @summary Demonstrates a projected operation skill.\n * @param {string} value The value to echo.\n * @returns {string} The same value.\n */\nexport function demonstrateProjectedSkill(value) { return value; }\n\nif (import.meta.main) {\n  if (process.argv.includes(\"--help\")) process.stdout.write(\"demonstrateProjectedSkill — Echo the supplied value while demonstrating the body of an operation skill.\\n\");\n  else {\n    process.stdin.setEncoding(\"utf8\");\n    let text = \"\";\n    for await (const chunk of process.stdin) text += chunk;\n    for (const line of text.split(\"\\n\")) if (line.trim()) process.stdout.write(JSON.stringify(demonstrateProjectedSkill(JSON.parse(line))) + \"\\n\");\n  }\n}\n",
          "mode": 493
        },
        {
          "type": "TextFileCreationProjection",
          "version": 1,
          "path": "demonstrating-a-projected-skill/SKILL.md",
          "text": "---\nname: demonstrating-a-projected-skill\ndescription: Demonstrates a projected operation skill.\n---\n\nEcho the supplied value while demonstrating the body of an operation skill.\n\n## Operation\n\ndemonstrateProjectedSkill(value)\n\n### Parameters\n\n- value (string): The value to echo.\n\n### Returns\n\nstring: The same value.\n",
          "mode": 420
        }
      ],
      "filesDigest": "sha256:4004218652a97a83fdb83ebe08a3bd8207e92b3579c9d067df3a939f0fc6ebd9"
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await projectAgentSkillFileProjections(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/fabric/project-agent-skill-file-projections.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
