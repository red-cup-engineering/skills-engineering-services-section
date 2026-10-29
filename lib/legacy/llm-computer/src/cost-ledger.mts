// @red-cup-engineering/llm-computer - project an inference cost event into a balanced ledger transaction.
//
// A CostEvent becomes one exact transaction: each consumed resource is posted to
// an expense account and balanced against an equity account. This module owns the
// tiny exact-rational ledger carrier it needs; it does not depend on an animating
// accounting subpath that no longer exists.

import type { CostEvent } from "@red-cup-engineering/organizing-with-llm-agents/algebra";

export type Amount = Readonly<{
  num: bigint;
  den: bigint;
  commodity: string;
}>;

export type Posting = Readonly<{
  account: string;
  amount: Amount;
}>;

export type Transaction = Readonly<{
  id: string;
  date: string;
  time: string | null;
  payee: string;
  narration: string;
  tags: readonly string[];
  links: readonly string[];
  meta: Readonly<Record<string, unknown>>;
  postings: readonly Posting[];
}>;

export type CostLedgerOptions = Readonly<{
  date?: string;
  time?: string | null;
  expenseRoot?: string;
  balancingAccount?: string;
  dollarsCommodity?: string;
  inputTokensCommodity?: string;
  outputTokensCommodity?: string;
  settlementFuelCommodity?: string;
}>;

export type CostLedgerProjection = Readonly<{
  transaction: Transaction;
  balanced: boolean;
  residualStrings: readonly string[];
  exactAmounts: Readonly<Record<string, string>>;
}>;

export function costEventTransaction(event: CostEvent, options: CostLedgerOptions = {}): CostLedgerProjection {
  const expenseRoot = options.expenseRoot ?? "Expenses:LLM";
  const balancingAccount = options.balancingAccount ?? "Equity:LLM:Budget";
  const dollars = amountFromNumber(event.dollars, options.dollarsCommodity ?? "USD");
  const inputTokens = amount(event.tokens.input, 1, options.inputTokensCommodity ?? "INPUT_TOKENS");
  const outputTokens = amount(event.tokens.output, 1, options.outputTokensCommodity ?? "OUTPUT_TOKENS");
  const settlementFuel = amountFromNumber(event.settlementFuel, options.settlementFuelCommodity ?? "SETTLEMENT_FUEL");
  const resourceAmounts: readonly (readonly [string, Amount])[] = [
    [`${expenseRoot}:Dollars`, dollars],
    [`${expenseRoot}:Tokens:Input`, inputTokens],
    [`${expenseRoot}:Tokens:Output`, outputTokens],
    [`${expenseRoot}:SettlementFuel`, settlementFuel],
  ];
  const nonzero = resourceAmounts.filter((entry) => entry[1].num !== 0n);
  const txn = transaction({
    id: event.id,
    date: options.date ?? dateFromTransactionTime(event.transactionTime),
    time: options.time ?? null,
    payee: "LLM",
    narration: `${event.operation}${event.endpoint === undefined ? "" : ` via ${event.endpoint}`}${event.model === undefined ? "" : `/${event.model}`}`,
    tags: ["llm", "cost"],
    links: event.evidence,
    meta: {
      operation: event.operation,
      endpoint: event.endpoint ?? null,
      model: event.model ?? null,
      transactionTime: event.transactionTime,
    },
    postings: nonzero.flatMap(([account, value]) => [
      posting({ account, amount: value }),
      posting({ account: balancingAccount, amount: negateAmount(value) }),
    ]),
  });
  const check = balances(txn);
  return {
    transaction: txn,
    balanced: check.balanced,
    residualStrings: check.residualStrings,
    exactAmounts: {
      dollars: toExactString(dollars),
      inputTokens: toExactString(inputTokens),
      outputTokens: toExactString(outputTokens),
      settlementFuel: toExactString(settlementFuel),
    },
  };
}

function amount(num: bigint | number, den: bigint | number, commodity: string): Amount {
  const numerator = typeof num === "bigint" ? num : BigInt(num);
  const denominator = typeof den === "bigint" ? den : BigInt(den);
  if (denominator === 0n) throw new TypeError("amount: denominator must be nonzero");
  const sign = denominator < 0n ? -1n : 1n;
  const reduced = reduce(numerator * sign, denominator * sign);
  return Object.freeze({ num: reduced.num, den: reduced.den, commodity });
}

function amountFromNumber(value: number, commodity: string): Amount {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`amountFromNumber: ${commodity} must be a nonnegative finite number`);
  const parsed = decimalRational(decimalLiteral(value));
  return amount(parsed.num, parsed.den, commodity);
}

function negateAmount(value: Amount): Amount {
  return amount(-value.num, value.den, value.commodity);
}

function posting(input: Posting): Posting {
  return Object.freeze(input);
}

function transaction(input: Transaction): Transaction {
  return Object.freeze({
    ...input,
    tags: Object.freeze([...input.tags]),
    links: Object.freeze([...input.links]),
    postings: Object.freeze([...input.postings]),
  });
}

function balances(txn: Transaction): Readonly<{ balanced: boolean; residualStrings: readonly string[] }> {
  const byCommodity = new Map<string, Amount>();
  for (const entry of txn.postings) {
    const current = byCommodity.get(entry.amount.commodity) ?? amount(0, 1, entry.amount.commodity);
    byCommodity.set(entry.amount.commodity, addAmounts(current, entry.amount));
  }
  const residuals = [...byCommodity.values()].filter((value) => value.num !== 0n);
  return Object.freeze({
    balanced: residuals.length === 0,
    residualStrings: Object.freeze(residuals.map(toExactString)),
  });
}

function addAmounts(left: Amount, right: Amount): Amount {
  if (left.commodity !== right.commodity) throw new TypeError("addAmounts: commodity mismatch");
  return amount(left.num * right.den + right.num * left.den, left.den * right.den, left.commodity);
}

function toExactString(value: Amount): string {
  const magnitude = value.den === 1n ? `${value.num}` : `${value.num}/${value.den}`;
  return `${magnitude} ${value.commodity}`;
}

function reduce(num: bigint, den: bigint): Readonly<{ num: bigint; den: bigint }> {
  const divisor = gcd(abs(num), abs(den));
  return Object.freeze({ num: num / divisor, den: den / divisor });
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function decimalRational(value: string): { readonly num: bigint; readonly den: bigint } {
  const match = /^(?<sign>-)?(?<whole>\d+)(?:\.(?<fraction>\d+))?$/.exec(value);
  if (match?.groups === undefined) throw new TypeError(`decimalRational: invalid decimal ${value}`);
  const whole = match.groups["whole"] ?? "0";
  const fraction = match.groups["fraction"] ?? "";
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const sign = match.groups["sign"] === "-" ? -1n : 1n;
  return {
    num: sign * BigInt(digits),
    den: 10n ** BigInt(fraction.length),
  };
}

function dateFromTransactionTime(value: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : "1970-01-01";
}

function decimalLiteral(value: number): string {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa = "0", exponentText = "0"] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (!Number.isInteger(exponent)) throw new TypeError(`decimalLiteral: invalid exponent ${text}`);
  const negative = mantissa.startsWith("-");
  const unsigned = mantissa.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = (whole + fraction).replace(/^0+(?=\d)/, "") || "0";
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) return `${negative ? "-" : ""}0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${negative ? "-" : ""}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${negative ? "-" : ""}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
