#!/usr/bin/env node
import { decideWorkPlacement } from "../../src/dispatch/decide-work-placement.mjs";

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("decideWorkPlacement — Decides one provider-neutral work placement from exact demand, finite resource and quota, offer, policy, and observation evidence without performing effects.\n");
  } else {
    process.stdin.setEncoding("utf8");
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    for (const line of input.split("\n")) if (line.trim()) process.stdout.write(JSON.stringify(decideWorkPlacement(JSON.parse(line))) + "\n");
  }
}
