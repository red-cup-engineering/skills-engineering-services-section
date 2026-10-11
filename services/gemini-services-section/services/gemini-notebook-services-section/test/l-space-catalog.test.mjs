import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLiveNotebookLspaceCatalog } from "../src/notebook-library-market.mjs";

test("a live L-space catalog holds provider locators only in its ephemeral resolver", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "notebook-l-space-catalog-"));
  const python = join(root, "python");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(python, `#!/bin/sh
if [ "$3" = list ]; then
  echo '{"notebooks":[{"id":"private-notebook-id","title":"Private notebook"}]}'
else
  echo '{"sources":[{"id":"private-source-id","type":"markdown","title":"Sensitive source title"}]}'
fi
`, { mode: 0o755 });
  const result = createLiveNotebookLspaceCatalog({}, { python, now: "2026-07-29T00:00:00.000Z" });
  assert.equal(result.disposition, "observed");
  assert.match(result.id, /^ni:\/\/\/sha-256;/u); assert.match(result.inputNi, /^ni:\/\/\/sha-256;/u);
  assert.doesNotMatch(JSON.stringify(result.catalog), /private-notebook-id|private-source-id|Sensitive source title/u);
  const notebook = result.catalog.notebooks[0];
  const binding = await result.resolvePrivateBinding({ notebookRefNi: notebook.notebookRefNi, sourceSetNi: notebook.sourceSetNi });
  assert.equal(binding.notebookId, "private-notebook-id");
});

test("a provider process error remains an error with its canonical request coordinate", () => {
  assert.throws(() => createLiveNotebookLspaceCatalog({}, { python: "/definitely/absent/python", now: "2026-07-29T00:00:00.000Z" }), (error) => /^ni:\/\/\/sha-256;/u.test(error.inputNi));
});
