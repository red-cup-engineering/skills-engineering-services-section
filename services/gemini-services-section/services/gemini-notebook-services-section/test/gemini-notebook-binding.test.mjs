import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ACTOR, NOTEBOOK_ID, formNotebookBindingCandidate, readNotebookBinding } from "../scripts/gemini-notebook-binding.mjs";

test("reads the exact bound Gemini notebook without granting an effect", () => {
  const binding = readNotebookBinding();
  assert.equal(binding.actor, ACTOR);
  assert.equal(binding.notebookId, NOTEBOOK_ID);
  assert.match(binding.creationReceipt, /^urn:sha256:/u);
  const candidate = formNotebookBindingCandidate(binding.url);
  assert.equal(candidate.notebookId, NOTEBOOK_ID);
  assert.deepEqual(candidate.authorityGranted, []);
});

test("refuses non-Gemini Notebook URLs and malformed stored bindings", (t) => {
  assert.throws(() => formNotebookBindingCandidate("https://example.com/notebook/67510ce7-79b3-4caa-b25c-28e0d3911b5a"), /exact Gemini Notebook/u);
  const directory = mkdtempSync(join(tmpdir(), "gemini-notebook-binding-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "binding.json");
  writeFileSync(path, JSON.stringify({ type: "GeminiNotebookBoundNotebook", status: "bound", actor: ACTOR, notebookId: NOTEBOOK_ID, url: "https://example.com", creationReceipt: "urn:sha256:de9adee854c804bd1aec1fb7297cd68a562d8d4601f0736980841d79e24b28c4" }));
  assert.throws(() => readNotebookBinding(path), /malformed/u);
});
