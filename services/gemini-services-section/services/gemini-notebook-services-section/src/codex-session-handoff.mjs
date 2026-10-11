#!/usr/bin/env node
/** Write a bounded handoff that a later session can read before re-reasoning. */
import { dirname, resolve } from "node:path";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { writeFileTextSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";

const LIMIT = 12 * 1024;
function required(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }
function clipped(value) { return value.length <= 2600 ? value : `${value.slice(0, 2599)}…`; }
export function renderCodexSessionHandoff({ demand, corrections, changedPaths, verification, nextAction }) {
  const paths = Array.isArray(changedPaths) ? changedPaths.filter((path) => typeof path === "string" && path.trim()) : [];
  const document = ["# Codex session handoff", "", "## Current demand", "", clipped(required(demand, "demand")), "", "## Binding corrections", "", clipped(required(corrections, "corrections")), "", "## Changed paths", "", ...(paths.length ? paths.map((path) => `- ${path}`) : ["- None"]), "", "## Fresh verification", "", clipped(required(verification, "verification")), "", "## Next exact action", "", clipped(required(nextAction, "nextAction")), ""].join("\n");
  if (Buffer.byteLength(document) > LIMIT) throw new Error("handoff exceeds the 12 KiB context budget");
  return document;
}
export function writeCodexSessionHandoff(input, path) {
  const target = resolve(required(path, "path")); const document = renderCodexSessionHandoff(input);
  writeFileTextSync(target, document, { mode: 0o600 });
  return Object.freeze({ path: target, byteLength: Buffer.byteLength(document) });
}
if (import.meta.main) {
  const paths = argument("--changed")?.split(",").filter(Boolean) ?? [];
  const output = argument("--output") ?? process.env.GEMINI_NOTEBOOK_HANDOFF_OUTPUT;
  if (!output) throw new Error("--output or GEMINI_NOTEBOOK_HANDOFF_OUTPUT is required; provider custody must be explicit");
  const result = writeCodexSessionHandoff({ demand: argument("--demand"), corrections: argument("--corrections"), changedPaths: paths, verification: argument("--verification"), nextAction: argument("--next") }, output);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
