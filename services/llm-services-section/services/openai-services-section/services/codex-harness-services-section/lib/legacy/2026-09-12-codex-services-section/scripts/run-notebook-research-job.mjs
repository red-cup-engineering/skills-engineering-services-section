#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { notebookResearchJobBoard, settleNotebookResearchJob } from "../src/notebook-research-jobs.mjs";

const jobId = process.argv[2];
if (!jobId) throw new Error("usage: run-notebook-research-job.mjs <NotebookResearchJobOpened id>");
const job = notebookResearchJobBoard().find((entry) => entry.id === jobId);
if (!job) throw new Error("unknown NotebookLM research job");
if (job.state !== "queued") throw new Error(`research job is already ${job.state}`);

function repositoryRoot() {
  let current = dirname(fileURLToPath(import.meta.url));
  while (dirname(current) !== current) {
    if (existsSync(join(current, "lib", "emsenn"))) return current;
    current = dirname(current);
  }
  throw new Error("cannot locate repository root");
}
const repository = repositoryRoot();
const command = resolve(repository, "lib/emsenn/services/561-group/services/red-cup-engineering/services/software-services-section/services/inference-services-section/services/llm-services-section/services/openai-services-section/services/codex-harness-services-section/skills/notebooklm-network-consultation/scripts/consult-network-notebooklm.sh");
const args = [command, job.match, job.question, "--artifact", job.artifactType, "--limit", String(job.sourceLimit)];
if (job.resultSchema) args.push("--schema", job.resultSchema);
const run = spawnSync("bash", args, { cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (run.error) throw run.error;
if (run.status !== 0) throw new Error(run.stderr || run.stdout || `NotebookLM runner exited ${run.status}`);
const result = JSON.parse(run.stdout);
if (typeof result.seated !== "string") throw new Error("NotebookLM runner returned no seated exchange path");
const settlement = settleNotebookResearchJob({ job: job.id, exchangePath: result.seated, observedAt: new Date().toISOString() });
process.stdout.write(`${JSON.stringify({ job: job.id, exchange: result.seated, outcome: result.outcome, settlement }, null, 2)}\n`);
