#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarizeHarnessLifecycle } from "../src/harness-lifecycle.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function summarizeHarnessLifecycleUsage({ root = PACKAGE_ROOT } = {}) { return summarizeHarnessLifecycle({ root }); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(summarizeHarnessLifecycleUsage(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`summarize-harness-lifecycle: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
