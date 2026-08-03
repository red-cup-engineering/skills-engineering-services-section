import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assayTypedInferenceCandidate, projectTypedInferenceCandidate } from "../src/customer-assay-typed-inference.mjs";

function procurement(text) { return { type: "TypedRmnInferenceProcurement", disposition: "candidate-pending-customer-assay", demand: { outputContract: { schema: { type: "object", required: ["class", "basis"], properties: { class: { type: "string" }, basis: { type: "string" } }, additionalProperties: false } } }, selection: { selected: { provider: { actor: "urn:ame:provider" } } }, settlement: { protocol: "A2A", protocolVersion: "1.0", completion: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", disposition: "completion", candidate: text } }; }
const ROOT = resolve(import.meta.dirname, "..");
function options(dataRoot) {
  return {
    customer: "urn:ame:inference-work-lot-service",
    customerServices: { witnessJournal: { actor: "urn:ame:test-witness-journal", agentCard: "https://witness-journal.invalid/.well-known/agent-card.json" } },
    settlementRoot: ROOT,
    dataRoot,
    store: {
      actor: "urn:ame:inference-work-lot-service",
      async record({ record }) {
        return { documentNi: record.id, digest: record.id, reference: { profile: "org.lenticule-science.witness-journal-network-custody.v1" } };
      },
    },
  };
}

test("customer independently accepts a schema-conformant provider candidate", async () => {
  const assay = await assayTypedInferenceCandidate(procurement('{"class":"residue","basis":"no deterministic cover"}'), options(mkdtempSync(`${tmpdir()}/assay-`)));
  assert.equal(assay.accepted, true); assert.deepEqual(assay.problems, []); assert.equal(assay.providerSelfAttestation, false); assert.equal(assay.customer, "urn:ame:inference-work-lot-service");
  assert.deepEqual(assay.candidateValue, { class: "residue", basis: "no deterministic cover" });
});

test("customer deterministically projects one schema-valid result after provider reasoning", async () => {
  const raw = `I need to inspect the failure before choosing the action.

\`\`\`json
{"class":"residue","basis":"the exact transition has no deterministic cover"}
\`\`\`

That is the bounded result.`;
  const assay = await assayTypedInferenceCandidate(procurement(raw), options(mkdtempSync(`${tmpdir()}/assay-`)));
  assert.equal(assay.accepted, true);
  assert.deepEqual(assay.candidateValue, { class: "residue", basis: "the exact transition has no deterministic cover" });
  assert.equal(assay.carrierProjection.carrier, "fenced-block");
  assert.equal(assay.carrierProjection.type, "DeterministicInferenceCarrierProjection");
  assert.equal(assay.carrierProjection.validCandidateCount, 1);
  assert.notEqual(assay.providerOutput, assay.candidate);
});

test("an explicit fenced tool-call pore exposes exactly one customer-validated action", async () => {
  const item = procurement(`The analysis may contain examples such as {"class":"example"}.

\`\`\`json
{"class":"residue","basis":"the dry boundary contains one observable action"}
\`\`\``);
  item.demand.outputContract.format = "projected";
  item.demand.outputContract.projection = { type: "fenced-json-tool-call" };
  const assay = await assayTypedInferenceCandidate(item, options(mkdtempSync(`${tmpdir()}/assay-`)));
  assert.equal(assay.accepted, true);
  assert.deepEqual(assay.candidateValue, { class: "residue", basis: "the dry boundary contains one observable action" });
  assert.equal(assay.carrierProjection.carrier, "fenced-json-tool-call");
});

test("customer constructs a declared create action from one natural source carrier", async () => {
  const path = "src/priced-capability-boundary.mjs";
  const item = procurement("Reasoning stays outside the carrier.\n\n```js\nexport const boundary = () => 'settled';\n```\n");
  item.demand.outputContract = {
    format: "projected",
    projection: { type: "single-file-create", path },
    schema: {
      type: "object",
      required: ["action", "args"],
      properties: {
        action: { const: "create" },
        args: {
          type: "object",
          required: ["path", "content"],
          properties: { path: { const: path }, content: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  };
  const assay = await assayTypedInferenceCandidate(item, options(mkdtempSync(`${tmpdir()}/assay-`)));
  assert.equal(assay.accepted, true);
  assert.deepEqual(assay.candidateValue, {
    action: "create",
    args: { path, content: "export const boundary = () => 'settled';\n" },
  });
  assert.equal(assay.carrierProjection.carrier, "fenced-source-block");
});

test("customer constructs an acceptance artifact carrier from natural test source", async () => {
  const path = "union-acceptance/behavior.test.mjs";
  const item = procurement("```js\nimport test from 'node:test';\ntest('behavior', () => {});\n```\n");
  item.demand.outputContract = {
    format: "projected",
    projection: { type: "single-source-artifact", path },
    schema: {
      type: "object", required: ["artifact", "rationale"],
      properties: {
        artifact: {
          type: "object", required: ["path", "text"],
          properties: { path: { const: path }, text: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        rationale: { type: "string", minLength: 20 },
      },
      additionalProperties: false,
    },
  };
  const assay = await assayTypedInferenceCandidate(item, options(mkdtempSync(`${tmpdir()}/assay-`)));
  assert.equal(assay.accepted, true);
  assert.equal(assay.candidateValue.artifact.path, path);
  assert.match(assay.candidateValue.artifact.text, /test\('behavior'/u);
});

test("customer selects the sole schema-valid value among reasoning examples", () => {
  const schema = procurement("{}").demand.outputContract.schema;
  const projected = projectTypedInferenceCandidate(
    'An intermediate shape was {"class":"example"}. The result is {"class":"residue","basis":"exact witness"}.',
    schema,
  );
  assert.deepEqual(projected.value, { class: "residue", basis: "exact witness" });
  assert.equal(projected.validCandidateCount, 1);
});

test("customer refuses two distinct schema-valid projections as ambiguous", async () => {
  const assay = await assayTypedInferenceCandidate(
    procurement('Either {"class":"residue","basis":"first"} or {"class":"residue","basis":"second"}.'),
    options(mkdtempSync(`${tmpdir()}/assay-`)),
  );
  assert.equal(assay.accepted, false);
  assert.match(assay.problems[0], /projection-ambiguous/u);
});

test("customer deterministically compiles witnessed provider tool-call carriers", () => {
  const schema = {
    type: "object",
    required: ["action", "args"],
    properties: {
      action: { type: "string", const: "read" },
      args: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string", const: "src/improvement-board-forager.mjs" } },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
  for (const raw of [
    "I need to examine the current source.<tool_call>read<arg_key>path</arg_key><arg_value>src/improvement-board-forager.mjs</arg_value></tool_call>",
    'Let me read the current source:<tool_call>read {path: "src/improvement-board-forager.mjs"}',
    'I selected the provider tool.<tool_call>read_file {"path":"src/improvement-board-forager.mjs"}</tool_call>',
  ]) {
    const projected = projectTypedInferenceCandidate(raw, schema);
    assert.deepEqual(projected.value, { action: "read", args: { path: "src/improvement-board-forager.mjs" } });
    assert.equal(projected.carrier, "provider-tool-call");
    assert.equal(projected.validCandidateCount, 1);
  }
});

test("provider tool-call projection never evaluates code-shaped arguments", () => {
  const schema = {
    type: "object",
    required: ["action", "args"],
    properties: { action: { const: "read" }, args: { type: "object" } },
    additionalProperties: false,
  };
  const projected = projectTypedInferenceCandidate(
    '<tool_call>read {path: process.exit(1)}',
    schema,
  );
  assert.equal(projected.value, null);
  assert.match(projected.problem, /not-json/u);
});

test("customer refuses malformed or schema-incomplete provider candidates", async () => {
  const root = mkdtempSync(`${tmpdir()}/assay-`);
  const malformed = await assayTypedInferenceCandidate(procurement('{"class": // no}'), options(root));
  const incomplete = await assayTypedInferenceCandidate(procurement('{"class":"residue"}'), options(root));
  assert.equal(malformed.accepted, false); assert.match(malformed.problems[0], /not-json/u);
  assert.equal(incomplete.accepted, false); assert.equal(incomplete.problems.some((problem) => problem.includes("required")), true);
});

test("schema residue identifies the exact forbidden property for prompt refinement", async () => {
  const assay = await assayTypedInferenceCandidate(
    procurement('{"class":"residue","basis":"exact witness","commentary":"remove me"}'),
    options(mkdtempSync(`${tmpdir()}/assay-`)),
  );
  assert.deepEqual(assay.problems, [
    '$:additionalProperties:must NOT have additional properties:{"additionalProperty":"commentary"}',
  ]);
});
