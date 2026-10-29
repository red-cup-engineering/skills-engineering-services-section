#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { operatePulse } from "../src/service.mjs";

const input = readFileSync(0, "utf8").trim();
const result = await operatePulse(input ? JSON.parse(input) : {});
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.type === "Reject") process.exitCode = 2;
