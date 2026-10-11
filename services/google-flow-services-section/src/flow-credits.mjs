#!/usr/bin/env node
/**
 * The account's Google Flow credits, read as perishable capacity.
 *
 * Flow draws a generation's credits from the day's grant first, then the month's; neither rolls
 * over. So what matters is not whether a generation may go, but what lapses if none does: the
 * day's grant at the day's turn, the month's remainder at renewal. Each run reads the balance and
 * the renewal instant from Flow, appends them to the credit journal (one JSON line per reading,
 * under the house's state directory), and reads the allowance (content/config/flow-allowance.json)
 * from the latest balance: what each grant has left, when it lapses, how many of each generation
 * still fit, and the pace that spends the month's grant by renewal.
 *
 * The journal (the one log: a semantic-record journal beside the reading path, see
 * `creditJournalRoot`) keeps each reading's renewal instant, which anchors the monthly meter. Each balance is
 * also recorded as evidence in the host's allowance ledger, where generation jobs hold credits
 * before they spend them, so a reading and a job's spends are read against one another. A balance
 * stands for every spend before it; successive balances are what show when the day turns.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { admitAllowance, admitAllowanceEvidence, readAllowance } from '@red-cup-engineering/organizing/enterprise';
import { allowanceLedgerLapses, allowanceLedgerPath, recordAllowanceEvidence } from '@red-cup-engineering/computer-inference-engine/media/allowance-ledger';
import { openLedgerJournal } from '@red-cup-engineering/computer-inference-engine/media/ledger-journal';
import { admitJsonlOnce, readAdmittingJsonl } from '@red-cup-engineering/semiotic-eavt-services-section/admit-jsonl-once';
import { openGoogleFlow } from './google-flow-client.mjs';

export const FLOW_ALLOWANCE_PATH = new URL('../content/config/flow-allowance.json', import.meta.url);
const DAY = 86_400_000;

export function creditJournalPath(env = process.env) {
  return env.GOOGLE_FLOW_CREDIT_JOURNAL ?? join(env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local', 'state'), '561-group', 'google-flow', 'credit-readings.jsonl');
}

export const loadFlowAllowanceConfig = (path = FLOW_ALLOWANCE_PATH) => JSON.parse(readFileSync(path, 'utf8'));

/** One balance reading as allowance evidence, its source naming the instant it was read. */
export const balanceEvidence = ({ at, balance }) => ({ type: 'balance', at, remaining: balance, source: `google-flow:credits@${at}` });

/**
 * The allowance the config states, its observed-anchored meters anchored at `renewsAt`, and its
 * prices Flow's own catalog's (`catalog`, from models(tier)) when one was read: every model that
 * spends credits at the plan's tier.
 */
export function flowAllowance(config, { renewsAt, catalog }) {
  const meters = config.meters.map((meter) => (meter.anchor !== 'observed' ? meter : (() => {
    if (!renewsAt) throw new TypeError(`Flow meter ${meter.id} is anchored at the observed renewal, and none was read`);
    return { ...meter, anchor: renewsAt };
  })()));
  const costs = catalog ? Object.fromEntries(catalog.filter(({ credits }) => credits > 0).map(({ key, credits }) => [key, credits])) : config.costs;
  return admitAllowance({ ...config, meters, costs });
}

/** The kind credit readings are kept under in the one log. */
export const FLOW_CREDIT_READING_OBJECT_KIND = 'google-flow.credit-reading';

/** The journal a reading path names: `credit-readings.jsonl` keeps its readings at `credit-readings.journal`. */
export const creditJournalRoot = (path = creditJournalPath()) => `${path.replace(/\.jsonl$/u, '')}.journal`;

/**
 * The credit journal: readings kept as held records in append order. A JSONL file of readings an
 * earlier release left at `path` is admitted once, read only, skipping readings already held, and
 * `jsonl-admission.json` in the journal marks that so it never repeats.
 */
function creditJournal(path) {
  const journal = openLedgerJournal(`${path.replace(/\.jsonl$/u, '')}`, FLOW_CREDIT_READING_OBJECT_KIND);
  const sources = [{ path, category: 'reading' }], identity = (reading) => JSON.stringify(reading);
  admitJsonlOnce(journal, sources, { identity, type: 'FlowCreditJsonlAdmission', from: path });
  return Object.freeze({ ...journal, read: (category) => readAdmittingJsonl(journal, sources, category, { identity }) });
}

/** Every reading in the journal, oldest first; none if there are none yet. */
export function readCreditJournal(path = creditJournalPath()) {
  return creditJournal(path).read('reading');
}

export function appendCreditReading(reading, path = creditJournalPath()) {
  creditJournal(path).record('reading', reading);
}

/**
 * The allowance read from the latest balance (and any spends since): per grant what is left and
 * when it lapses, the generations that fit, and `pace` — the credits a day that spend the
 * month's remainder by renewal, on top of each day's own grant.
 */
export function flowCreditReport({ config = loadFlowAllowanceConfig(), readings, spends = [], now = new Date().toISOString() }) {
  const latest = readings.at(-1);
  if (!latest) throw new TypeError('no Flow credit reading yet');
  const allowance = flowAllowance(config, { renewsAt: latest.renewsAt });
  const evidence = admitAllowanceEvidence([balanceEvidence(latest), ...spends]);
  const reading = readAllowance(allowance, evidence, { now });
  const monthly = reading.meters.find((meter) => meter.meter === 'monthly');
  const daily = reading.meters.find((meter) => meter.meter === 'daily');
  const days = monthly ? Math.max(1, Math.ceil((Date.parse(monthly.resetsAt) - Date.parse(now)) / DAY)) : null;
  return Object.freeze({
    ...reading,
    balance: Object.freeze({ at: latest.at, credits: latest.balance, renewsAt: latest.renewsAt }),
    pace: monthly && daily ? Object.freeze({
      daysToRenewal: days,
      creditsPerDay: Object.freeze({ lo: Math.ceil(monthly.remaining.lo / days) + daily.budget.lo, hi: Math.ceil((monthly.remaining.hi ?? Infinity) / days) + daily.budget.lo }),
      because: 'the month\'s remainder spread over the days to renewal, plus each day\'s own grant',
    }) : null,
  });
}

if (import.meta.main) {
  const flow = await openGoogleFlow();
  const at = new Date().toISOString();
  const { balance, renewsAt } = await flow.credits();
  const path = creditJournalPath();
  appendCreditReading({ at, balance, renewsAt }, path);
  const readings = readCreditJournal(path);
  const config = loadFlowAllowanceConfig();
  const allowance = flowAllowance(config, { renewsAt, catalog: await flow.models(config.tier) });
  const storePath = allowanceLedgerPath();
  recordAllowanceEvidence(allowance, readings.map(balanceEvidence), { storePath });
  const report = flowCreditReport({ config, readings, now: at });
  const lapses = readings[0].at < at ? allowanceLedgerLapses(allowance, { storePath, since: readings[0].at, now: at }) : [];
  process.stdout.write(`${JSON.stringify({ ...report, lapses }, null, 2)}\n`);
}
