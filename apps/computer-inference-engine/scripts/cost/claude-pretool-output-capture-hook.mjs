#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { captureRewrite } from "../../src/cost/pretool-capture.mjs";

const input = JSON.parse(readFileSync(0, "utf8"));
const updatedInput = input?.tool_name === "Bash" ? captureRewrite(input) : null;
if (updatedInput) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput } })}\n`);
