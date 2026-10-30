import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, ".claude/workflows/understand-verify.js"))) {
  const parent = dirname(root);
  if (parent === root) throw new Error("workflow owner not found");
  root = parent;
}
const source = readFileSync(join(root, ".claude/workflows/understand-verify.js"), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("args", "phase", "parallel", "agent", "pipeline", "log",
  source.replace("export const meta =", "const meta ="));

function finding(title, kind = "semantic-distinction") {
  return { title, kind, file: "src/subject.mjs:1", evidence: "observed implementation",
    proposal: "Examine the claimed distinction", advances_outcome: "Correct shared semantics", priority: "P1" };
}

async function assay(findings, verdicts) {
  const calls = [];
  let index = 0;
  const result = await run({ dimensions: [{ key: "semantics", prompt: "Examine the source question." }] },
    () => {}, tasks => Promise.all(tasks.map(task => task())),
    async (prompt, options) => {
      calls.push({ prompt, options });
      if (options.phase === "Read") return { dimension: "semantics", summary: "Source questions", findings };
      const verdict = verdicts[index++];
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
    (items, action) => Promise.all(items.map(action)), () => {});
  return { result, calls };
}

test("routes current-source refutation, computed support, and unresolved research separately", async () => {
  const cellPath = "lib/emsenn/services/561-group/services/science-services-section/services/information-science-services-section/services/math-services-section/services/obsmetrological-services-section/lib/obsmetrologia/Obsmetrologia/Articulation/Articulating/Cell.lean";
  const cell = readFileSync(join(root, cellPath), "utf8");
  assert.match(cell, /false, false => absurd/);
  assert.match(cell, /true,\s+true\s+=> stable/);
  const encode = value => Buffer.from(value, "utf8").toString("hex");
  const decode = value => Buffer.from(value, "hex").toString("utf8");
  assert.equal(encode("é"), "c3a9");
  assert.equal(decode("c3a9"), "é");
  assert.notEqual(encode("c3a9"), decode("c3a9"));
  const { result, calls } = await assay([
    finding("The rotated FOUR names match current Lean"),
    finding("UTF8-to-hex and hex-to-UTF8 are different transformations"),
    finding("Must subject marks automatically create valuation witnesses?", "research-question"),
  ], [
    { status: "refuted", reason: "Current ofStatus gives absurd for neither and stable for both.",
      evidence: [cellPath + ":25-31; ofStatus definition"], corrected_finding: "Correct the old rotation." },
    { status: "supported", reason: "The operations differ on the same input.",
      evidence: ["Node Buffer witness: encode('c3a9')=63336139; decode('c3a9')=é."], corrected_finding: "" },
    { status: "unresolved", reason: "Which admitted valuation contract requires an automatic witness?",
      evidence: [], corrected_finding: "" },
  ]);
  assert.equal(result.refuted.length, 1);
  assert.match(result.refuted[0].evidence[0], /Cell\.lean/);
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].verificationEvidence.length, 1);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].kind, "research-question");
  assert.match(result.unresolved[0].reason, /valuation contract/);
  assert.equal(calls.length, 4, "one reader and one verifier per finding, no extra inference stage");
  assert.ok(calls[0].options.schema.properties.findings.items.properties.kind.enum.includes("semantic-distinction"));
  assert.match(calls[1].prompt, /historical behavior and differential parity are observations/);
});

test("null, invalid, and unsupported verdicts retain their finding as unresolved", async () => {
  const verdicts = [null, {}, { refuted: true, reason: "old boolean protocol" },
    { status: "supported", reason: "only parity", evidence: [] },
    { status: "refuted", reason: "no source", evidence: [""] },
    { status: "supported", evidence: ["source:1"] },
    { status: "supported", reason: "source checked", evidence: ["source:1"], corrected_finding: 7 }];
  const { result } = await assay(verdicts.map((_, index) => finding("Claim " + index)), verdicts);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.refuted.length, 0);
  assert.equal(result.unresolved.length, verdicts.length);
});

test("an unavailable verifier retains the research question", async () => {
  const { result } = await assay([finding("Source question")], [new Error("provider unavailable")]);
  assert.equal(result.unresolved.length, 1);
  assert.match(result.unresolved[0].reason, /provider unavailable/);
  assert.equal(result.refuted.length, 0);
});
