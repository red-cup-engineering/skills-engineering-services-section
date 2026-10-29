#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { operatePulse } from "../src/service.mjs";
const output = await operatePulse(JSON.parse(readFileSync(0, "utf8")));
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.type === "Reject") process.exitCode = 2;
