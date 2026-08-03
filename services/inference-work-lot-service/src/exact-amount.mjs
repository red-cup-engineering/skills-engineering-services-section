function gcd(left, right) {
  let a = left < 0n ? -left : left, b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function exactAmount(numerator, denominator = "1") {
  let num = BigInt(numerator), den = BigInt(denominator);
  if (num <= 0n || den <= 0n) throw new Error("consideration amount must be a positive exact fraction");
  const divisor = gcd(num, den);
  num /= divisor; den /= divisor;
  return Object.freeze({ numerator: num.toString(), denominator: den.toString() });
}
