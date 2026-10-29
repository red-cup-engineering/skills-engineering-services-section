import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../run-one-exchange.mjs", import.meta.url), "utf8");

test("the provider boundary emits evidence but cannot seat its own settlement", () => {
  assert.doesNotMatch(source, /writeFileSync|mkdirSync|content["']?,\s*["']exchanges/u);
  assert.match(source, /process\.stdout\.write\(JSON\.stringify\(record/u);
  assert.match(source, /typed caller owns the sole\s+\/\/ WitnessJournal settlement/u);
});
