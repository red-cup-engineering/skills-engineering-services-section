// Exact USD arithmetic for per-million-token prices. A price is a decimal string ("0.125");
// a cost is integer micro-USD (1e-6 USD), rounded half up once per component, so every
// rolled-up total is the exact sum of the recorded components.
const MICRO = 1_000_000n;

/** Decimal string with at most 6 fractional digits -> integer millionths. */
export function decimalToMicros(text) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/u.exec(String(text));
  if (match === null) throw new TypeError(`not a decimal with at most 6 fractional digits: ${JSON.stringify(text)}`);
  return BigInt(match[1]) * MICRO + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

/** Integer millionths -> decimal string with exactly 6 fractional digits. */
export function microsToDecimal(micros) {
  const value = BigInt(micros);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / MICRO}.${String(abs % MICRO).padStart(6, "0")}`;
}

/** Cost in micro-USD of `tokens` at `usdPerMillionTokens` (decimal string): tokens * price / 1e6 * 1e6, rounded half up. */
export function tokenCostMicros(tokens, usdPerMillionTokens) {
  const product = BigInt(tokens) * decimalToMicros(usdPerMillionTokens); // 1e-12 USD
  return (product + MICRO / 2n) / MICRO;
}
