#!/usr/bin/env node
// Thin parameterization: policy in content/harness/claude-permission-policy.json,
// logic in the canonical projection-service dependency.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPermissions as checkProjectedPermissions, projectPermissions } from "@red-cup-engineering/claude-harness-projection-service";
import { cliArg, repoRoot } from "./lib/runtime.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = join(PACKAGE_ROOT, "content/harness/claude-permission-policy.json");

export async function installPermissions({ repoRoot, target, dryRun = false } = {}) {
  const root = repoRoot ?? repoRootForPackage();
  return projectPermissions({
    policyPath: POLICY_PATH,
    target: target ?? root,
    dryRun,
  });
}

export async function checkPermissions({ repoRoot, target } = {}) {
  const root = repoRoot ?? repoRootForPackage();
  return checkProjectedPermissions({
    policyPath: POLICY_PATH,
    target: target ?? root,
  });
}

function repoRootForPackage() {
  return repoRoot(PACKAGE_ROOT);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = { repoRoot: cliArg("--repo-root"), target: cliArg("--target") };
    const result = process.argv.includes("--check")
      ? await checkPermissions(options)
      : await installPermissions({ ...options, dryRun: process.argv.includes("--dry-run") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`project-claude-permissions: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
