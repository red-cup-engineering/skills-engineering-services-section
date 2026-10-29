import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectCodexHarness } from "../src/projector.mjs";

const configurationPath = join(import.meta.dirname, "../../../../../../../../../../../../../../../../rsc-quiescent/services/persistent-machines-services-section/services/bare-cedar-fog-services-section/lib/actors/codex-in-vs-code/config.json");

test("projects only disposable runtime files and removes generated skill state", (t) => {
  const target = mkdtempSync(join(tmpdir(), "codex-harness-projection-"));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  const contaminated = join(target, "skills/handwritten/SKILL.md");
  mkdirSync(join(target, "skills/handwritten"), { recursive: true });
  writeFileSync(contaminated, "knowledge stranded in generated state\n");
  const projection = projectCodexHarness({ configurationPath, target });
  assert.equal(existsSync(join(target, "skills")), false);
  assert.deepEqual(projection.files, ["config.toml", "hooks.json"]);
  const hooks = JSON.parse(readFileSync(join(target, "hooks.json"), "utf8")).hooks;
  for (const event of ["SessionStart", "UserPromptSubmit", "SubagentStart"]) {
    assert.equal(hooks[event][0].hooks[0].additionalContextLimit, 512, event);
  }
  assert.equal(hooks.SubagentStop[0].hooks[0].additionalContextLimit, undefined);
  assert.equal(projection.files.some((path) => path.startsWith("skills/")), false);
});
