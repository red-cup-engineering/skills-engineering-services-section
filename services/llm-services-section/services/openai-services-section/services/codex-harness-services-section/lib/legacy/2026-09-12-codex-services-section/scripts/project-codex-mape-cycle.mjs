#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { compileCodexMapeCycle } from "../src/mape-office.mjs";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(`${JSON.stringify(compileCodexMapeCycle(input), null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ type: "CodexMapeCycleRefusal", disposition: "refused", reason: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
  process.exitCode = 2;
}
