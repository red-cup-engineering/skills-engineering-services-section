import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAgentSkillMarkdown, writeAgentSkill } from "../src/write-agent-skill.mjs";

test("renders only Agent Skills frontmatter and semantic linefeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-skill-writer-"));
  try {
    const result = await writeAgentSkill({
      root,
      name: "monitoring-a-capability-extraction",
      description: "Finds real implementations before extraction.",
      body: "Inspect the repository and today's evidence. Record each implementation. Then stop.",
    });
    const text = await readFile(result.path, "utf8");
    assert.equal(text, "---\nname: monitoring-a-capability-extraction\ndescription: Finds real implementations before extraction.\n---\n\nInspect the repository and today's evidence.\nRecord each implementation.\nThen stop.\n");
    assert.deepEqual([...text.matchAll(/^([a-z-]+):/gmu)].map((match) => match[1]), ["name", "description"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses path-shaped names and empty skills", () => {
  assert.throws(() => renderAgentSkillMarkdown({ name: "../skill", description: "No.", body: "No." }), /kebab-case/u);
  assert.throws(() => renderAgentSkillMarkdown({ name: "valid-skill", description: "", body: "No." }), /description/u);
});
