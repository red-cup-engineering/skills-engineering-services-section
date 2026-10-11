#!/usr/bin/env node
import {
  addDecimalStrings,
  formatScaled,
  multiplyDecimalStrings,
  parseDecimal,
} from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

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
  const result = await runJavascriptNodeOperation({ name: "derive-set-of-inference-expense-transactions", description: "Prices token-usage records into Beancount expense-transaction candidates: records are grouped per provider, model, and calendar date; each group's per-class token counts are converted exactly into millions and priced against the matching price directive on or before the group's date, summed into one USD cost posted to `Expenses:Inference-and-Compute:<Provider>` against its exact negation in `Liabilities:Accounts-Payable:<Provider>`; a group with a non-zero class token count and no matching price directive is refused as a whole rather than priced at zero, and every referenced account not already in `openAccounts` gets one `open` directive dated at its first use.", operation: deriveSetOfInferenceExpenseTransactions }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
