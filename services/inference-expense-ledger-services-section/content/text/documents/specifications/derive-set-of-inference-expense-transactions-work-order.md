# derive-set-of-inference-expense-transactions
## Requirements
- `aggregated-per-day-per-provider-model`: Token-usage records are grouped by provider, model, and calendar date (the first 10 characters of the record's timestamp), and one Beancount transaction is rendered per group.
- `priced-against-directives`: Each group's cost is the sum, over every token class with a non-zero token count in the group (input, output, cache-read, cache-write), of the group's summed token count for that class divided into millions and multiplied by the matching price directive's per-million-token price, at or before the group's date; every division and multiplication is exact decimal arithmetic, never a floating-point number.
- `posts-expense-against-payable`: Each transaction posts the group's total USD cost to `Expenses:Inference-and-Compute:<Provider>` and its exact negation to `Liabilities:Accounts-Payable:<Provider>`, `<Provider>` being the provider name capitalized into one Beancount account component.
- `witness-and-count-in-metadata`: Each transaction carries the group's record count and the comma-joined usage-record ids that composed it (its witnesses) as Beancount metadata, alongside the summed token counts per class.
- `accounts-opened-at-first-use`: The output names one `open` directive, dated no later than its account's first use, for every `Expenses:Inference-and-Compute:<Provider>` or `Liabilities:Accounts-Payable:<Provider>` account any transaction references and that is not already named in the input's `openAccounts`.
- `refusal-without-price-directive`: A group with a non-zero token count in a class for which no matching price directive exists on or before the group's date is refused as a whole, naming every constituent record id and the missing class, and produces no transaction.
## Prohibitions
- `no-network-io`: The operation performs no network call, file read, or file write; it is a pure function of its input.
- `no-float-money`: No monetary computation uses a native floating-point arithmetic operator; every amount is parsed, divided, added, or multiplied through exact decimal-string arithmetic.
- `no-unbalanced-transaction`: A rendered transaction's two postings must always sum to exactly zero USD.
- `no-silent-price-guess`: A token class with a non-zero token count and no matching price directive must never be priced at zero or skipped silently; its group is refused instead.
## Laws
- `pure-data-transformation-law` | The language law (asserted 2026-08-30) | v1 | .claude/rules/org-layering.md | Applies to deriveSetOfInferenceExpenseTransactions as data transformation, never I/O. | I/O with a system is written in Node; a decision that is only data transformation performs no I/O of its own.
- `standards-first-data-law` | Standards-first data, networking, and deployment (specified 2026-09-04) | v1 | .claude/rules/org-layering.md | Applies to the inference expense candidates as a plain-text double-entry account primitive. | An existing open standard is preferred over a house format every time one fits; plain-text double-entry accounting (Beancount) is named as one of the preferred standards.
- `candidates-not-appends` | Owner working discipline (task:inference-expense-ledger) | v1 | .claude/rules/session-bootstrap.md | Applies to every transaction and open directive this operation renders. | The operation renders candidate directives only; appending them to the main ledger is a separate, later act by the bookkeeper.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation, its import.meta.main guard, and downstream package-birth assays. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
- `iso-8601-date-time` | ISO 8601 | 2019 | https://www.iso.org/iso-8601-date-and-time-format.html | Applies to every usage record's timestamp. | Timestamps are ISO 8601 date-time strings; the calendar date is their first 10 characters.
- `beancount-double-entry-syntax` | Beancount | v3.2 | https://beancount.github.io/docs/beancount_language_syntax.html | Applies to every rendered `open` and transaction directive. | Directives use Beancount's plain-text double-entry syntax: dated `open` accounts and `*` transactions whose postings sum to zero per currency; conformance is verified by `bean-check`.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/derive-set-of-inference-expense-transactions-service","packageVersion":"0.2.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/computer-ledger-system-services-section":"0.2.0"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/derive-set-of-inference-expense-transactions.mjs
#!/usr/bin/env node
import {
  addDecimalStrings,
  formatScaled,
  multiplyDecimalStrings,
  parseDecimal,
} from "@red-cup-engineering/computer-ledger-system-services-section/src/decimal.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u;
const TOKEN_CLASSES = ["input", "output", "cache-read", "cache-write"];
const CLASS_FIELD = { input: "inputTokens", output: "outputTokens", "cache-read": "cacheReadTokens", "cache-write": "cacheCreationTokens" };

function requireString(value, context) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be a non-empty string`);
  return value;
}

function requireTimestamp(value, context) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be an ISO 8601 date-time string`);
  return value;
}

