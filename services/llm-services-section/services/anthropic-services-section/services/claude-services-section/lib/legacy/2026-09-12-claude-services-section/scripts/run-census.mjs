#!/usr/bin/env node
// Census: re-run every target's own verification command and record the
// observed exit statuses as dated log records (never read from a report;
// concept-of-operations §2.3, the-distal-bypass). Red is recorded, never
// smoothed: it always completes and writes; exit is 0 when all targets are
// green, 3 if any is red, 1 on its own failure to run. Records go through
// createSemanticRecordJournal (data/logs/YYYY/MM/DD/*.jsonl), per the
// 2026-08-27 canonical-seavt-logging-and-journal-kernel reference.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semantic-record-journal-service";

const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = "bare-cedar-fog-claude-services-section";
export const OBJECT_KIND = "bare-cedar-fog-claude-services-section.census-record";

export function repoRoot() {
  let dir = NODE_ROOT;
  for (;;) {
    if (existsSync(join(dir, ".mcp.json")) && existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("census: cannot locate repository root");
    dir = parent;
  }
}

export function validateTargets(targets) {
  if (!Array.isArray(targets)) {
    throw new Error('census: census-targets.json must have a "targets" array');
  }
  for (const target of targets) {
    if (!target.id || !target.path || !Array.isArray(target.command) || target.command.length === 0) {
      throw new Error(
        `census: malformed target entry (needs id, path, and a nonempty command array): ${JSON.stringify(target)}`,
      );
    }
  }
  return targets;
}

export function runCensus({
  root = repoRoot(),
  targets,
  unit = UNIT,
  journalRoot = NODE_ROOT,
} = {}) {
  validateTargets(targets);
  const startedAt = new Date();
  const results = [];

  for (const target of targets) {
    const cwd = join(root, target.path);
    const t0 = Date.now();
    let exit = null;
    let error = null;
    if (!existsSync(cwd)) {
      error = "target path does not exist";
    } else {
      const run = spawnSync(target.command[0], target.command.slice(1), {
        cwd,
        timeout: 300_000,
        stdio: ["ignore", "ignore", "pipe"],
        env: process.env,
      });
      exit = run.status;
      if (run.error) error = String(run.error.message ?? run.error);
      else if (run.status !== 0) error = String(run.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 500);
    }
    const record = {
      type: "CensusTargetObservation",
      census: startedAt.toISOString(),
      target: target.id,
      path: target.path,
      command: target.command.join(" "),
      exit,
      green: exit === 0,
      wallMs: Date.now() - t0,
      observedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    results.push(record);
    process.stderr.write(`${record.green ? "green" : "RED  "} ${target.id} exit=${exit} ${record.wallMs}ms\n`);
  }

  const journal = createSemanticRecordJournal({ root: journalRoot, objectKind: OBJECT_KIND });
  for (const record of results) {
    journal.record({ category: `${unit}.census-target-observation`, recordedAt: record.observedAt, record, charge: { support: true, refutation: false } });
  }

  const red = results.filter((r) => !r.green);
  const summary = {
    type: "CensusRun",
    census: startedAt.toISOString(),
    unit,
    targets: results.length,
    green: results.length - red.length,
    red: red.map((r) => r.target),
    root: journal.root,
  };
  journal.record({ category: `${unit}.census-run-summary`, recordedAt: startedAt.toISOString(), record: summary, charge: { support: true, refutation: false } });
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const targetsRecord = JSON.parse(
    readFileSync(join(NODE_ROOT, "content", "harness", "census-targets.json"), "utf8"),
  );
  const root = repoRoot();
  const summary = runCensus({ root, targets: targetsRecord.targets });
  summary.root = summary.root.startsWith(root) ? summary.root.slice(root.length + 1) : summary.root;
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  process.exit(summary.red.length ? 3 : 0);
}
