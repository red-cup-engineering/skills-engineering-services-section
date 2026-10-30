#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inventoryCodexHarness } from "../src/harness-lifecycle.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function repositoryRoot() {
  let current = PACKAGE_ROOT;
  while (true) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot locate repository root");
    current = parent;
  }
}
export function inventoryInstalledCodexHarness({ repoRoot = repositoryRoot(), lifecycleRoot = PACKAGE_ROOT } = {}) { return inventoryCodexHarness({ repoRoot, lifecycleRoot }); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(inventoryInstalledCodexHarness(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`inventory-codex-harness: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
