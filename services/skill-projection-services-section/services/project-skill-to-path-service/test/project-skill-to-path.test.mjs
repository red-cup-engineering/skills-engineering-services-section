import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectSkillToPath } from "../src/project-skill-to-path.mjs";

async function withScratch(run) {
  const dir = await mkdtemp(join(tmpdir(), "project-skill-to-path-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writes SKILL.md with only name and description, and a byte-identical script", async () => {
  await withScratch(async (scratch) => {
    const sourcePath = join(scratch, "make-a-widget.js");
    const sourceText = "#!/usr/bin/env node\nconsole.log('widget');\n";
    await writeFile(sourcePath, sourceText);

    const targetDirectory = join(scratch, "target");
    const receipt = await projectSkillToPath({
      record: { type: "skill", name: "making-a-widget", description: "Makes a widget." },
      body: "Free prose about widgets.",
      sourcePath,
      targetDirectory,
    });

    assert.equal(receipt.ok, true);
    assert.equal(receipt.name, "making-a-widget");
    assert.equal(receipt.directory, join(targetDirectory, "making-a-widget"));

    const md = await readFile(receipt.skillPath, "utf8");
    assert.equal(md, "---\nname: making-a-widget\ndescription: Makes a widget.\n---\n\nFree prose about widgets.\n");
    const keys = [...md.matchAll(/^([a-z-]+):/gmu)].map((m) => m[1]);
    assert.deepEqual(keys, ["name", "description"]);

    const script = await readFile(receipt.scriptPath, "utf8");
    assert.equal(script, sourceText);
  });
});

test("refuses when targetDirectory's parent does not exist", async () => {
  await withScratch(async (scratch) => {
    const sourcePath = join(scratch, "a.js");
    await writeFile(sourcePath, "console.log(1);\n");
    await assert.rejects(
      () => projectSkillToPath({
        record: { name: "doing-a-thing", description: "d" },
        body: "b",
        sourcePath,
        targetDirectory: join(scratch, "no", "such", "parent", "target"),
      }),
      /parent does not exist/u,
    );
  });
});

test("refuses when the source script does not exist", async () => {
  await withScratch(async (scratch) => {
    await assert.rejects(
      () => projectSkillToPath({
        record: { name: "doing-a-thing", description: "d" },
        body: "b",
        sourcePath: join(scratch, "missing.js"),
        targetDirectory: scratch,
      }),
      /no such source script/u,
    );
    assert.equal(existsSync(join(scratch, "doing-a-thing")), false);
  });
});
