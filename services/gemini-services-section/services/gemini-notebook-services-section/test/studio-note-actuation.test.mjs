import test from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "@red-cup-engineering/cryptographic-data-service/integrity";
import { actuateStudioNote } from "../src/studio-note-actuation.mjs";

const rid = (value) => `urn:sha256:${sha256Hex(value)}`;
const authorization = (name) => ({ id: rid(name) });
function ports(log, disposition = "admissible") {
  const step = (name, extra = {}) => async ({ claimId, claim, settled }) => { log.push(name); return { id: rid(`${name}:${claimId}`), claimId, ...extra, ...(name === "custody" ? { sha256: settled.sha256 } : {}), ...(name === "authority" ? { targetActuator: claim.targetActuator } : {}), ...(["admission", "deposit"].includes(name) ? { targetCell: claim.targetCell } : {}), ...(["admission", "deposit", "readback"].includes(name) ? { targetProofPath: claim.targetProofPath } : {}) }; };
  return { offerStudio: step("offer"), generateStudio: step("generation"), settleStudio: step("settled", { mediaType: "text/markdown", sha256: `sha256:${"a".repeat(64)}` }), condenseCarrier: step("custody"), assayCarrier: step("assay", { disposition }), admitCarrier: step("admission"), authorizeActuation: step("authority"), depositCarrier: step("deposit"), readbackDeposit: step("readback", { sha256: `sha256:${"a".repeat(64)}` }) };
}
const claim = { notebookRef: "ni:///sha-256;notebook", sourceSetReceipt: authorization("sources"), prompt: "Produce a cited report.", targetActuator: "https://actuator.example/a2a", targetCell: "urn:cell:notes", targetProofPath: "content/documents/articles/notes/2026/07/29/2026-07-29-report.md", resourceBudgetAuthorization: authorization("budget"), custodyAuthorization: authorization("custody") };

test("settles the complete Studio-to-actuator proof path in order", async () => {
  const log = [], result = await actuateStudioNote(claim, ports(log));
  assert.equal(result.disposition, "settled");
  assert.equal(result.receiptPath.length, 9);
  assert.equal(result.targetProofPath, claim.targetProofPath);
  assert.deepEqual(log, ["offer", "generation", "settled", "custody", "assay", "admission", "authority", "deposit", "readback"]);
});

test("refuses a claim without a canonical dated note proof path", async () => {
  await assert.rejects(() => actuateStudioNote({ ...claim, targetProofPath: "report.md" }, ports([])), /canonical dated note proof path/u);
});

test("stops before admission and actuation when assay refuses", async () => {
  const log = [];
  await assert.rejects(() => actuateStudioNote(claim, ports(log, "refused")), /did not admit/u);
  assert.deepEqual(log, ["offer", "generation", "settled", "custody", "assay"]);
});