function requireDate(value, context) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be a YYYY-MM-DD date string`);
  return value;
}

function requireDecimalString(value, context) {
  if (typeof value !== "string") throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be a plain decimal string`);
  try {
    parseDecimal(value);
  } catch {
    throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be a plain decimal string`);
  }
  return value;
}

function requireNonNegativeInteger(value, context) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be a non-negative integer`);
  return value;
}

function requireTokenClass(value, context) {
  if (!TOKEN_CLASSES.includes(value)) throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be one of ${TOKEN_CLASSES.join(", ")}`);
  return value;
}

/**
 * The exact negation of a plain decimal string, via `parseDecimal`/`formatScaled` so the sign
 * flip never touches a floating-point number.
 * @param {string} text
 * @returns {string}
 */
function negateDecimalString(text) {
  const { negative, whole, frac } = parseDecimal(text);
  const magnitude = BigInt(`${whole}${frac}`);
  if (magnitude === 0n) return formatScaled(0n, frac.length);
  return formatScaled(negative ? magnitude : -magnitude, frac.length);
}

/**
 * Divides a non-negative token count by one million exactly, by shifting its decimal point six
 * places left, never a floating-point division.
 * @param {number} tokenCount
 * @returns {string}
 */
function tokensToMillions(tokenCount) {
  const padded = String(tokenCount).padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/u, "");
  const frac = padded.slice(-6).replace(/0+$/u, "");
  return frac === "" ? whole : `${whole}.${frac}`;
}

/**
 * Capitalizes each hyphen- or space-separated word of a provider name into one Beancount
 * account component, leaving a word that starts with a digit unchanged.
 * @param {string} text
 * @returns {string}
 */
function toAccountComponent(text) {
  return String(text)
    .trim()
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map((word) => (/^\d/u.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("-");
}

function validateUsageRecord(record, index) {
  const context = `usageRecords[${index}]`;
  if (record === null || typeof record !== "object") throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be an object`);
  requireString(record.recordId, `${context}.recordId`);
  requireString(record.sessionId, `${context}.sessionId`);
  requireString(record.provider, `${context}.provider`);
  requireString(record.model, `${context}.model`);
  requireTimestamp(record.timestamp, `${context}.timestamp`);
  requireNonNegativeInteger(record.inputTokens, `${context}.inputTokens`);
  requireNonNegativeInteger(record.outputTokens, `${context}.outputTokens`);
  requireNonNegativeInteger(record.cacheReadTokens ?? 0, `${context}.cacheReadTokens`);
  requireNonNegativeInteger(record.cacheCreationTokens ?? 0, `${context}.cacheCreationTokens`);
}

function validatePriceDirective(directive, index) {
  const context = `priceDirectives[${index}]`;
  if (directive === null || typeof directive !== "object") throw new TypeError(`derive-set-of-inference-expense-transactions: ${context} must be an object`);
  requireString(directive.provider, `${context}.provider`);
  requireString(directive.model, `${context}.model`);
  requireTokenClass(directive.tokenClass, `${context}.tokenClass`);
  requireDate(directive.date, `${context}.date`);
  requireDecimalString(directive.price, `${context}.price`);
}

function findPrice(priceDirectives, provider, model, tokenClass, asOfDate) {
  const candidates = priceDirectives.filter((d) => d.provider === provider && d.model === model && d.tokenClass === tokenClass && d.date <= asOfDate);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, entry) => (entry.date > latest.date ? entry : latest));
}

function renderMetadata(metadata) {
  return Object.entries(metadata)
    .map(([key, value]) => `  ${key}: "${value}"`)
    .join("\n");
}

function renderExpenseTransaction({ date, narration, metadata, expenseAccount, payableAccount, amountUsd }) {
  const lines = [`${date} * "${narration}"`, renderMetadata(metadata), `  ${expenseAccount}  ${amountUsd} USD`, `  ${payableAccount}  ${negateDecimalString(amountUsd)} USD`];
  return lines.join("\n");
}

