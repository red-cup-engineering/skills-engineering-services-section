#!/usr/bin/env node
// admit-structured-work-intent — admits one already-complete structured work
// intent (an agent-work.structured-intent JSON document, typically a founder
// babble typed into cells with provenance spans) through metroplat's own
// structured-work-intent-admit verb on the rail at ops.561.group, plus one
// agency-work-allocation per task-level item so each is a ready duty.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { admitAllocationsForTasks } from "./admit-set-of-health-work-intents.mjs";
import { cliArgument, readBoundedHookInput } from "./lib/claude-hook-input.mjs";

/**
 * @param {object} options
 * @param {object} options.intent - an agent-work.structured-intent document.
 * @param {object} [options.work] - a resolved work rail (tests).
 * @param {string} [options.office]
 * @param {string} [options.actor]
 * @param {() => Date} [options.now]
 * @returns {Promise<{intentId: string, appended: number, status: string|undefined, allocated: number, allocationsAppended: number}>}
 */
export async function admitStructuredWorkIntentDocument({ intent, work, office, actor, duty, now = () => new Date() }) {
  if (intent?.kind !== "agent-work.structured-intent" || typeof intent.id !== "string" || !Array.isArray(intent.items)) {
    throw new TypeError(`intent must be an agent-work.structured-intent with id and items (got ${intent?.kind})`);
  }
  const rail = work ?? resolveWorkRail();
  const at = now().toISOString();
  const subject = `structured-work-intent-${intent.id}`;
  const admission = await rail.admitFn(rail.binding, intent, { at, subject });
  const tasks = intent.items.filter((item) => /^task:/u.test(item.cell));
  const allocation = await admitAllocationsForTasks({ tasks, subject, office, actor, duty, at, binding: rail.binding, admitAllocationFn: rail.admitAllocationFn });
  return { intentId: intent.id, appended: admission.appended, status: admission.status, allocated: allocation.allocated, allocationsAppended: allocation.allocationsAppended };
}

function usage() {
  return "Usage: admit-structured-work-intent [--intent <json>] [--data-root <dir>] [--office <id>] [--actor <id>]\n" +
    "Reads one metroplat.work.structured-intent document (--intent, else stdin) and admits it\n" +
    "through the structured-work-intent-admit verb on the rail at ops.561.group, plus one\n" +
    "agency-work-allocation per task: item. --data-root admits into a local metroplat data\n" +
    "root instead (tests only). Prints one JSON summary line.\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--help")) { process.stdout.write(usage()); process.exit(0); }
  let work = null;
  try {
    const intentPath = cliArgument("--intent");
    const intent = intentPath === undefined ? await readBoundedHookInput(process.stdin) : JSON.parse(readFileSync(intentPath, "utf8"));
    work = resolveWorkRail({ dataRoot: cliArgument("--data-root") });
    const summary = await admitStructuredWorkIntentDocument({ intent, work, office: cliArgument("--office"), actor: cliArgument("--actor"), duty: cliArgument("--duty") });
    process.stdout.write(`${JSON.stringify({ rail: work.kind, ...summary })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (work) await work.close();
  }
}
