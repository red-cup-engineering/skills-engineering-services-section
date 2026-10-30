#!/usr/bin/env node
import { runHarnessEfficiencyAssay } from "../src/harness-efficiency.mjs";
const result = runHarnessEfficiencyAssay();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
