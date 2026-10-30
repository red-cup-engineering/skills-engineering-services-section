#!/usr/bin/env node
// One effect: one friction a session met, stated explicitly (a carrier that
// says something the disk contradicts, or a capability the org lacks),
// admitted as a ready duty on the rail: one structured work-intent task under
// the standing core-stability plan plus one agency-work-allocation. The rail
// is production MetroPlat at ops.561.group; --data-root is a test override.
import { resolveFilepath } from "@red-cup-engineering/resolve-filepath-service";
import { projectFileUrlFilepath } from "@red-cup-engineering/project-file-url-filepath-service";
import { FRICTION_KINDS, buildFrictionWorkIntent, frictionReportDigest, taskFromFrictionReport } from "../src/session-frictions.mjs";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { admitAllocationsForTasks, slugify } from "./admit-set-of-health-work-intents.mjs";
import { cliArgument } from "./lib/claude-hook-input.mjs";

/**
 * Admits one explicit friction report as a task under the standing plan and
 * allocates it, through the given work rail's admit verbs.
 * @param {object} options
 * @param {{kind: string, carrier: string, observed: string, expected: string}} options.report
 * @param {ReturnType<typeof resolveWorkRail>} [options.work] - the rail; defaults to production.
 * @param {object} [options.binding] - a metroplat filesystem binding (tests); ignored when `work` is given.
 * @param {string} [options.intentId]
 * @param {string} [options.office]
 * @param {string} [options.actor]
 * @param {() => Date} [options.now]
 * @param {Function} [options.admitFn] - overrides the rail's structured-intent admit (tests).
 * @param {Function} [options.admitAllocationFn] - overrides the rail's allocation admit (tests).
 * @returns {Promise<{task: string, intentId: string, rowsAppended: number, allocationsAppended: number}>}
 */
export async function admitFriction({ report, work, binding, intentId, office, actor, now = () => new Date(), admitFn, admitAllocationFn }) {
  const rail = work ?? (admitFn && admitAllocationFn ? null : resolveWorkRail());
  const admit = admitFn ?? rail.admitFn;
  const admitAllocation = admitAllocationFn ?? rail.admitAllocationFn;
  const boundBinding = binding ?? rail?.binding ?? null;
  const task = taskFromFrictionReport(report);
  const resolvedIntentId = intentId ?? `friction-report-${now().toISOString().slice(0, 10)}-${slugify(report.carrier).slice(0, 40).replace(/-$/u, "")}-${frictionReportDigest(report)}`;
  const intent = buildFrictionWorkIntent({ id: resolvedIntentId, tasks: [task], producerId: "bare-cedar-fog-claude-services-section:admit-friction" });
  const at = now().toISOString();
  const subject = `structured-work-intent-${resolvedIntentId}`;
  const admission = await admit(boundBinding, intent, { at, subject });
  const { allocationsAppended } = await admitAllocationsForTasks({ tasks: [task], subject, office, actor, at, binding: boundBinding, admitAllocationFn: admitAllocation });
  return { task: task.cell, intentId: resolvedIntentId, rowsAppended: admission.appended, allocationsAppended };
}

function usage() {
  return `Usage: admit-friction --kind <${Object.values(FRICTION_KINDS).filter((k) => k.startsWith("carrier") || k.startsWith("missing")).join("|")}> --carrier <path or name> --observed <text> --expected <text>\n` +
    "  [--data-root <dir>] [--intent-id <id>] [--office <id>] [--actor <id>]\n" +
    "Admits one friction a session met as a ready duty on the rail at ops.561.group: carrier-falsehood\n" +
    "when a carrier states something the disk contradicts; missing-capability when the session needed\n" +
    "something the org does not offer. --data-root admits into a local metroplat data root instead\n" +
    "(tests and offline development only). Prints one JSON line.\n";
}

if (process.argv[1] && projectFileUrlFilepath(import.meta.url) === resolveFilepath([process.argv[1]])) {
  if (process.argv.includes("--help")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  let work = null;
  try {
    const report = { kind: cliArgument("--kind"), carrier: cliArgument("--carrier"), observed: cliArgument("--observed"), expected: cliArgument("--expected") };
    work = resolveWorkRail({ dataRoot: cliArgument("--data-root") });
    const summary = await admitFriction({ report, work, intentId: cliArgument("--intent-id"), office: cliArgument("--office"), actor: cliArgument("--actor") });
    process.stdout.write(`${JSON.stringify({ rail: work.kind, ...summary })}\n`);
  } catch (error) {
    process.stderr.write(`admit-friction: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await work?.close();
  }
}
