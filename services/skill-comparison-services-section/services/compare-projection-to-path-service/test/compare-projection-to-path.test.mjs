import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareProjectionToPath } from "../src/compare-projection-to-path.mjs";
import { projectSkillToPath } from "@red-cup-engineering/project-skill-to-path-service";

async function withScratch(run) {
  const dir = await mkdtemp(join(tmpdir(), "compare-projection-to-path-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function setUpProjection(scratch) {
  const sourcePath = join(scratch, "make-a-widget.js");
  await writeFile(sourcePath, "#!/usr/bin/env node\nconsole.log('widget');\n");
  const targetDirectory = join(scratch, "target");
  const record = { type: "skill", name: "making-a-widget", description: "Makes a widget." };
  const body = "Free prose about widgets.";
  await projectSkillToPath({ record, body, sourcePath, targetDirectory });
  return { sourcePath, targetDirectory, record, body };
}

test("reports ok for a fresh, matching projection", async () => {
  await withScratch(async (scratch) => {
    const { sourcePath, targetDirectory, record, body } = await setUpProjection(scratch);
    const result = await compareProjectionToPath({ record, body, sourcePath, targetDirectory });
    assert.deepEqual(result, { ok: true, differences: [] });
  });
});

test("reports script-differs when the projected script is mutated by one byte", async () => {
  await withScratch(async (scratch) => {
    const { sourcePath, targetDirectory, record, body } = await setUpProjection(scratch);
    const scriptPath = join(targetDirectory, record.name, "scripts", "make-a-widget.js");
    await writeFile(scriptPath, "#!/usr/bin/env node\nconsole.log('widgeT');\n");

    const result = await compareProjectionToPath({ record, body, sourcePath, targetDirectory });
    assert.equal(result.ok, false);
    assert.deepEqual(result.differences, [{ kind: "script-differs", path: scriptPath }]);
  });
});

test("reports missing-skill-md and missing-script when nothing was projected", async () => {
  await withScratch(async (scratch) => {
    const sourcePath = join(scratch, "make-a-widget.js");
    await writeFile(sourcePath, "console.log(1);\n");
    const targetDirectory = join(scratch, "target");
    const record = { type: "skill", name: "making-a-widget", description: "d" };

    const result = await compareProjectionToPath({ record, body: "b", sourcePath, targetDirectory });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.differences.map((d) => d.kind).sort(),
      ["missing-script", "missing-skill-md"],
    );
  });
});

test("reports skill-md-differs when SKILL.md is hand-edited", async () => {
  await withScratch(async (scratch) => {
    const { sourcePath, targetDirectory, record, body } = await setUpProjection(scratch);
    const skillPath = join(targetDirectory, record.name, "SKILL.md");
    await writeFile(skillPath, "---\nname: making-a-widget\ndescription: Hand-edited.\n---\n\nHand-edited.\n");

    const result = await compareProjectionToPath({ record, body, sourcePath, targetDirectory });
    assert.equal(result.ok, false);
    assert.deepEqual(result.differences, [{ kind: "skill-md-differs", path: skillPath }]);
  });
});

test("never writes anything, no matter what it finds", async () => {
  await withScratch(async (scratch) => {
    const sourcePath = join(scratch, "make-a-widget.js");
    await writeFile(sourcePath, "console.log(1);\n");
    const targetDirectory = join(scratch, "target");
    const record = { type: "skill", name: "making-a-widget", description: "d" };
    await compareProjectionToPath({ record, body: "b", sourcePath, targetDirectory });
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(join(targetDirectory, "making-a-widget")), false);
  });
});
