import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSkillScriptsInADirectory, inspectSkillScriptsInADirectory } from "../src/find-skill-scripts-in-a-directory.mjs";

async function withDirectory(run) {
  const dir = await mkdtemp(join(tmpdir(), "find-skill-scripts-"));
  try { await run(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const documented = (name = "Does sourced work", method = "Inspect exact source. Receive a result.") =>
  "/**\n * @description " + name + "\n *\n * " + method + "\n */\nif (import.meta.main) process.stdout.write('ok');\n";

test("discovers documented projectable JS and MJS, not retired @skill declarations", async () => {
  await withDirectory(async (dir) => {
    await writeFile(join(dir, "make-a-widget.js"), documented());
    await writeFile(join(dir, "carry-a-decision.mjs"), documented("Carries a decision", "Read current authority."));
    await writeFile(join(dir, "retired.js"), "/**\n * @description Old\n * @skill retired\n */\n");
    await writeFile(join(dir, "plain.js"), "console.log('plain script');\n");
    await writeFile(join(dir, "README.md"), documented());
    await writeFile(join(dir, "empty-method.js"), "/**\n * @description No real instruction\n */\n");
    await writeFile(join(dir, "empty-description.js"), "/**\n * @param {string} text - input\n * Instruction\n */\n");
    const found = findSkillScriptsInADirectory(dir);
    assert.deepEqual(found, [join(dir, "carry-a-decision.mjs"), join(dir, "make-a-widget.js")]);
    const inspected = inspectSkillScriptsInADirectory(dir);
    assert.deepEqual(inspected.candidates, found);
    assert.deepEqual(inspected.rejected.map((x) => x.path.split("/").at(-1)), [
      "empty-description.js", "empty-method.js", "plain.js", "retired.js"
    ]);
    assert.match(inspected.rejected.at(-1).reason, /unknown declaration '@skill'/u);
    assert.match(inspected.rejected[0].reason, /description/u);
    assert.match(inspected.rejected[1].reason, /instructional prose/u);
  });
});

test("does not recurse into nested directories or follow symlinked files", async () => {
  await withDirectory(async (dir) => {
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested", "hidden.js"), documented());
    await symlink(join(dir, "nested", "hidden.js"), join(dir, "link.js"));
    assert.deepEqual(inspectSkillScriptsInADirectory(dir), { candidates: [], rejected: [] });
  });
});

test("reads caller-selected pools rather than a hardcoded Academy path", async () => {
  await withDirectory(async (a) => {
    await withDirectory(async (b) => {
      await writeFile(join(a, "a.js"), documented());
      await writeFile(join(b, "b.mjs"), documented());
      assert.deepEqual(findSkillScriptsInADirectory(a), [join(a, "a.js")]);
      assert.deepEqual(findSkillScriptsInADirectory(b), [join(b, "b.mjs")]);
    });
  });
});

test("refuses missing directories and file paths distinctly", async () => {
  assert.throws(() => findSkillScriptsInADirectory("/no/such/directory/at/all"), /no such directory/u);
  await withDirectory(async (dir) => {
    const file = join(dir, "file.txt");
    await writeFile(file, "not a directory");
    assert.throws(() => findSkillScriptsInADirectory(file), /not a directory/u);
  });
});
