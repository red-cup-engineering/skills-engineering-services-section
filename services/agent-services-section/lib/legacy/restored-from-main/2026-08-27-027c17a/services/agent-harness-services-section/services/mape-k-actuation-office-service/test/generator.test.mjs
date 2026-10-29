import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { allDutySkills, renderActuationOffice, renderDuties } from "../src/generator.mjs";

// The skills that ACTUALLY seat for Codex are the skill directories under its
// agents/skills/, not the generator's full catalog: the catalog may name a
// skill (monitor-evidence-replay) no provider has written yet, and passing
// allDutySkills() as existingSkills asserts a seating that does not exist.
function seatedCodexSkills(root) {
  return new Set(readdirSync(join(root, CODEX_ROOT, "agents/skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name));
}

const CODEX_ROOT =
  "lib/emsenn/services/561-group/services/rsc-quiescent/services/persistent-machines-services-section/services/bare-cedar-fog-services-section/services/bare-cedar-fog-codex-enterprise";

function repoRoot() {
  let dir = process.cwd();
  for (;;) {
    try {
      readFileSync(join(dir, CODEX_ROOT, "agents/offices/bare-cedar-fog-codex-actuation-office.json"));
      return dir;
    } catch {
      const parent = join(dir, "..");
      if (parent === dir) throw new Error("cannot locate repository root");
      dir = parent;
    }
  }
}

test("renderActuationOffice reproduces the seated Codex office's duty shape exactly", () => {
  const root = repoRoot();
  const seated = JSON.parse(readFileSync(join(root, CODEX_ROOT, "agents/offices/bare-cedar-fog-codex-actuation-office.json"), "utf8"));
  const allCodexSkills = seatedCodexSkills(root);
  const generated = renderActuationOffice({
    providerLabel: "Codex",
    actorUrn: "urn:ame:bare-cedar-fog-codex",
    surfaceLabel: "Codex in VS Code on Bare Cedar Fog",
    nodeId: "codex",
    jurisdiction: "bare-cedar-fog-codex-enterprise",
    partOf: "bare-cedar-fog-codex-enterprise",
    authorityScope: seated["authority-scope"],
    existingSkills: allCodexSkills,
    recordedBy: seated["x-provenance"]["recorded-by"],
    recordedOn: seated["x-provenance"]["recorded-on"],
  });

  assert.equal(generated.id, seated.id);
  assert.equal(generated["normative-structure"], seated["normative-structure"]);
  assert.deepEqual(generated["deontic-profile"], seated["deontic-profile"]);
  assert.deepEqual(generated["bears-duty"], seated["bears-duty"]);
  assert.deepEqual(generated["authority-scope"], seated["authority-scope"]);
});

test("renderDuties reproduces every seated Codex duty record exactly", () => {
  const root = repoRoot();
  const duties = renderDuties({ nodeId: "codex", existingSkills: seatedCodexSkills(root) });
  for (const duty of duties) {
    const seated = JSON.parse(readFileSync(join(root, CODEX_ROOT, "agents/duties", `${duty.id}.json`), "utf8"));
    assert.deepEqual(duty, seated, `duty ${duty.id} must match the seated Codex record exactly`);
  }
});

test("renderActuationOffice records an unrealized skill gap when a provider has no skills yet", () => {
  const generated = renderActuationOffice({
    providerLabel: "Claude",
    actorUrn: "urn:ame:bare-cedar-fog-claude",
    surfaceLabel: "Claude Code on Bare Cedar Fog",
    nodeId: "claude",
    jurisdiction: "bare-cedar-fog-claude-enterprise",
    partOf: "bare-cedar-fog-claude-enterprise",
    authorityScope: ["lib/emsenn/services/561-group/services/rsc-quiescent/services/persistent-machines-services-section/services/bare-cedar-fog-services-section/services/bare-cedar-fog-claude-enterprise/", "/home/emsenn/info/"],
    recordedOn: "2026-07-28",
  });
  assert.equal(generated.duties.every((d) => d.skills.length === 0), true);
  assert.equal(generated.unrealized.filter((u) => u.includes("names no skill")).length, 7);
});
