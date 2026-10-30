#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { appendObservation, identity } from "../src/enterprise.mjs";
import { semanticByteIdentity } from "../src/semiotic-circuit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_FILES = Object.freeze([
  "src/mape-office.mjs", "src/mape-office-mcp.mjs", "src/harness-parity.mjs",
  "src/source-pinned-analysis.mjs", "src/requirement-trajectory.mjs", "src/authority-bounded-integration.mjs", "src/fresh-verification.mjs", "src/agential-forms.mjs",
  "agents/harness/codex-harness-parity-baseline.json", "agents/harness/codex-agent-harness.json",
  "agents/actuators/source-pinned-analysis.json", "agents/actuators/requirement-trajectory.json", "agents/actuators/authority-bounded-integration.json", "agents/actuators/fresh-verification.json",
  "agents/actuators/character-face-composition.json", "agents/actuators/office-obligation-projection.json", "agents/actuators/immunitas-observation.json", "agents/actuators/capacity-fabrication-obligation.json",
  "test/mape-office.test.mjs", "test/harness-parity.test.mjs", "test/source-pinned-analysis.test.mjs", "test/requirement-trajectory.test.mjs", "test/authority-bounded-integration.test.mjs", "test/fresh-verification.test.mjs", "test/agential-forms.test.mjs",
]);
const TEST_FILES = CANDIDATE_FILES.filter((path) => path.startsWith("test/"));
function digest(bytes) { return semanticByteIdentity(bytes, "bare-cedar-fog-codex.harness-candidate-file").id; }
const startedAt = new Date().toISOString();
const processDigest = identity({ type: "FreshHarnessAssayProcess", pid: process.pid, startedAt });
const candidateFiles = CANDIDATE_FILES.map((path) => ({ path, digest: digest(readFileSync(resolve(ROOT, path))) }));
const candidateDigest = identity({ type: "CodexHarnessCandidateBundle", version: 1, files: candidateFiles });
const command = `${process.execPath} --test ${TEST_FILES.join(" ")}`;
const run = spawnSync(process.execPath, ["--test", ...TEST_FILES], { cwd: ROOT, encoding: "utf8" });
const transcript = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const redWitnessObserved = /same-process, wrong-digest, pre-materialization/u.test(transcript)
  && /missing, expired, byte-mismatched, and path-escaping authority/u.test(transcript);
const outcome = run.status === 0 && redWitnessObserved ? "passed" : "failed";
const completedAt = new Date().toISOString();
const body = {
  type: "FreshHarnessCandidateAssayReceipt", version: 1,
  provider: "urn:ame:bare-cedar-fog-codex-harness-observation",
  candidateDigest, candidateFiles, processDigest, authorExcludedFromCandidateProcess: true,
  command, startedAt, completedAt, outcome,
  artifacts: TEST_FILES.map((path) => ({ path, digest: candidateFiles.find((entry) => entry.path === path).digest })),
  oracleReview: { accepted: outcome === "passed", basis: "real-MCP-and-refusal-observations" },
  redWitness: { passed: false, observed: redWitnessObserved, basis: "same-process/wrong-digest assurance and missing/expired/scope-drift Execute controls were refused" },
  customerOutcome: null,
};
const receipt = Object.freeze({ id: identity(body), ...body });
if (process.argv.includes("--record")) appendObservation({ type: "HarnessCandidateAssayObserved", actor: "urn:ame:bare-cedar-fog-codex", receipt: receipt.id, candidateDigest, processDigest, outcome, observedAt: completedAt });
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (outcome !== "passed") process.exitCode = 1;
