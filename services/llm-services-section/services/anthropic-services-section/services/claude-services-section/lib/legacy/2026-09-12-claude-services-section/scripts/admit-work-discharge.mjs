#!/usr/bin/env node
// Thin CLI over MetroPlat's own `work-discharge-admit`, so a session or
// human can close a ready duty with plain evidence strings -- no code, no
// repair script required. Every refusal (a malformed discharge, a scope
// that is not an obligation of the given intent) is the verb's own error,
// surfaced here as JSON, never a bare uncaught throw. The rail is production
// MetroPlat at ops.561.group; --data-root is a test override.
import { readFileText } from "@red-cup-engineering/file-services/read-file";
import { resolveFilepath } from "@red-cup-engineering/resolve-filepath-service";
import { projectFileUrlFilepath } from "@red-cup-engineering/project-file-url-filepath-service";
import { resolveWorkRail } from "../src/ops-rail.mjs";
import { cliArg } from "./lib/runtime.mjs";

const THIS_PACKAGE = JSON.parse(await readFileText(resolveFilepath([projectFileUrlFilepath(import.meta.url), "..", "..", "package.json"])));

/** The discharge producer the rail records: this package and its version. */
export const PRODUCER = Object.freeze({ id: THIS_PACKAGE.name, revision: THIS_PACKAGE.version });

/**
 * Every `--evidence <string>` value in argv, in order.
 * @param {readonly string[]} argv
 * @returns {string[]}
 */
export function repeatedEvidenceArgs(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--evidence") values.push(argv[index + 1]);
  }
  return values;
}

/**
 * The `metroplat.work.discharge` payload from plain CLI values.
 * @param {{scope: string, intent: string, text: string, evidence: readonly string[], id?: string, producer?: {id: string, revision: string}}} options
 * @returns {object}
 */
export function buildDischargeInputFromArgs({ scope, intent, text, evidence, id, producer = PRODUCER }) {
  return {
    kind: "metroplat.work.discharge",
    id: id ?? `discharge-${scope}`,
    intent,
    producer,
    scope,
    text,
    evidence,
  };
}

/**
 * Admits one discharge and returns the outcome as data: `{ok: true, admission}`
 * or `{ok: false, error}`; never throws on the verb's own refusal.
 * @param {object} options
 * @param {object} options.discharge
 * @param {string} options.at
 * @param {ReturnType<typeof resolveWorkRail>} [options.work] - the rail; defaults to production.
 * @param {object} [options.binding] - a metroplat filesystem binding (tests); ignored when `work` is given.
 * @param {Function} [options.admitFn] - overrides the rail's discharge admit (tests).
 * @returns {Promise<{ok: true, admission: object}|{ok: false, error: string}>}
 */
export async function admitWorkDischargeSafely({ work, binding, discharge, at, admitFn }) {
  const rail = work ?? (admitFn ? null : resolveWorkRail());
  const admit = admitFn ?? rail.admitDischargeFn;
  try {
    const admission = await admit(binding ?? rail?.binding ?? null, discharge, { at });
    return { ok: true, admission };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function usage() {
  return "Usage: admit-work-discharge --scope <task-scope> --intent <intent-id> --text <text> --evidence <string> [--evidence <string> ...]\n" +
    "  [--id <discharge-id>] [--data-root <dir>] [--at <iso-timestamp>]\n" +
    "A thin CLI over MetroPlat's work-discharge-admit on the rail at ops.561.group: closes a ready\n" +
    "duty with plain evidence, no repair script required. Refuses (nonzero exit, JSON {ok:false,\n" +
    "error}) when the scope is not a recorded obligation of the given intent, or the payload is\n" +
    "otherwise malformed. --data-root admits into a local metroplat data root instead (tests only).\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const scope = cliArg("--scope");
  const intent = cliArg("--intent");
  const text = cliArg("--text");
  const evidence = repeatedEvidenceArgs(argv);
  if (scope === undefined || intent === undefined || text === undefined || evidence.length === 0) {
    process.stderr.write("admit-work-discharge: --scope, --intent, --text, and at least one --evidence are required\n");
    process.exit(1);
  }

  let work = null;
  try {
    work = resolveWorkRail({ dataRoot: cliArg("--data-root") });
    const discharge = buildDischargeInputFromArgs({ scope, intent, text, evidence, id: cliArg("--id") });
    const at = cliArg("--at") ?? new Date().toISOString();
    const result = await admitWorkDischargeSafely({ work, discharge, at });
    process.stdout.write(`${JSON.stringify({ rail: work.kind, ...result }, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`admit-work-discharge: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await work?.close();
  }
}
