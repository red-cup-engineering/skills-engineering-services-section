#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLedger, journalText } from "@red-cup-engineering/energy-bank/ledger";
import { checkBooksBalance } from "@red-cup-engineering/energy-bank/invariants";
import * as decimal from "@red-cup-engineering/energy-bank/decimal";
import { runMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";

const TOKENS_COMMODITY = "tokens";

/** Signal a refusal with a machine-readable datum, without throwing a bare message. */
class LedgerPostingRefusal extends Error {
  constructor(datum) {
    super(datum.error);
    this.datum = datum;
  }
}

/**
 * Convert an exact `{numerator, denominator}` fraction (as carried by
 * `recordInferencePurchase`'s `price.amount`) into energy-bank's finite
 * decimal-string amount shape. Exact whenever `denominator` is a power of
 * ten (every observed house receipt uses `denominator: "1"`); a rational
 * price with any other denominator has no lossless finite-decimal
 * rendering, so this throws rather than rounding -- per the "never convert
 * units" rule, that case is a real gap in energy-bank's decimal.mjs
 * (finite-decimal-string amounts only, no general rational), not a value
 * this script may invent an approximation for.
 * @param {string} numeratorText
 * @param {string} denominatorText
 * @returns {string} a decimal string accepted by `decimal.parse`.
 * @throws {Error} when the fraction is not exactly representable as a finite decimal.
 */
export function fractionToDecimalString(numeratorText, denominatorText) {
  const numerator = BigInt(numeratorText);
  if (numerator === 0n) return "0";
  let denominator = BigInt(denominatorText);
  let places = 0;
  while (denominator % 10n === 0n) {
    denominator /= 10n;
    places += 1;
  }
  if (denominator !== 1n) {
    throw new Error(
      `price amount ${numeratorText}/${denominatorText} is not representable as a finite decimal -- ` +
        `energy-bank's decimal.mjs carries only finite-decimal-string amounts, never a general rational`,
    );
  }
  const negative = numerator < 0n;
  const digits = (negative ? -numerator : numerator).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places) || "0";
  const fraction = digits.slice(digits.length - places);
  const body = fraction.length ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}

/** The commodity symbol for a purchase's price: its denomination's three
 *  fields joined so distinct assets/units never collide under one symbol
 *  (e.g. two providers both priced in "token" units of different models). */
function considerationCommodity({ kind, asset, unit }) {
  return `${kind}-${asset}-${unit}`;
}

function expenseAccount(provider, model) {
  return `expense:inference:${provider}:${model}`;
}
function liabilityAccount(provider) {
  return `liability:provider:${provider}`;
}
function resourceAccount(provider, model) {
  return `resource:inference-tokens:${provider}:${model}`;
}

/** Minimal required-shape check for one purchase event's `v` payload -- just
 *  enough to safely address ledger accounts and amounts; anything else in
 *  the harness-lifecycle-event schema is not this script's concern. */
function requiredPurchaseShape(v) {
  return (
    v && Object.getPrototypeOf(v) === Object.prototype &&
    typeof v.provider === "string" && v.provider !== "" &&
    typeof v.model === "string" && v.model !== "" &&
    typeof v.exchangeId === "string" && v.exchangeId !== "" &&
    v.price && Object.getPrototypeOf(v.price) === Object.prototype &&
    v.price.denomination && typeof v.price.denomination.kind === "string" &&
    typeof v.price.denomination.asset === "string" && typeof v.price.denomination.unit === "string" &&
    v.price.amount && typeof v.price.amount.numerator === "string" && typeof v.price.amount.denominator === "string"
  );
}

/**
 * Parse a purchase-receipt journal's raw JSONL text into purchase events,
 * naming every malformed line rather than skipping it silently. Lines
 * whose envelope `a` is not `"inference-purchased"` are not purchases (a
 * receipt journal may carry other semantic-record categories alongside
 * purchases, as house journals in the wild do) and are skipped without
 * comment; blank lines are skipped too.
 * @param {string} text - the journal file's full content.
 * @returns {{purchases: {line: number, recordedAt: string, event: object}[], failures: {line: number, detail: string}[]}}
 */
export function parseInferencePurchaseJournal(text) {
  const purchases = [];
  const failures = [];
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const lineNumber = index + 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      failures.push({ line: lineNumber, detail: `not valid JSON: ${error.message}` });
      return;
    }
    if (!row || Object.getPrototypeOf(row) !== Object.prototype || row.a === undefined) {
      failures.push({ line: lineNumber, detail: "not a semantic-record envelope object (missing \"a\")" });
      return;
    }
    if (row.a !== "inference-purchased") return;
    if (!requiredPurchaseShape(row.v)) {
      failures.push({ line: lineNumber, detail: "inference-purchased envelope is missing a required purchase field" });
      return;
    }
    purchases.push({ line: lineNumber, recordedAt: row.t, event: row.v });
  });
  return { purchases, failures };
}

