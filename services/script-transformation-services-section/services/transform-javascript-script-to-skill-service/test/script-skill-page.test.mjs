import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deriveScriptSkillPage } from "../src/transform-javascript-script-to-skill.mjs";

const commit = "d".repeat(40);
const code = description => "#!/usr/bin/env node\n/**\n * @description " + description + "\n * @param {object} input - admitted parameters\n * @returns {object} the reading\n */\nexport function read(input) { return input; }\n";
const entry = (file, source = code("Reconcile cash receipts for an agent customer")) => ({
  repository: "red-cup-engineering/sample-engineering-service",
  path: "src/" + file, commit, source,
  sha256: createHash("sha256").update(source, "utf8").digest("hex"),
});
test("one selected real script carries a source witness but no authority, installation or sale", () => {
  const result = deriveScriptSkillPage([entry("reconcile-cash.mjs")], {query:"reconcile cash"});
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].name,"reconcile-cash");
  assert.equal(result.candidates[0].source.gitMembershipVerified,false);
  assert.equal(result.candidates[0].coesiteSkillEnacted,false);
  assert.equal(result.candidates[0].actorAuthorized,false);
  assert.equal(result.candidates[0].installedInHarness,false);
  assert.equal(result.candidates[0].paidByCustomer,false);
  assert.equal(result.coverage.queryMatches,1);
  assert.equal(result.complete,true);
});
test("100000 source observations page without materializing 100000 skills", () => {
  const reference = code("Compute one reusable customer observation");
  const digest = createHash("sha256").update(reference).digest("hex");
  function* population() {
    for (let i=0;i<100000;i++) yield {
      repository:"red-cup-engineering/sample-engineering-service",
      path:"src/compute-" + String(i).padStart(6,"0") + ".mjs",
      commit,source:reference,sha256:digest
    };
  }
  const first=deriveScriptSkillPage(population(),{query:"compute",limit:12});
  assert.equal(first.coverage.examined,100000);
  assert.equal(first.coverage.validScriptDeclarations,100000);
  assert.equal(first.coverage.queryMatches,100000);
  assert.equal(first.candidates.length,12);
  assert.equal(first.candidates.at(-1).name,"compute-000011");
  assert.equal(first.complete,false);
  const next=deriveScriptSkillPage(population(),{query:"compute",limit:12,after:first.nextAfter});
  assert.equal(next.candidates.length,12);
  assert.equal(next.candidates[0].name,"compute-000012");
  assert.equal(next.coverage.examined,100000);
});
test("non-header JSDoc, wrong hash, unknown declarations and absent descriptions stay held", () => {
  const rows=[
    entry("a-nonheader.mjs","const privateFunction = () => 5;\n/** @description unrelated function */"),
    entry("b-unknown.mjs","/**\n * @description carries hidden effect\n * @secret-start payment\n */\n"),
    entry("c-nodescription.mjs","/**\n * @param {number} n - count\n */\n"),
    {...entry("d-mismatch.mjs"),sha256:"0".repeat(64)},
    entry("e-valid.mjs")
  ];
  const result=deriveScriptSkillPage(rows);
  assert.equal(result.candidates.length,1);
  assert.equal(result.coverage.refused,4);
  assert.equal(result.coverage.validScriptDeclarations,1);
  assert.deepEqual(result.coverage.refusalExamples.map(x=>x.reason),[
    "no-leading-script-declaration","unrecognized-or-incomplete-jsdoc",
    "no-task-description","source-digest-mismatch"
  ]);
});
test("source order, duplicate paths, traversal and unbounded reads refuse", () => {
  const a=entry("alpha.mjs"), b=entry("beta.mjs");
  assert.throws(()=>deriveScriptSkillPage([b,a]),/source-sorted/);
  assert.throws(()=>deriveScriptSkillPage([a,a]),/source-sorted/);
  assert.throws(()=>deriveScriptSkillPage([{...a,path:"src/../../office.mjs"}]),/canonical path/);
  assert.throws(()=>deriveScriptSkillPage([{...a,repository:"coesite-operations/operations-services-section"}]),/Engineering repository/);
  assert.throws(()=>deriveScriptSkillPage([a],{limit:1000}),/bounded query/);
});
