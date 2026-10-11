import assert from "node:assert/strict";
import test from "node:test";
import { projectAgentSkillMarkdown } from "../../scripts/fabric/project-agent-skill-markdown.mjs";

test("projects canonical skill frontmatter and instructional body", () => {
  const projected = projectAgentSkillMarkdown({"type":"AgentSkillMarkdownSpecification","version":1,"name":"making-a-widget","description":"Makes one widget from supplied material.","body":"Inspect the material.\nMake the widget."});
  assert.deepEqual(projected, {"type":"TextFileCreationProjection","version":1,"path":"making-a-widget/SKILL.md","text":"---\nname: making-a-widget\ndescription: Makes one widget from supplied material.\n---\n\nInspect the material.\nMake the widget.\n","mode":420});
  assert(Object.isFrozen(projected));
});

test("refuses unsafe names and empty discovery text", () => {
  assert.throws(() => projectAgentSkillMarkdown({ type: "AgentSkillMarkdownSpecification", version: 1, name: "../bad", description: "x", body: "x" }), /name.*pattern/u);
  assert.throws(() => projectAgentSkillMarkdown({ type: "AgentSkillMarkdownSpecification", version: 1, name: "good", description: "", body: "x" }), /description/u);
});

test("refuses every line separator before YAML projection", () => {
  for (const separator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    assert.throws(
      () => projectAgentSkillMarkdown({ type: "AgentSkillMarkdownSpecification", version: 1, name: "good", description: `Makes one${separator}widget from supplied material.`, body: "Make the widget from supplied material." }),
      { name: "TypeError", message: "description must be nonempty single-line text" },
    );
  }
});
