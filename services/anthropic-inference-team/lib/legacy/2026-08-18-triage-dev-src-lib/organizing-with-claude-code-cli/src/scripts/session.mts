#!/usr/bin/env node
// claude-session — the Claude Code CLI coding-agent session computer:
// capsule, finding, impact, recall, trace. Thin entry over runSessionCli.
import process from "node:process";
import { runSessionCli } from "../session/index.mjs";

runSessionCli(process.argv.slice(2)).then((result) => {
  process.stdout.write(result.output + "\n");
  process.exit(result.code);
});
