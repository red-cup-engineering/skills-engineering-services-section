import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectAgentSkillMarkdown } from "../../scripts/fabric/project-agent-skill-markdown.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "projects canonical skill markdown",
    "input": {
      "type": "AgentSkillMarkdownSpecification",
      "version": 1,
      "name": "making-a-widget",
      "description": "Makes one widget from supplied material.",
      "body": "Inspect the material.\nMake the widget."
    },
    "output": {
      "type": "TextFileCreationProjection",
      "version": 1,
      "path": "making-a-widget/SKILL.md",
      "text": "---\nname: making-a-widget\ndescription: Makes one widget from supplied material.\n---\n\nInspect the material.\nMake the widget.\n",
      "mode": 420
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await projectAgentSkillMarkdown(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/fabric/project-agent-skill-markdown.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
