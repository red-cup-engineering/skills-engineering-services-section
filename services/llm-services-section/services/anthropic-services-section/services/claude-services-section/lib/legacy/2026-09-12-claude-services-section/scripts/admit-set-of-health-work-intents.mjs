#!/usr/bin/env node
// Analyze-to-Plan edge of the health MAPE-K loop: the checkout-health
// checkers run here, on the checkout that carries the debt, and the findings
// are admitted as ready duties on the rail at ops.561.group. Composes
// metroplat's own `readCheckoutHealth` and `healthWorkIntent` (0.3.0) and the
// rail's generic admit verbs; never reimplements the finding-grouping,
// unit-observation, or structured-intent assembly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { healthWorkIntent, readCheckoutHealth } from "@red-cup-engineering/metroplat/monitoring";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { cliArg, repoRoot } from "./lib/runtime.mjs";
import { resolveFilepath } from "@red-cup-engineering/resolve-filepath-service";
import { projectFilepathDirectory } from "@red-cup-engineering/project-filepath-directory-service";
import { projectFileUrlFilepath } from "@red-cup-engineering/project-file-url-filepath-service";

const PACKAGE_ROOT = resolveFilepath([projectFilepathDirectory(projectFileUrlFilepath(import.meta.url)), ".."]);
const HARNESS_POLICY = JSON.parse(readFileSync(join(PACKAGE_ROOT, "content/harness/claude-agent-harness.json"), "utf8"));

/** This harness's own actor and root office, used as an allocation's default incumbent when a caller names neither. */
export const DEFAULT_ALLOCATION_ACTOR = HARNESS_POLICY.actor;
export const DEFAULT_ALLOCATION_OFFICE = HARNESS_POLICY.rootOffice;

export const CHAIN_ITEMS = Object.freeze([
  Object.freeze({
    cell: "endeavor:ops-561-group",
    text: "ops.561.group: the ERP/ICS control plane for agents and humans, earned through metroplat, earned through FAE, LAGOON, and MARSH.",
  }),
  Object.freeze({
    cell: "campaign:internal-compute-market",
    parent: "endeavor:ops-561-group",
    text: "Sell every compute on the internal market, buy it from ourselves, track all resources; the Web-signal MAPE-K loop is its first customer.",
  }),
  Object.freeze({
    cell: "project:core-stability",
    parent: "campaign:internal-compute-market",
    text: "Get the core stable: one RMN grammar and runtime across every active consumer, SEAVT strata realized, every cited theorem checked by command, every manifest true, every pin exact and existing on the registry.",
  }),
  Object.freeze({
    cell: "plan:2026-09-03-core-stability",
    parent: "project:core-stability",
    text: "This week's plan: land the RMN repin campaign green and committed; publish the reader repin train; make the Lean package manifest true; gate every theorem citation with the audit die on GitHub Actions.",
  }),
]);

export const PLAN_CELL = "plan:2026-09-03-core-stability";

/**
 * The deterministic allocation id for one task cell.
 * @param {string} taskCell
 * @returns {string}
 */
export function allocationIdFor(taskCell) {
  return `allocation-${taskCell}`;
}

/**
 * One `metroplat.work.agency-work-allocation` payload allocating a task
 * item's scope to the given office and actor, against the structured-work-
 * intent feed subject that declared it. `office`/`actor` default to this
 * harness's own root seating so a caller that names neither still produces
 * a valid allocation. Matches the rail's own schema exactly (no `duty`
 * field: the admission verb's `additionalProperties: false` rejects one).
 * @param {{taskCell: string, subject: string, office?: string, actor?: string}} options
 * @returns {object}
 */
export function buildTaskAllocation({ taskCell, subject, office = DEFAULT_ALLOCATION_OFFICE, actor = DEFAULT_ALLOCATION_ACTOR }) {
  for (const [name, value] of Object.entries({ taskCell, subject, office, actor })) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`buildTaskAllocation: ${name} is required`);
  }
  return {
    kind: "metroplat.work.agency-work-allocation",
    id: allocationIdFor(taskCell),
    subject,
    office: { id: office },
    incumbency: { actor, recognition: "t", induction: "t" },
    allocation: { scope: taskCell, assigner: actor, charge: "t" },
  };
}

/**
 * Admits one allocation per given task item so each shows up on MetroPlat's
 * agent-work-dispatch readout as a ready duty. Idempotent per task:
 * `admitAllocationFn` reports `appended: 0` for a task already allocated
 * under its deterministic id. Shared by every admitter in this package.
 * @param {{tasks: readonly {cell: string}[], subject: string, office?: string, actor?: string, at: string, binding: object|null, admitAllocationFn: Function}} options
 * @returns {Promise<{allocated: number, allocationsAppended: number}>}
 */
export async function admitAllocationsForTasks({ tasks, subject, office, actor, at, binding, admitAllocationFn }) {
  if (typeof admitAllocationFn !== "function") throw new TypeError("admitAllocationsForTasks: admitAllocationFn is required (a rail's admit verb)");
  let allocationsAppended = 0;
  for (const task of tasks) {
    const allocation = buildTaskAllocation({ taskCell: task.cell, subject, office, actor });
    const admission = await admitAllocationFn(binding, allocation, { at });
    allocationsAppended += admission.appended;
  }
  return { allocated: tasks.length, allocationsAppended };
}

/**
 * Deterministic cell slug: lowercase, non `[a-z0-9-]` runs collapsed to one
 * `-`, leading/trailing `-` trimmed.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/**
 * Checkout-bound systemd units this harness treats as lawful development
 * infrastructure, passed through to metroplat's `checkout-health` family as
 * `checkoutBoundUnitsAllow`.
 */