/**
 * @typedef {Object} InferenceTokenUsageRecord
 * @property {string} recordId
 * @property {string} sessionId
 * @property {string} [actor]
 * @property {string} provider
 * @property {string} model
 * @property {string} timestamp
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheCreationTokens]
 * @typedef {Object} InferencePriceDirectiveLookup
 * @property {string} provider
 * @property {string} model
 * @property {"input"|"output"|"cache-read"|"cache-write"} tokenClass
 * @property {string} date
 * @property {string} price
 * @typedef {Object} InferenceExpenseTransactionsRequest
 * @property {InferenceTokenUsageRecord[]} usageRecords
 * @property {InferencePriceDirectiveLookup[]} priceDirectives
 * @property {string[]} [openAccounts]
 * @typedef {Object} InferenceExpenseTransaction
 * @property {string} provider
 * @property {string} model
 * @property {string} date
 * @property {number} recordCount
 * @property {string} totalUsd
 * @property {string} directive
 * @typedef {Object} AccountToOpen
 * @property {string} account
 * @property {string} date
 * @property {string} directive
 * @typedef {Object} InferenceExpenseRefusal
 * @property {string} provider
 * @property {string} model
 * @property {string} date
 * @property {string[]} recordIds
 * @property {string} reason
 * @typedef {Object} InferenceExpenseTransactionSet
 * @property {"InferenceExpenseTransactionSet"} type
 * @property {1} version
 * @property {number} transactionCount
 * @property {InferenceExpenseTransaction[]} transactions
 * @property {string} totalUsd
 * @property {AccountToOpen[]} accountsToOpen
 * @property {InferenceExpenseRefusal[]} refusals
 */

/**
 * Prices token-usage records into Beancount expense-transaction candidates: records are grouped per provider, model, and calendar date; each group's per-class token counts are converted exactly into millions and priced against the matching price directive on or before the group's date, summed into one USD cost posted to `Expenses:Inference-and-Compute:<Provider>` against its exact negation in `Liabilities:Accounts-Payable:<Provider>`; a group with a non-zero class token count and no matching price directive is refused as a whole rather than priced at zero, and every referenced account not already in `openAccounts` gets one `open` directive dated at its first use. Each transaction carries the group's distinct usage-record `sessionId`s as comma-joined `session_ids` metadata, so a later books surface can pivot cost by session.
 * @param {InferenceExpenseTransactionsRequest} input A record with `usageRecords`, `priceDirectives`, and optional `openAccounts`.
 * @returns {InferenceExpenseTransactionSet} The derived transactions, account-open directives, grand total, and refusals.
 * @throws {TypeError} When the input, a usage record, or a price directive is malformed.
 */
