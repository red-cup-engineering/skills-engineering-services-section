#!/usr/bin/env node
import { writeAgentSkill } from "../src/write-agent-skill.mjs";

process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  process.stdout.write(`${JSON.stringify(await writeAgentSkill(JSON.parse(input)))}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
