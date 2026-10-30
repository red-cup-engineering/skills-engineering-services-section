#!/usr/bin/env node
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLifecycleHooks as checkProjectedHooks, projectLifecycleHooks } from "@red-cup-engineering/claude-harness-projection-service";
import { cliArg, repoRoot } from "./lib/runtime.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = join(PACKAGE_ROOT, "content/harness/claude-lifecycle-hook-policy.json");
const HANDLER_PATH = join(PACKAGE_ROOT, "scripts/observe-claude-lifecycle.mjs");
const COMMENT_DISCIPLINE_PATH = join(PACKAGE_ROOT, "scripts/check-comment-discipline-hook.mjs");
const WORKFLOW_OPT_IN_PATH = join(PACKAGE_ROOT, "scripts/check-workflow-opt-in-hook.mjs");
const GIT_SCALE_SAFETY_PATH = join(PACKAGE_ROOT, "scripts/check-git-scale-safety-hook.mjs");
const JSNODE_DISCOVERY_PATH = join(PACKAGE_ROOT, "scripts/check-jsnode-discovery-hook.mjs");
const DISK_IO_COORDINATION_PATH = join(PACKAGE_ROOT, "scripts/check-disk-io-coordination-hook.mjs");
const MARKDOWN_CARRIER_TOOLING_PATH = join(PACKAGE_ROOT, "scripts/check-markdown-carrier-tooling-hook.mjs");
const SETTLED_APP_PURPOSE_PATH = join(PACKAGE_ROOT, "scripts/check-settled-app-purpose-hook.mjs");
const PER_TURN_DUTY_PATH = join(PACKAGE_ROOT, "scripts/emit-claude-per-turn-duty.mjs");
const SESSION_ADMIT_PATH = join(PACKAGE_ROOT, "scripts/admit-claude-session.mjs");
const FRICTION_ADMIT_PATH = join(PACKAGE_ROOT, "scripts/admit-set-of-session-frictions.mjs");
const GIT_NPM_DEFAULTS_PATH = join(PACKAGE_ROOT, "scripts/configure-git-npm-interaction-defaults-hook.mjs");
const SUBSTRATE_IMPORT_PATH = join(PACKAGE_ROOT, "scripts/check-substrate-import-hook.mjs");
const RETIRED_SHORT_REMINDER_PATH = join(PACKAGE_ROOT, "scripts/emit-claude-short-reminder.mjs");
const TOOL_OUTPUT_CAPTURE_MODULE = "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-inference-system-services-section/services/llm-services-section/services/llm-cost-optimization-services-section/scripts/claude-pretool-output-capture-hook.mjs";

function catalog(root) {
  const module = relative(root, HANDLER_PATH).split("\\").join("/");
  const workflowOptIn = relative(root, WORKFLOW_OPT_IN_PATH).split("\\").join("/");
  const gitScaleSafety = relative(root, GIT_SCALE_SAFETY_PATH).split("\\").join("/");
  const jsnodeDiscovery = relative(root, JSNODE_DISCOVERY_PATH).split("\\").join("/");
  const diskIoCoordination = relative(root, DISK_IO_COORDINATION_PATH).split("\\").join("/");
  const markdownCarrierTooling = relative(root, MARKDOWN_CARRIER_TOOLING_PATH).split("\\").join("/");
  const settledAppPurpose = relative(root, SETTLED_APP_PURPOSE_PATH).split("\\").join("/");
  const perTurnDuty = relative(root, PER_TURN_DUTY_PATH).split("\\").join("/");
  const sessionAdmit = relative(root, SESSION_ADMIT_PATH).split("\\").join("/");
  const frictionAdmit = relative(root, FRICTION_ADMIT_PATH).split("\\").join("/");
  const gitNpmDefaults = relative(root, GIT_NPM_DEFAULTS_PATH).split("\\").join("/");
  const substrateImport = relative(root, SUBSTRATE_IMPORT_PATH).split("\\").join("/");
  return {
    "session-start-observer": module,
    "session-start-git-npm-defaults": gitNpmDefaults,
    "prompt-submitted-observer": module,
    "session-stop-observer": module,
    "session-admit": sessionAdmit,
    "session-friction-admit": frictionAdmit,
    "subagent-stop-observer": module,
    "workflow-opt-in-check": workflowOptIn,
    "git-scale-safety-check": gitScaleSafety,
    "jsnode-discovery-check": jsnodeDiscovery,
    "disk-io-coordination-check": diskIoCoordination,
    "disk-io-coordination-release": diskIoCoordination,
    "markdown-carrier-tooling-check": markdownCarrierTooling,
    "settled-app-purpose-check": settledAppPurpose,
    "substrate-import-check": substrateImport,
    "per-turn-duty": perTurnDuty,
    "tool-output-capture": TOOL_OUTPUT_CAPTURE_MODULE,
  };
}

function priorCoordinate(module) {
  const current = "561-group-computer-services-section";
  const prior = "561-group-engineering-services-section/services/561-group-computer-engineering-services-section";
  if (!module.includes(current)) throw new Error(`cannot derive the prior coordinate for '${module}'`);
  return module.replace(current, prior);
}

function ownedCoordinates(root) {
  const currentCatalog = catalog(root);
  const retiredShortReminder = relative(root, RETIRED_SHORT_REMINDER_PATH).split("\\").join("/");
  const retiredCommentDiscipline = relative(root, COMMENT_DISCIPLINE_PATH).split("\\").join("/");
  return {
    priorOwnedModules: [...new Set(Object.values(currentCatalog).filter((module) => module.includes("561-group-computer-services-section")).map(priorCoordinate))],
    retiredOwnedModules: [
      priorCoordinate(retiredShortReminder), retiredShortReminder,
      priorCoordinate(retiredCommentDiscipline), retiredCommentDiscipline,
    ],
  };
}

/**
 * Projects the Bare Cedar Fog Claude lifecycle hook policy into the target repo's .claude/settings.local.json.
 *
 * @param {object} options The repo root, projection target, and optional dry-run flag.
 * @returns {Promise<object>} A frozen projection receipt naming the actor, owner, target, file, and handlers.
 */
export async function installLifecycleHooks({ repoRoot: root, target, dryRun = false } = {}) {
  root ??= repoRoot(PACKAGE_ROOT);
  return projectLifecycleHooks({ policyPath: POLICY_PATH, target: target ?? root, handlerCatalog: catalog(root), ...ownedCoordinates(root), dryRun });
}

/**
 * Checks that the target's projected lifecycle hooks still match this policy, without writing.
 *
 * @param {object} options The repo root and projection target.
 * @returns {Promise<object>} A frozen receipt naming the actor, owner, target, file, and handlers.
 * @throws {Error} When the hooks have never been projected or have drifted from the policy.
 */
export async function checkLifecycleHooks({ repoRoot: root, target } = {}) {
  root ??= repoRoot(PACKAGE_ROOT);
  return checkProjectedHooks({ policyPath: POLICY_PATH, target: target ?? root, handlerCatalog: catalog(root), ...ownedCoordinates(root) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = { repoRoot: cliArg("--repo-root"), target: cliArg("--target") };
    const result = process.argv.includes("--check")
      ? await checkLifecycleHooks(options)
      : await installLifecycleHooks({ ...options, dryRun: process.argv.includes("--dry-run") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`project-claude-lifecycle-hooks: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
