import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const RECEIPT = /^(?:urn:sha256:|ni:\/\/\/sha-256;)[A-Za-z0-9_-]+$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const NOTE_PROOF_PATH = /^content\/documents\/articles\/notes\/(\d{4})\/(\d{2})\/(\d{2})\/[^/]+\.md$/u;
function text(value, field, maximum = 12_000) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) throw new TypeError(`${field} must be 1-${maximum} characters`);
  return value.trim();
}
function receipt(value, field) {
  if (!value || typeof value !== "object" || !RECEIPT.test(value.id ?? "")) throw new TypeError(`${field} must be a content-addressed receipt`);
  return value;
}
function requirePort(ports, name) { if (typeof ports?.[name] !== "function") throw new TypeError(`ports.${name} must be a function`); return ports[name]; }
function bind(value, field, expected) { if (value?.[field] !== expected) throw new Error(`${value?.type ?? "receipt"}.${field} is not bound to the claim`); }
function noteProofPath(value) {
  const path = text(value, "targetProofPath", 4096), match = NOTE_PROOF_PATH.exec(path);
  if (!match || path.includes("..")) throw new TypeError("targetProofPath must be a canonical dated note proof path");
  const date = `${match[1]}-${match[2]}-${match[3]}`, instant = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) throw new TypeError("targetProofPath must contain a real calendar date");
  return path;
}

/**
 * Execute the Studio-output-to-actuator proof path without granting Gemini Notebook
 * any publication, truth, or actuator authority of its own. The canonical
 * filesystem proof path remains a mandatory, identity-bearing claim field.
 *
 * Every effect is a supplied service port so this composition can run behind
 * the deployed Gemini Notebook provider and remote actuator faces. Local filesystem
 * materialization is one possible deposit port, not the orchestration runtime.
 */
export async function actuateStudioNote(rawClaim, ports) {
  const claim = Object.freeze({
    type: "GeminiNotebookStudioNoteActuationClaim",
    version: 1,
    notebookRef: text(rawClaim?.notebookRef, "notebookRef", 240),
    sourceSetReceipt: receipt(rawClaim?.sourceSetReceipt, "sourceSetReceipt").id,
    prompt: text(rawClaim?.prompt, "prompt"),
    studioType: rawClaim?.studioType ?? "report",
    targetActuator: text(rawClaim?.targetActuator, "targetActuator", 1000),
    targetCell: text(rawClaim?.targetCell, "targetCell", 1000),
    targetProofPath: noteProofPath(rawClaim?.targetProofPath),
    resourceBudgetAuthorization: receipt(rawClaim?.resourceBudgetAuthorization, "resourceBudgetAuthorization").id,
    custodyAuthorization: receipt(rawClaim?.custodyAuthorization, "custodyAuthorization").id,
  });
  if (claim.studioType !== "report") throw new TypeError("the note actuator currently admits only report Studio carriers");
  const claimId = semanticId(claim);

  const offer = receipt(await requirePort(ports, "offerStudio")({ claimId, claim }), "Studio offer");
  bind(offer, "claimId", claimId);
  const generation = receipt(await requirePort(ports, "generateStudio")({ claimId, claim, offer }), "generation receipt");
  bind(generation, "claimId", claimId);
  const settled = receipt(await requirePort(ports, "settleStudio")({ claimId, claim, offer, generation }), "settled artifact receipt");
  bind(settled, "claimId", claimId);
  if (settled.mediaType !== "text/markdown" || !SHA256.test(settled.sha256 ?? "")) throw new Error("settled Studio carrier must be digest-bound Markdown");

  const custody = receipt(await requirePort(ports, "condenseCarrier")({ claimId, claim, settled }), "custody receipt");
  bind(custody, "sha256", settled.sha256);
  const assay = receipt(await requirePort(ports, "assayCarrier")({ claimId, claim, settled, custody }), "assay receipt");
  bind(assay, "claimId", claimId);
  if (assay.disposition !== "admissible") throw new Error(`assay did not admit carrier: ${assay.disposition ?? "unknown"}`);
  const admission = receipt(await requirePort(ports, "admitCarrier")({ claimId, claim, settled, custody, assay }), "carrier admission receipt");
  bind(admission, "claimId", claimId);
  bind(admission, "targetCell", claim.targetCell);
  bind(admission, "targetProofPath", claim.targetProofPath);
  const authority = receipt(await requirePort(ports, "authorizeActuation")({ claimId, claim, admission }), "actuation authority receipt");
  bind(authority, "claimId", claimId);
  bind(authority, "targetActuator", claim.targetActuator);
  const deposit = receipt(await requirePort(ports, "depositCarrier")({ claimId, claim, settled, custody, assay, admission, authority }), "deposit receipt");
  bind(deposit, "claimId", claimId);
  bind(deposit, "targetCell", claim.targetCell);
  bind(deposit, "targetProofPath", claim.targetProofPath);
  const readback = receipt(await requirePort(ports, "readbackDeposit")({ claimId, claim, settled, deposit }), "readback receipt");
  bind(readback, "claimId", claimId);
  bind(readback, "sha256", settled.sha256);
  bind(readback, "targetProofPath", claim.targetProofPath);

  const body = { type: "GeminiNotebookStudioNoteActuationReceipt", version: 1, claimId, disposition: "settled", notebookRef: claim.notebookRef, sourceSetReceipt: claim.sourceSetReceipt, targetActuator: claim.targetActuator, targetCell: claim.targetCell, targetProofPath: claim.targetProofPath, carrierSha256: settled.sha256, receiptPath: [offer.id, generation.id, settled.id, custody.id, assay.id, admission.id, authority.id, deposit.id, readback.id], authority: "receipted-composition-only" };
  return Object.freeze({ id: semanticId(body), ...body });
}