export function deriveSetOfInferenceExpenseTransactions(input) {
  if (input === null || typeof input !== "object") throw new TypeError("derive-set-of-inference-expense-transactions: input must be an object");
  if (!Array.isArray(input.usageRecords)) throw new TypeError("derive-set-of-inference-expense-transactions: input.usageRecords must be an array");
  if (!Array.isArray(input.priceDirectives)) throw new TypeError("derive-set-of-inference-expense-transactions: input.priceDirectives must be an array");
  input.usageRecords.forEach((record, index) => validateUsageRecord(record, index));
  input.priceDirectives.forEach((directive, index) => validatePriceDirective(directive, index));
  const openAccounts = new Set(Array.isArray(input.openAccounts) ? input.openAccounts : []);

  const groups = new Map();
  for (const record of input.usageRecords) {
    const date = record.timestamp.slice(0, 10);
    const key = `${record.provider} ${record.model} ${date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider: record.provider, model: record.model, date, recordIds: [], sessionIds: [],
        tokens: { input: 0, output: 0, "cache-read": 0, "cache-write": 0 },
      });
    }
    const group = groups.get(key);
    group.recordIds.push(record.recordId);
    if (!group.sessionIds.includes(record.sessionId)) group.sessionIds.push(record.sessionId);
    group.tokens.input += record.inputTokens;
    group.tokens.output += record.outputTokens;
    group.tokens["cache-read"] += record.cacheReadTokens ?? 0;
    group.tokens["cache-write"] += record.cacheCreationTokens ?? 0;
  }

  const transactions = [];
  const refusals = [];
  const accountsToOpenByName = new Map();
  const noteAccount = (account, date) => {
    if (openAccounts.has(account)) return;
    const existing = accountsToOpenByName.get(account);
    if (!existing || date < existing.date) accountsToOpenByName.set(account, { account, date });
  };

  for (const group of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))) {
    const neededClasses = TOKEN_CLASSES.filter((tokenClass) => group.tokens[tokenClass] > 0);
    const missing = neededClasses.filter((tokenClass) => findPrice(input.priceDirectives, group.provider, group.model, tokenClass, group.date) === null);
    if (missing.length > 0) {
      refusals.push({ provider: group.provider, model: group.model, date: group.date, recordIds: [...group.recordIds], reason: `no price directive on or before ${group.date} for ${group.provider} ${group.model} token class(es): ${missing.join(", ")}` });
      continue;
    }
    const classCosts = neededClasses.map((tokenClass) => {
      const priceEntry = findPrice(input.priceDirectives, group.provider, group.model, tokenClass, group.date);
      return multiplyDecimalStrings(tokensToMillions(group.tokens[tokenClass]), priceEntry.price);
    });
    const totalUsd = addDecimalStrings(classCosts.length > 0 ? classCosts : ["0"]);
    const providerComponent = toAccountComponent(group.provider);
    const expenseAccount = `Expenses:Inference-and-Compute:${providerComponent}`;
    const payableAccount = `Liabilities:Accounts-Payable:${providerComponent}`;
    noteAccount(expenseAccount, group.date);
    noteAccount(payableAccount, group.date);
    const metadata = {
      provider: group.provider,
      model: group.model,
      record_count: String(group.recordIds.length),
      witness_record_ids: group.recordIds.join(","),
      session_ids: group.sessionIds.join(","),
      input_tokens: String(group.tokens.input),
      output_tokens: String(group.tokens.output),
      cache_read_tokens: String(group.tokens["cache-read"]),
      cache_creation_tokens: String(group.tokens["cache-write"]),
    };
    transactions.push({
      provider: group.provider,
      model: group.model,
      date: group.date,
      recordCount: group.recordIds.length,
      totalUsd,
      directive: renderExpenseTransaction({
        date: group.date,
        narration: `Inference and compute: ${group.provider} ${group.model} (${group.recordIds.length} records)`,
        metadata,
        expenseAccount,
        payableAccount,
        amountUsd: totalUsd,
      }),
    });
  }

  const accountsToOpen = [...accountsToOpenByName.values()]
    .sort((a, b) => a.account.localeCompare(b.account))
    .map(({ account, date }) => ({ account, date, directive: `${date} open ${account} USD` }));

  return Object.freeze({
    type: "InferenceExpenseTransactionSet",
    version: 1,
    transactionCount: transactions.length,
    transactions: Object.freeze(transactions),
    totalUsd: transactions.length > 0 ? addDecimalStrings(transactions.map((t) => t.totalUsd)) : "0",
    accountsToOpen: Object.freeze(accountsToOpen),
    refusals: Object.freeze(refusals),
  });
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("deriveSetOfInferenceExpenseTransactions — Prices token-usage records into Beancount expense-transaction candidates: records are grouped per provider, model, and calendar date; each group's per-class token counts are converted exactly into millions and priced against the matching price directive on or before the group's date, summed into one USD cost posted to `Expenses:Inference-and-Compute:<Provider>` against its exact negation in `Liabilities:Accounts-Payable:<Provider>`; a group with a non-zero class token count and no matching price directive is refused as a whole rather than priced at zero, and every referenced account not already in `openAccounts` gets one `open` directive dated at its first use. Each transaction carries the group's distinct usage-record sessionIds as comma-joined session_ids metadata.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) process.stdout.write(`${JSON.stringify(deriveSetOfInferenceExpenseTransactions(JSON.parse(line)))}\n`);
    }
  }
}

```
## Tests
```mjs path=test/derive-set-of-inference-expense-transactions.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { deriveSetOfInferenceExpenseTransactions } from "../scripts/derive-set-of-inference-expense-transactions.mjs";

const priceDirectives = [
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "input", date: "2026-06-24", price: "2.00" },
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "output", date: "2026-06-24", price: "10.00" },
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "cache-read", date: "2026-06-24", price: "0.20" },
  { provider: "claude", model: "claude-sonnet-5", tokenClass: "cache-write", date: "2026-06-24", price: "2.50" },
];

test("aggregates two records for the same day/provider/model into one balanced transaction", () => {
  const result = deriveSetOfInferenceExpenseTransactions({
    usageRecords: [
      { recordId: "r1", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T10:00:00.000Z", inputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { recordId: "r2", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T11:00:00.000Z", inputTokens: 0, outputTokens: 500000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ],
    priceDirectives,
  });
  assert.equal(result.transactionCount, 1);
  const [tx] = result.transactions;
  assert.equal(tx.recordCount, 2);
  assert.equal(tx.totalUsd, "7"); // 1,000,000 tok @ $2.00/M = $2.00 + 500,000 tok @ $10.00/M = $5.00
  assert.match(tx.directive, /Expenses:Inference-and-Compute:Claude\s+7 USD/u);
  assert.match(tx.directive, /Liabilities:Accounts-Payable:Claude\s+-7 USD/u);
  assert.match(tx.directive, /witness_record_ids: "r1,r2"/u);
  assert.match(tx.directive, /session_ids: "s1"/u);
  assert.equal(result.accountsToOpen.length, 2);
  assert.equal(result.totalUsd, "7");
  assert.equal(result.refusals.length, 0);
});

test("carries every distinct sessionId in a group as comma-joined session_ids metadata", () => {
  const result = deriveSetOfInferenceExpenseTransactions({
    usageRecords: [
      { recordId: "r1", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T10:00:00.000Z", inputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { recordId: "r2", sessionId: "s2", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T11:00:00.000Z", inputTokens: 0, outputTokens: 500000, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { recordId: "r3", sessionId: "s1", provider: "claude", model: "claude-sonnet-5", timestamp: "2026-09-04T12:00:00.000Z", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ],
    priceDirectives,
  });
  assert.equal(result.transactionCount, 1);
  assert.match(result.transactions[0].directive, /session_ids: "s1,s2"/u);
});

test("refuses a group with a used token class that has no matching price directive", () => {
  const result = deriveSetOfInferenceExpenseTransactions({
    usageRecords: [
      { recordId: "r1", sessionId: "s1", provider: "openai", model: "gpt-unknown", timestamp: "2026-09-04T10:00:00.000Z", inputTokens: 100, outputTokens: 10 },
    ],
    priceDirectives,
  });
  assert.equal(result.transactionCount, 0);
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0].recordIds[0], "r1");
  assert.match(result.refusals[0].reason, /no price directive/u);
});

test("refuses a malformed usage record", () => {
  assert.throws(() => deriveSetOfInferenceExpenseTransactions({ usageRecords: [{ recordId: "r1" }], priceDirectives: [] }), /sessionId must be a non-empty string/u);
});

```
## Examples
```json name="derive-set-of-inference-expense-transactions example"
{"input":{"usageRecords":[{"recordId":"r1","sessionId":"s1","provider":"claude","model":"claude-sonnet-5","timestamp":"2026-09-04T10:00:00.000Z","inputTokens":1000000,"outputTokens":500000,"cacheReadTokens":0,"cacheCreationTokens":0}],"priceDirectives":[{"provider":"claude","model":"claude-sonnet-5","tokenClass":"input","date":"2026-06-24","price":"2.00"},{"provider":"claude","model":"claude-sonnet-5","tokenClass":"output","date":"2026-06-24","price":"10.00"}]},"output":{"type":"InferenceExpenseTransactionSet","version":1,"transactionCount":1,"transactions":[{"provider":"claude","model":"claude-sonnet-5","date":"2026-09-04","recordCount":1,"totalUsd":"7","directive":"2026-09-04 * \"Inference and compute: claude claude-sonnet-5 (1 records)\"\n  provider: \"claude\"\n  model: \"claude-sonnet-5\"\n  record_count: \"1\"\n  witness_record_ids: \"r1\"\n  input_tokens: \"1000000\"\n  output_tokens: \"500000\"\n  cache_read_tokens: \"0\"\n  cache_creation_tokens: \"0\"\n  Expenses:Inference-and-Compute:Claude  7 USD\n  Liabilities:Accounts-Payable:Claude  -7 USD"}],"totalUsd":"7","accountsToOpen":[{"account":"Expenses:Inference-and-Compute:Claude","date":"2026-09-04","directive":"2026-09-04 open Expenses:Inference-and-Compute:Claude USD"},{"account":"Liabilities:Accounts-Payable:Claude","date":"2026-09-04","directive":"2026-09-04 open Liabilities:Accounts-Payable:Claude USD"}],"refusals":[]}}
```
## Traceability
- `aggregated-per-day-per-provider-model` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`, `iso-8601-date-time`
- `priced-against-directives` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `posts-expense-against-payable` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `beancount-double-entry-syntax`
- `witness-and-count-in-metadata` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `beancount-double-entry-syntax`
- `accounts-opened-at-first-use` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `beancount-double-entry-syntax`, `candidates-not-appends`
- `refusal-without-price-directive` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `candidates-not-appends`
- `no-network-io` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-float-money` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `no-unbalanced-transaction` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `beancount-double-entry-syntax`
- `no-silent-price-guess` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `candidates-not-appends`
