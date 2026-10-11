/**
 * What the account has spent of its Gemini Notebook allowances, read back from Studio itself.
 *
 * Studio lists every artifact the account made — by this house's producers or by hand in the web
 * UI — with its kind, status, time and, for a video, the format it was asked for. Each artifact
 * that went through (completed, or still being made) is a spend; a failed one is not, and is not
 * a refusal either: Studio's failed rows carry no quota code, so only a provider's RATE_LIMITED
 * answer to a submission is a refusal, recorded where the submission is made.
 *
 * `syncStudioSpends` records those spends in the allowance ledger under each artifact's Studio
 * source, so work made by hand counts against the same windows producers hold from, and a
 * producer's own record of an artifact is the same spend. `studioAllowanceReport` reads what the
 * evidence teaches against each allowance's stated priors.
 */
import { admitAllowanceEvidence, learnAllowance, readAllowance } from '@red-cup-engineering/organizing/enterprise';
import { recordAllowanceEvidence } from '@red-cup-engineering/computer-inference-engine/media/allowance-ledger';
import { openGeminiNotebook } from './gemini-notebook-client.mjs';
import { studioKind, studioSource } from './allowances.mjs';

const SPENT = new Set(['completed', 'in-progress', 'pending']);

/** The kind of work a Studio row drew: a video by its format, any other artifact by its kind. */
export const studioCapability = (row) => studioKind(row.kind, row.videoFormat);

/** Studio's rows since `since`, across every notebook the account holds, oldest first. */
export async function readStudioRows({ notebook, since }) {
  const client = notebook ?? await openGeminiNotebook();
  const from = Date.parse(since);
  const rows = [];
  for (const { id } of await client.listNotebooks()) {
    for (const row of await client.listArtifacts(id)) if (Date.parse(row.createdAt) >= from) rows.push({ ...row, notebookId: id });
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Allowance evidence from Studio rows: one spend per artifact that went through. */
export function studioSpends(rows) {
  return admitAllowanceEvidence(rows.filter((row) => SPENT.has(row.status) && row.createdAt).map((row) => ({
    type: 'spend', kind: studioCapability(row), at: row.createdAt, source: studioSource(row.notebookId, row.id),
  })));
}

/** Record Studio's spends since each allowance's statement in the ledger; returns how many were new per allowance. */
export function syncStudioSpends({ allowances, spends, storePath }) {
  return Object.fromEntries(allowances.map((allowance) => {
    const since = Date.parse(allowance.statedAt);
    const own = spends.filter((spend) => spend.kind in allowance.costs && spend.at >= since).map((spend) => ({ ...spend, at: new Date(spend.at).toISOString() }));
    return [allowance.id, own.length ? recordAllowanceEvidence(allowance, own, { storePath }) : 0];
  }));
}

/**
 * Studio's history read against each allowance: whether the priors held, were dropped as
 * contradicted, or are undecided, what each budget and price is now known to be, and the current
 * window's fit and slack. Kinds Studio shows that no allowance meters are listed as unmetered.
 */
export function studioAllowanceReport({ allowances, spends, now }) {
  const metered = new Set(allowances.flatMap((allowance) => Object.keys(allowance.costs)));
  const unmetered = [...new Set(spends.filter((spend) => !metered.has(spend.kind)).map((spend) => spend.kind))].sort();
  const lines = allowances.map((allowance) => {
    const evidence = spends.filter((spend) => spend.kind in allowance.costs && spend.at >= Date.parse(allowance.statedAt));
    const reading = readAllowance(allowance, evidence, { now });
    const { loads } = learnAllowance(allowance, evidence);
    return {
      allowance: allowance.id, product: allowance.product, since: allowance.statedAt, contested: reading.contested, priors: reading.priors,
      learnedFrom: reading.learnedFrom, costs: reading.costs, meters: reading.meters, fits: reading.fits, counts: reading.counts, slack: reading.slack,
      fullestWindows: Object.fromEntries(Object.entries(loads).map(([meter, { accepted }]) => [meter, accepted.map((load) => Object.fromEntries(load))])),
    };
  });
  return { unmetered, allowances: lines };
}
