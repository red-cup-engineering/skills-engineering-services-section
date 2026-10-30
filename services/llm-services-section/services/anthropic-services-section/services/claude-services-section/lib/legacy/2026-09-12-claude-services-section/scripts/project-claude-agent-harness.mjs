#!/usr/bin/env node
// Thin parameterization: this enterprise supplies only its policy
// (content/harness/claude-agent-harness.json) and the shared incumbencies
// directory it seats colleagues from. All seating verification and
// projection logic is the canonical projection-service dependency's (owner
// ruling 2026-09-04: seating verification lives once upstream of both
// harness drivers); this script never writes an agent file itself.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkExactRoster, projectClaudeHarness, verifySeatings } from "@red-cup-engineering/claude-harness-projection-service";
import { checkManagedEngineeringMethod, checkManagedOperatingPosture, installManagedEngineeringMethod, installManagedOperatingPosture } from "@red-cup-engineering/agent-root-instructions-projection-service";
import { homedir } from "node:os";
import { cliArg, repoRoot } from "./lib/runtime.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = join(PACKAGE_ROOT, "content/harness/claude-agent-harness.json");
const COLLEAGUE_INCUMBENCIES_RELATIVE =
  "lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-computer-services-section/services/computer-machine-services-section/services/persistent-computer-machine-services-section/services/bare-cedar-fog-services-section/content/incumbencies";

function loadPolicyJSON() {
  return JSON.parse(readFileSync(POLICY_PATH, "utf8"));
}

export async function installHarness({ repoRoot, target, dryRun = false } = {}) {
  const root = repoRoot ?? repoRootForPackage();
  const policy = loadPolicyJSON();
  // Seatings are verified only when the policy projects colleague agents at
  // all; under the owner-directed zero-agent harness a seated officer is
  // dispatched through the work rail and workflows, never as a subagent.
  if (policy.agents?.enabled !== false) verifySeatings({ policy, repoRoot: root, incumbenciesDir: join(root, COLLEAGUE_INCUMBENCIES_RELATIVE) });
  return projectClaudeHarness({
    policyPath: POLICY_PATH,
    repoRoot: root,
    target: target ?? root,
    dryRun,
  });
}

export async function checkHarness({ repoRoot, target } = {}) {
  const root = repoRoot ?? repoRootForPackage();
  const policy = loadPolicyJSON();
  if (policy.agents?.enabled !== false) verifySeatings({ policy, repoRoot: root, incumbenciesDir: join(root, COLLEAGUE_INCUMBENCIES_RELATIVE) });
  return checkExactRoster({
    policyPath: POLICY_PATH,
    repoRoot: root,
    target: target ?? root,
  });
}

/**
 * Claude's global root instructions (`~/.claude/CLAUDE.md`) carry the one
 * shared engineering method between managed markers, exactly as Codex's
 * `CODEX_HOME/AGENTS.md` does; every Claude session and every subagent it
 * spawns reads it, so a ruling in the method reaches them without a brief
 * restating it. The block is rendered upstream; this harness only names the file.
 * @param {{claudeHome?: string}} [params]
 */
export function installGlobalEngineeringMethod({ claudeHome = join(homedir(), ".claude") } = {}) {
  const filePath = join(resolve(claudeHome), "CLAUDE.md");
  const result = installManagedEngineeringMethod({ filePath });
  return Object.freeze({ path: result.path, disposition: result.disposition });
}

/** @param {{claudeHome?: string}} [params] */
export function checkGlobalEngineeringMethod({ claudeHome = join(homedir(), ".claude") } = {}) {
  const filePath = join(resolve(claudeHome), "CLAUDE.md");
  const result = checkManagedEngineeringMethod({ filePath });
  if (!result.current) throw new Error(`global engineering-method block is missing or stale: ${filePath}`);
  return Object.freeze({ path: filePath, disposition: "managed-engineering-method-current" });
}

/**
 * The shared root-instructions law's operating posture (conversation style,
 * the standing "no rush" framing, the architecture-first repository-maturity
 * posture, and the house-law pointer list) into THIS REPOSITORY's own
 * `CLAUDE.md`, never the global `~/.claude/CLAUDE.md`. Per this package's own
 * `maintain-claude-harness` skill's authored-source table, repository
 * `CLAUDE.md` "is authored by hand at the repo root; the enterprise
 * installer splices only its marked standing block" — the repo-specific
 * `houseLaw` and `repositoryMaturity.operatingPosture` (Enterprise
 * Systematization, import stratification, this repository's own rules
 * pointers) are 561-Group/this-repository law, not portable across every
 * other project that shares the Founder's global `~/.claude/CLAUDE.md`.
 * Splicing it there would leak this repository's house law into every
 * other, unrelated project of the Founder's. Codex's project-level
 * `AGENTS.md` has always rendered this shared law at the repository level for
 * exactly this reason; Claude's harness driver installed only the global
 * engineering method and never this, so every Founder repetition of
 * "establish the shared architecture first, not leaves" or "the harness
 * itself is inadequate" landed in a session transcript and nowhere durable
 * (owner-diagnosed 2026-09-11).
 * @param {{repoRoot?: string}} [params]
 */
export function installRepositoryOperatingPosture({ repoRoot: root = repoRootForPackage() } = {}) {
  const filePath = join(resolve(root), "CLAUDE.md");
  const result = installManagedOperatingPosture({ filePath });
  return Object.freeze({ path: result.path, disposition: result.disposition });
}

/** @param {{repoRoot?: string}} [params] */
export function checkRepositoryOperatingPosture({ repoRoot: root = repoRootForPackage() } = {}) {
  const filePath = join(resolve(root), "CLAUDE.md");
  const result = checkManagedOperatingPosture({ filePath });
  if (!result.current) throw new Error(`repository operating-posture block is missing or stale: ${filePath}`);
  return Object.freeze({ path: filePath, disposition: "managed-operating-posture-current" });
}

function repoRootForPackage() {
  return repoRoot(PACKAGE_ROOT);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = { repoRoot: cliArg("--repo-root"), target: cliArg("--target") };
    const claudeHome = cliArg("--claude-home");
    const dryRun = process.argv.includes("--dry-run");
    const result = process.argv.includes("--check")
      ? {
          harness: await checkHarness(options),
          globalEngineeringMethod: checkGlobalEngineeringMethod({ claudeHome }),
          repositoryOperatingPosture: checkRepositoryOperatingPosture({ repoRoot: options.repoRoot }),
        }
      : {
          harness: await installHarness({ ...options, dryRun }),
          globalEngineeringMethod: dryRun ? { disposition: "skipped-dry-run" } : installGlobalEngineeringMethod({ claudeHome }),
          repositoryOperatingPosture: dryRun ? { disposition: "skipped-dry-run" } : installRepositoryOperatingPosture({ repoRoot: options.repoRoot }),
        };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`project-claude-agent-harness: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
