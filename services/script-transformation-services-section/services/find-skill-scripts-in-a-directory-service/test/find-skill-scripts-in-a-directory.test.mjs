import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSkillScriptsInADirectory } from "../src/find-skill-scripts-in-a-directory.mjs";

async function withDirectory(run) {
  const dir = await mkdtemp(join(tmpdir(), "find-skill-scripts-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("finds every file carrying an @skill declaration, any extension", async () => {
  await withDirectory(async (dir) => {
    await writeFile(join(dir, "make-a-widget.js"), "/**\n * @skill making-a-widget\n */\n");
    await writeFile(join(dir, "carry-a-decision.mjs"), "/**\n * @skill carrying-a-decision\n */\n");
    await writeFile(join(dir, "not-a-skill.js"), "console.log('plain script');\n");
    await writeFile(join(dir, "README.md"), "# not a skill either\n");

    const found = findSkillScriptsInADirectory(dir);
    assert.deepEqual(
      found.map((p) => p.split("/").at(-1)).sort(),
      ["carry-a-decision.mjs", "make-a-widget.js"],
    );
    assert.ok(found.every((p) => p.startsWith("/")));
  });
});

test("does not descend into subdirectories", async () => {
  await withDirectory(async (dir) => {
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested", "hidden.js"), "/**\n * @skill hidden-one\n */\n");
    const found = findSkillScriptsInADirectory(dir);
    assert.deepEqual(found, []);
  });
});

test("takes the directory as an argument and never hardcodes a pool path", async () => {
  await withDirectory(async (dirA) => {
    await withDirectory(async (dirB) => {
      await writeFile(join(dirA, "a.js"), "/**\n * @skill in-a\n */\n");
      await writeFile(join(dirB, "b.js"), "/**\n * @skill in-b\n */\n");
      assert.deepEqual(findSkillScriptsInADirectory(dirA), [join(dirA, "a.js")]);
      assert.deepEqual(findSkillScriptsInADirectory(dirB), [join(dirB, "b.js")]);
    });
  });
});

test("throws a clear error when the directory does not exist", () => {
  assert.throws(() => findSkillScriptsInADirectory("/no/such/directory/at/all"), /no such directory/u);
});

test("throws when the path is a file, not a directory", async () => {
  await withDirectory(async (dir) => {
    const filePath = join(dir, "file.txt");
    await writeFile(filePath, "hi\n");
    assert.throws(() => findSkillScriptsInADirectory(filePath), /not a directory/u);
  });
});