/**
 * Derive an energy-bank ledger from a purchase-receipt journal's raw text:
 * one balanced double-entry posting per denomination actually present in
 * each purchase. A nonzero price posts `expense:inference:<provider>:<model>`
 * debit / `liability:provider:<provider>` credit, in the price's own
 * denomination -- never converted, never invented. Reported token usage
 * posts a second, separately balanced entry in commodity `tokens`: input
 * and output each debit `resource:inference-tokens:<provider>:<model>`
 * (preserved as two distinct line items, not summed), balanced by one
 * credit of their sum against `liability:provider:<provider>` in commodity
 * `tokens` -- the same counterparty account the price entry credits,
 * carrying a second, independent per-commodity balance.
 *
 * Deterministic and idempotent: ledger refs are the envelope's own
 * content-addressed digest (`row.e`), so re-running over the same journal
 * bytes yields the same journal bytes back.
 *
 * @param {string} text - a purchase-receipt journal's raw JSONL content, as written by `recordInferencePurchase`.
 * @returns {{ok: true, journalText: string, summary: object} | {ok: false, error: string, [key: string]: unknown}}
 */
export function postInferencePurchasesToLedger(text) {
  const { purchases, failures } = parseInferencePurchaseJournal(text);
  if (failures.length > 0) {
    return { ok: false, error: "malformed-purchase-line", failures };
  }

  const ledger = createLedger();
  const byProvider = new Map();
  let unpriced = 0;

  function providerBucket(provider) {
    let bucket = byProvider.get(provider);
    if (!bucket) {
      bucket = { creditsDecimal: decimal.parse("0"), inputTokens: 0, outputTokens: 0 };
      byProvider.set(provider, bucket);
    }
    return bucket;
  }

  for (const { line, recordedAt, event } of purchases) {
    const { provider, model, exchangeId, price, usage } = event;
    const ref = `ni:${exchangeId}`;
    const date = (typeof recordedAt === "string" ? recordedAt : undefined) ?? "0000-00-00";
    let amountText;
    try {
      amountText = fractionToDecimalString(price.amount.numerator, price.amount.denominator);
    } catch (error) {
      return { ok: false, error: "unrepresentable-price", line, detail: error.message };
    }

    if (amountText === "0") {
      unpriced += 1;
    } else {
      const commodity = considerationCommodity(price.denomination);
      ledger.record({
        date: date.slice(0, 10),
        narration: `inference purchase ${provider}/${model} (${event.outcome})`,
        ref: `${ref}:consideration`,
        postings: [
          { account: expenseAccount(provider, model), amount: amountText, commodity },
          { account: liabilityAccount(provider), amount: decimal.format(decimal.negate(decimal.parse(amountText))), commodity },
        ],
      });
      const bucket = providerBucket(provider);
      bucket.creditsDecimal = decimal.add(bucket.creditsDecimal, decimal.parse(amountText));
    }

    const inputQuantity = usage?.input?.quantity;
    const outputQuantity = usage?.output?.quantity;
    if (inputQuantity !== undefined || outputQuantity !== undefined) {
      const input = inputQuantity ?? 0;
      const output = outputQuantity ?? 0;
      const postings = [];
      if (inputQuantity !== undefined) postings.push({ account: resourceAccount(provider, model), amount: String(input), commodity: TOKENS_COMMODITY });
      if (outputQuantity !== undefined) postings.push({ account: resourceAccount(provider, model), amount: String(output), commodity: TOKENS_COMMODITY });
      postings.push({ account: liabilityAccount(provider), amount: String(-(input + output)), commodity: TOKENS_COMMODITY });
      ledger.record({
        date: date.slice(0, 10),
        narration: `inference token usage ${provider}/${model}`,
        ref: `${ref}:tokens`,
        postings,
      });
      const bucket = providerBucket(provider);
      bucket.inputTokens += input;
      bucket.outputTokens += output;
    }
  }

  const violations = checkBooksBalance(ledger);
  if (violations.length > 0) {
    return { ok: false, error: "books-do-not-balance", violations };
  }

  const summary = {
    purchases: purchases.length,
    postings: ledger.all().length,
    byProvider: Object.fromEntries(
      [...byProvider.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([provider, bucket]) => [
          provider,
          { credits: decimal.format(bucket.creditsDecimal), inputTokens: bucket.inputTokens, outputTokens: bucket.outputTokens },
        ]),
    ),
    unpriced,
  };

  return { ok: true, journalText: journalText(ledger.all()), summary };
}

/**
 * CLI entry point: reads one purchase-receipt journal file and derives its
 * energy-bank ledger.
 * @param {string[]} argv - `<path> [--out <journal-file>]`.
 * @returns {{journalText?: string, summary: object}} `summary` always; `journalText` only when printed inline (no `--out`).
 * @throws {LedgerPostingRefusal} carrying `.datum` when a line is malformed, a price cannot be posted, or the books do not balance.
 */
export function postSetOfInferencePurchasesToLedgerCli(argv) {
  let path;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out") { index += 1; continue; }
    if (!argv[index].startsWith("--")) { path = argv[index]; break; }
  }
  if (!path) throw new Error("usage: post-set-of-inference-purchases-to-ledger.mjs <purchase-journal.jsonl> [--out <journal-file>]");
  const outPath = argument("--out", argv);
  const text = readFileSync(resolve(path), "utf8");
  const result = postInferencePurchasesToLedger(text);
  if (!result.ok) throw new LedgerPostingRefusal(result);
  if (outPath) {
    writeFileSync(resolve(outPath), `${result.journalText}\n`);
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.journalText}\n`);
    process.stderr.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  }
  return result.summary;
}

runMain(({ argv }) => postSetOfInferencePurchasesToLedgerCli(argv), {
  moduleUrl: import.meta.url,
  isEntry: () => import.meta.main,
  formatResult: () => "",
  formatError: (error) => `${JSON.stringify(error?.datum ?? { error: error?.message ?? String(error) })}\n`,
  exitCode: 2,
});
