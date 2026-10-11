#!/usr/bin/env node
/**
 * The Gemini Notebook account's allowances, for operators.
 *
 *   status [--since <instant>]                each allowance's current window (fit, what is left,
 *                                             live holds) and what lapsed since (default: 7 days)
 *   sync                                      record Studio's spends since the allowances were
 *                                             stated in the ledger (work made by hand included)
 *   refused <format|kind> --reference <text>  record that the account refused that work for quota
 *   report                                    what Studio's history teaches against the priors
 *
 * Everything lands in the inference engine's allowance ledger every producer holds from.
 */
import { pathToFileURL } from 'node:url';
import { allowanceLedgerLapses, allowanceLedgerPath, readAllowanceLedger, recordAllowanceEvidence } from '@red-cup-engineering/computer-inference-engine/media/allowance-ledger';
import { loadNotebookAllowances, videoCapability } from './allowances.mjs';
import { readStudioRows, studioAllowanceReport, studioSpends, syncStudioSpends } from './studio-allowance.mjs';
import {readNotebookUsage} from './quota.mjs';

const DAY = 86_400_000;
const later = (a, b) => (Date.parse(a) > Date.parse(b) ? a : b);

/** One allowance's current window and what lapsed since `since` (no earlier than its statement). */
export function allowanceWindowStatus(allowance, { storePath, since, now = new Date().toISOString() }) {
  const { reading, holds } = readAllowanceLedger(allowance, { storePath, now });
  const lapses = allowanceLedgerLapses(allowance, { storePath, since: later(since, allowance.statedAt), now });
  return {
    allowance: allowance.id, costs: reading.costs, contested: reading.contested, priors: reading.priors,
    windows: reading.meters.map(({ meter, opensAt, resetsAt, budget, spent, remaining }) => ({ meter, opensAt, resetsAt, budget, spent, remaining })),
    fits: reading.fits, counts: reading.counts, holds: holds.map(({ id, kind, state, principal, reference, at }) => ({ id, kind, state, principal, reference, at })),
    since: lapses.since, lapsed: lapses.meters.map(({ meter, spent, wasted, idleWindows, utilization }) => ({ meter, spent, wasted, idleWindows, utilization })),
  };
}

async function main(argv) {
  const [command = 'status', ...rest] = argv;
  const option = (name) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };
  const positional = rest.filter((value, index) => !value.startsWith('--') && !rest[index - 1]?.startsWith('--'));
  const storePath = allowanceLedgerPath(process.env);
  const allowances = loadNotebookAllowances();
  const now = new Date().toISOString();
  const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const studio = async () => studioSpends(await readStudioRows({ since: allowances.map(({ statedAt }) => statedAt).sort()[0] }));
  if (command === 'status') {
    out(await readNotebookUsage({force:true}));
  } else if (command === 'sync') {
    out({ recorded: syncStudioSpends({ allowances, spends: await studio(), storePath }) });
  } else if (command === 'report') {
    process.stdout.write(`${JSON.stringify(studioAllowanceReport({ allowances, spends: await studio(), now }), null, 2)}\n`);
  } else if (command === 'refused') {
    const reference = option('reference');
    if (!reference) throw new Error('refused requires --reference <what was seen>');
    const [named] = positional;
    const kind = allowances.some((allowance) => named in allowance.costs) ? named : videoCapability(named);
    const allowance = allowances.find((candidate) => kind in candidate.costs);
    if (!allowance) throw new Error(`no allowance meters ${named}`);
    recordAllowanceEvidence(allowance, [{ type: 'refusal', kind, at: now, source: `operator:${now}:${reference}` }], { storePath });
    out(allowanceWindowStatus(allowance, { storePath, since: now, now }));
  } else throw new Error(`unknown command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
