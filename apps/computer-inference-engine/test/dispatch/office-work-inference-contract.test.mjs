import assert from "node:assert/strict";
import test from "node:test";
import { METROPLAT_INFERENCE_MARKET_CUSTOMER, officeWorkInferenceTaskClass } from "../../src/dispatch/inference-work-lot-source.mjs";

const ERROR = "office work inference requires a canonical work identifier";
const refuses = value => assert.throws(() => officeWorkInferenceTaskClass(value),
  error => error instanceof TypeError && error.message === ERROR);

test("office inference retains its exact established customer identity", () => {
  assert.equal(METROPLAT_INFERENCE_MARKET_CUSTOMER, "urn:ame:metroplat");
  assert.equal(typeof METROPLAT_INFERENCE_MARKET_CUSTOMER, "string");
});

test("canonical office work identifiers retain their exact task-class strings", () => {
  for (const work of ["a", "0", "abc123", "a-b", "0-1", "work-19", "a0-b1-c2"]) {
    assert.equal(officeWorkInferenceTaskClass(work), `metroplat/office-work/${work}`);
    assert.equal(officeWorkInferenceTaskClass(work), officeWorkInferenceTaskClass(work));
  }
});

test("non-string values are refused with the original TypeError without coercion", () => {
  let coerced = false;
  const coercible = { toString() { coerced = true; return "valid-work"; } };
  for (const value of [undefined, null, true, false, 0, 1, NaN, Infinity, 1n, Symbol("work"),
    [], ["work"], {}, new String("work"), /work/u, () => "work", coercible]) refuses(value);
  assert.equal(coerced, false);
});

test("empty, noncanonical case and separators are refused without normalization", () => {
  for (const work of ["", " ", "A", "aB", "WORK", "-a", "a-", "a--b", "a_b", "a.b",
    "a/b", "a:b", "a b", " a", "a ", "a\tb", "a\nb", "é", "工作"]) refuses(work);
});

test("the original non-multiline expression refuses trailing line terminators", () => {
  for (const work of ["a\n", "a\r", "a\r\n", "a\u2028", "a\u2029"]) refuses(work);
});