export const CHECKOUT_BOUND_UNITS_ALLOW = Object.freeze([
  "verdaccio.service",
  "jsnode-server.service",
  // Development infrastructure whose subject IS the checkout (ruled 2026-09-06
  // after release-package-on-host refused each on its own carrier's grounds):
  // rclone syncs the checkout itself; the personal-log arrivals read the
  // founder's Markdown tree in place; scheduled-activity-delivery's admitted
  // deployment contract asserts the checkout WorkingDirectory; the session
  // event forwarder reads this harness's live journal.
  "google-drive-info-sync.service",
  "personal-log-arrivals.service",
  "scheduled-activity-delivery-run-due.service",
  "session-event-arrivals.service",
]);

/**
 * Runs the checkout-health checkers on this checkout and admits every finding
 * as a task under the chain's plan cell, plus one allocation per task, on
 * the rail. The summary is the same shape metroplat's own
 * `checkout-health-work-intent-admit` verb returns.
 * @param {object} [options]
 * @param {string} [options.root] - repo root the checkout-scoped checkers scan; omitted, they do not run.
 * @param {boolean} [options.changedOnly] - defaults false: scans the whole checkout, not just git-changed paths.
 * @param {number} [options.budgetMs]
 * @param {readonly string[]} [options.hosts]
 * @param {readonly string[]} [options.checkoutBoundUnitsAllow]
 * @param {string} [options.intentId]
 * @param {string} [options.office]
 * @param {string} [options.actor]
 * @param {readonly object[]} [options.chain] - defaults to {@link CHAIN_ITEMS}.
 * @param {ReturnType<typeof resolveWorkRail>} [options.work] - the rail; defaults to production.
 * @param {typeof readCheckoutHealth} [options.readHealthFn] - injectable for tests.
 * @param {typeof healthWorkIntent} [options.healthWorkIntentFn] - injectable for tests.
 * @param {() => Date} [options.now]
 * @returns {Promise<object>} a `metroplat.monitoring.checkout-health.work-intent-summary` record.
 */
export async function admitSetOfHealthWorkIntents({
  root,
  changedOnly = false,
  budgetMs,
  hosts,
  checkoutBoundUnitsAllow = CHECKOUT_BOUND_UNITS_ALLOW,
  intentId,
  office,
  actor,
  chain = CHAIN_ITEMS,
  work,
  readHealthFn = readCheckoutHealth,
  healthWorkIntentFn = healthWorkIntent,
  now = () => new Date(),
} = {}) {
  const health = readHealthFn({ root, changedOnly, budgetMs, hosts, checkoutBoundUnitsAllow });
  const at = now().toISOString();
  const resolvedIntentId = intentId ?? `checkout-health-work-intents-${at.slice(0, 10)}`;
  if (health.violations === 0) {
    return { kind: "metroplat.monitoring.checkout-health.work-intent-summary", checked: health.checked, violations: 0, admitted: 0, intentId: null, rowsAppended: 0, allocated: 0, allocationsAppended: 0 };
  }
  const rail = work ?? resolveWorkRail();
  const plan = healthWorkIntentFn(health, { id: resolvedIntentId, chain, office, actor, root });
  const subject = `structured-work-intent-${resolvedIntentId}`;
  const admission = await rail.admitFn(rail.binding, plan.intent, { at, subject });
  const { allocationsAppended } = await admitAllocationsForTasks({ tasks: plan.tasks, subject, office, actor, at, binding: rail.binding, admitAllocationFn: rail.admitAllocationFn });
  return {
    kind: "metroplat.monitoring.checkout-health.work-intent-summary",
    checked: health.checked,
    violations: health.violations,
    admitted: plan.tasks.length,
    intentId: resolvedIntentId,
    rowsAppended: admission.appended,
    allocated: plan.allocations.length,
    allocationsAppended,
  };
}

function usage() {
  return "Usage: admit-set-of-health-work-intents [--root <repo-root>] [--hosts local,cold-red-gate]\n" +
    "  [--intent-id <id>] [--budget-ms <n>] [--office <office-id>] [--actor <actor-id>] [--changed-only] [--data-root <dir>]\n" +
    "Runs the checkout-health checkers (systemd failed units, checkout-bound units, and, when --root\n" +
    "is given, the data-custody/exact-deps/lockfile-registry/import-stratification checkers) on this\n" +
    "checkout and admits the findings as one structured work intent's task items under\n" +
    "plan:2026-09-03-core-stability, plus one agency-work-allocation per task, on the rail at\n" +
    "ops.561.group. --root defaults to this checkout. By default the checkers scan the whole checkout;\n" +
    "pass --changed-only to scan only the working tree's git-changed paths. --data-root admits into a\n" +
    "local metroplat data root instead (tests only). Prints one JSON summary line.\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  let work = null;
  try {
    const hostsArg = cliArg("--hosts");
    const budgetMsArg = cliArg("--budget-ms");
    work = resolveWorkRail({ dataRoot: cliArg("--data-root") });
    const summary = await admitSetOfHealthWorkIntents({
      root: cliArg("--root") ?? repoRoot(PACKAGE_ROOT),
      budgetMs: budgetMsArg === undefined ? undefined : Number(budgetMsArg),
      changedOnly: argv.includes("--changed-only"),
      hosts: hostsArg === undefined ? undefined : hostsArg.split(","),
      intentId: cliArg("--intent-id"),
      office: cliArg("--office"),
      actor: cliArg("--actor"),
      work,
    });
    process.stdout.write(`${JSON.stringify({ rail: work.kind, ...summary })}\n`);
  } catch (error) {
    process.stderr.write(`admit-set-of-health-work-intents: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await work?.close();
  }
}
