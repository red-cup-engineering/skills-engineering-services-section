#!/usr/bin/env node
/**
 * Every subscription pool this host draws on, from the one allowance ledger:
 *
 *   inference-allowance status [--since <instant>] [--allowance <id>] [--json]
 *   inference-allowance project --entity <id> [--since <instant>]
 *       rewrite the projections of the ledger: the entity's allowance book (every pool in its own
 *       units, beside its other books) and the resource prices hot readers value consumption by
 *
 * For each pool: each window as it stands now (when it opened and resets, what is spent and left),
 * what used it since `since` (default: the start of the longest window, at most 7 days), and what
 * lapsed unspent at each turn since then. The pools are those any consumer on this host has drawn
 * on or recorded against (the ledger knows each as it was last presented), and those this engine
 * declares (subscription CLIs and command providers), shown even before anything reads them.
 */
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { admitAllowance } from "@red-cup-engineering/organizing/enterprise";
import { allowanceLedgerDeclarations, allowanceLedgerLapses, allowanceLedgerPath, allowanceLedgerPools, allowanceLedgerUse, readAllowanceLedger } from "../../src/media/allowance-ledger.mjs";
import { subscriptionAllowance } from "../../src/media/subscription-allowances.mjs";
import { writeAllowanceBook } from "../../src/media/allowance-book.mjs";
import { writeResourcePrices } from "../../src/media/resource-prices.mjs";

const DAY = 86_400_000;
/** Every subscription this engine declares (content/allowances). */
const subscriptions = () => readdirSync(new URL("../../content/allowances/", import.meta.url)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));

/** The pools: the ledger's declarations, then this engine's own that the ledger has not met yet. */
export function allowancePools({ storePath }) {
  const pools = new Map();
  for (const { declaration } of allowanceLedgerDeclarations({ storePath })) pools.set(declaration.id, { ...admitAllowance(declaration), ...declaration });
  for (const id of subscriptions()) if (!pools.has(id)) pools.set(id, subscriptionAllowance(id));
  // A pool the ledger holds draws for whose consumer has not presented its declaration since the
  // ledger began keeping them is still a pool: its use is known, its windows are not.
  for (const id of allowanceLedgerPools({ storePath })) if (!pools.has(id)) pools.set(id, Object.freeze({ id, undeclared: true }));
  return [...pools.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const span = (value) => (value === null || value === undefined ? "?" : value.hi === null ? `${round(value.lo)}+` : value.lo === value.hi ? `${round(value.lo)}` : `${round(value.lo)}–${round(value.hi)}`);
const round = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/u, ""));
const clock = (iso) => (iso === null || iso === undefined ? "?" : iso.slice(0, 16).replace("T", " "));

/** One pool's status now: windows, use since `since`, lapses since `since`. */
export function allowancePoolStatus(allowance, { storePath, since, now = new Date().toISOString() }) {
  if (allowance.undeclared === true) {
    return Object.freeze({ allowance: allowance.id, undeclared: true, at: now, since,
      usedBy: allowanceLedgerUse(allowance, { storePath, since, now }).consumers, windows: [], lapsed: [] });
  }
  const from = allowance.statedAt !== undefined && Date.parse(allowance.statedAt) > Date.parse(since) ? allowance.statedAt : since;
  const { reading, holds } = readAllowanceLedger(allowance, { storePath, now });
  const use = allowanceLedgerUse(allowance, { storePath, since: from, now });
  const lapses = allowanceLedgerLapses(allowance, { storePath, since: from, now });
  return Object.freeze({
    allowance: allowance.id, product: allowance.product, unit: allowance.unit, account: allowance.account, at: now, since: from,
    windows: reading.meters.map(({ meter, law, opensAt, resetsAt, budget, spent, remaining }) => ({ meter, law, opensAt, resetsAt, budget, spent, remaining })),
    fits: reading.fits, learnedFrom: reading.learnedFrom, contested: reading.contested,
    usedBy: use.consumers, inFlight: holds.length,
    lapsed: lapses.meters.map(({ meter, spent, wasted, idleWindows, utilization }) => ({ meter, spent, wasted, idleWindows, utilization })),
  });
}

/** A pool's status in a few lines a person reads. */
export function allowancePoolText(status) {
  const lines = [status.undeclared ? `${status.allowance} (windows not yet presented by its consumer; its next draw declares them)` : `${status.allowance} (${status.product}, in ${status.unit})`];
  for (const window of status.windows) {
    const opened = window.resetsAt === null && window.opensAt === null ? "no window stated or open" : `${clock(window.opensAt)} → ${clock(window.resetsAt)}`;
    lines.push(`  ${window.meter.padEnd(12)} ${opened}; spent ${span(window.spent)} of ${span(window.budget)}, left ${span(window.remaining)}`);
  }
  const used = status.usedBy.map((entry) => `${entry.consumer} ${round(entry.spent)}${entry.inFlight ? ` (+${entry.inFlight} in flight)` : ""}${entry.refused ? ` (${entry.refused} refused)` : ""}`);
  lines.push(`  used since ${clock(status.since)}: ${used.length === 0 ? "nothing recorded" : used.join("; ")}`);
  const lapsed = status.lapsed.filter((meter) => (meter.wasted?.hi ?? 1) > 0 || meter.idleWindows > 0)
    .map((meter) => `${meter.meter} ${span(meter.wasted)}${meter.idleWindows ? ` and ${meter.idleWindows} idle window(s)` : ""}`);
  lines.push(`  lapsed unspent: ${lapsed.length === 0 ? "none recorded" : lapsed.join("; ")}`);
  return lines.join("\n");
}

async function main(argv) {
  const [command = "status", ...rest] = argv;
  const option = (name) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };
  const storePath = allowanceLedgerPath(process.env);
  const now = new Date().toISOString();
  if (command === "project") {
    const entity = option("entity");
    if (!entity) throw new Error("project requires --entity <legal entity id>");
    process.stdout.write(`${writeAllowanceBook({ entity, storePath, since: option("since") ?? new Date(Date.now() - 31 * DAY).toISOString(), now })}\n`);
    process.stdout.write(`${writeResourcePrices({ storePath, at: now })}\n`);
    return;
  }
  if (command !== "status") throw new Error(`unknown command: ${command}`);
  const pools = allowancePools({ storePath }).filter((allowance) => option("allowance") === undefined || allowance.id === option("allowance"));
  for (const allowance of pools) {
    const longest = Math.max(...(allowance.meters ?? []).map((meter) => (meter.hours ?? 24) * 3_600_000), 7 * DAY);
    const since = option("since") ?? new Date(Date.now() - Math.min(7 * DAY, longest)).toISOString();
    const status = allowancePoolStatus(allowance, { storePath, since, now });
    process.stdout.write(rest.includes("--json") ? `${JSON.stringify(status)}\n` : `${allowancePoolText(status)}\n\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
