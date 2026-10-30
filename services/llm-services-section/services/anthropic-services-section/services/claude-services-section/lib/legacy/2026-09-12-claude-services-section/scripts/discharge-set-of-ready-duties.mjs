#!/usr/bin/env node
// One effect: the ready checkout-health duties on the rail at ops.561.group,
// repaired here on the checkout that carries the debt, gated, and discharged
// back to the rail. Composes metroplat's own `dischargeReadyDuties` and
// `planOrDischargeDuty` (0.3.0) over the rail's dispatch readout; never
// reimplements the duty routing, repair, gate, or discharge logic.
import { dischargeReadyDuties, planOrDischargeDuty } from "@red-cup-engineering/agent-work-computer-system-engineering-services-section/duty-discharge";
import { isMain } from "@red-cup-engineering/javascript-file-main-guard-service";
import { resolveFilepath } from "@red-cup-engineering/resolve-filepath-service";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { cliArg } from "./lib/runtime.mjs";

/**
 * Reads the ready duties off the rail, routes each to its repair script, and
 * in apply mode repairs, gates, and admits the discharge back to the rail.
 * @param {object} options
 * @param {string} options.root - the checkout the repairs run against.
 * @param {boolean} [options.apply] - default false: plan only.
 * @param {number} [options.limit] - at most this many applied repairs.
 * @param {string} [options.scope] - one duty scope.
 * @param {"exact-deps"|"data-custody"} [options.repairKind]
 * @param {ReturnType<typeof resolveWorkRail>} [options.work] - the rail; defaults to production.
 * @param {typeof dischargeReadyDuties} [options.dischargeFn] - injectable for tests.
 * @param {typeof planOrDischargeDuty} [options.planFn] - injectable for tests.
 * @returns {Promise<object>} metroplat's `checkout-health.duty-discharge` result.
 * @throws {Error} when `root` is missing.
 */
export async function dischargeSetOfReadyDuties({ root, apply = false, limit, scope, repairKind, work, dischargeFn = dischargeReadyDuties, planFn = planOrDischargeDuty } = {}) {
  if (typeof root !== "string" || root.trim() === "") throw new Error("discharge-set-of-ready-duties: names no root");
  const rail = work ?? resolveWorkRail();
  const readout = await rail.readDispatch({ limit: 500 });
  const planOrDischargeFn = async (args) => {
    const result = await planFn({ ...args, admitDischargeFn: rail.admitDischargeFn });
    return result.admission instanceof Promise ? Object.freeze({ ...result, admission: await result.admission }) : result;
  };
  const request = { readout, root, binding: rail.binding, apply, planOrDischargeFn };
  if (limit !== undefined) request.limit = limit;
  if (scope !== undefined) request.scope = scope;
  if (repairKind !== undefined) request.kind = repairKind;
  return dischargeFn(request);
}

function usage() {
  return "Usage: discharge-set-of-ready-duties --root <checkout-root> [--plan|--apply] [--limit <n>]\n" +
    "  [--scope <task-scope>] [--kind exact-deps|data-custody] [--data-root <dir>]\n" +
    "Reads the ready checkout-health duties off the rail at ops.561.group, routes each to the\n" +
    "repair script that owns it (task:exact-deps-* to pin-exact-dependencies, task:data-custody-*\n" +
    "to migrate-data-custody-directory), and with --apply repairs the checkout under --root, gates\n" +
    "the repair, and admits the discharge back to the rail. --plan (the default) prints the routed\n" +
    "plan. --data-root reads and discharges a local metroplat data root instead (tests only).\n";
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const root = cliArg("--root");
  if (root === undefined) {
    process.stderr.write("discharge-set-of-ready-duties: --root is required\n");
    process.exit(1);
  }
  let work = null;
  try {
    work = resolveWorkRail({ dataRoot: cliArg("--data-root") });
    const limitArg = cliArg("--limit");
    const result = await dischargeSetOfReadyDuties({
      root: resolveFilepath([root]),
      apply: argv.includes("--apply"),
      limit: limitArg === undefined ? undefined : Number(limitArg),
      scope: cliArg("--scope"),
      repairKind: cliArg("--kind"),
      work,
    });
    process.stdout.write(`${JSON.stringify({ rail: work.kind, ...result }, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`discharge-set-of-ready-duties: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await work?.close();
  }
}
