#!/usr/bin/env node
// @red-cup-engineering/llm-computer CLI — pure computing only (no network, no keys).

import { ENDPOINTS } from "@red-cup-engineering/organizing-with-llm-agents/algebra";
import type { CostEvent } from "@red-cup-engineering/organizing-with-llm-agents/algebra";
import { costEventTransaction } from "./cost-ledger.mjs";

export function runCli(argv: readonly string[]): string {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
      return helpText();
    case "endpoints":
      return Object.values(ENDPOINTS).map((e) => `${e.id}\t${e.dialect}\t${e.baseUrl}`).join("\n");
    case "cost": {
      const json = rest[0];
      if (json === undefined) return "usage: llm-computer cost '<CostEvent JSON>'";
      const event = JSON.parse(json) as CostEvent;
      const projection = costEventTransaction(event);
      return JSON.stringify({
        balanced: projection.balanced,
        exactAmounts: projection.exactAmounts,
        residuals: projection.residualStrings,
      }, null, 2);
    }
    default:
      return `unknown command: ${command}\n\n${helpText()}`;
  }
}

function helpText(): string {
  return [
    "llm-computer — pure LLM computing",
    "",
    "commands:",
    "  endpoints          list known inference endpoints",
    "  cost '<json>'      project a CostEvent into a double-entry ledger transaction",
    "  help               show this help",
  ].join("\n");
}

const proc = (globalThis as { process?: { argv?: string[]; stdout?: { write(s: string): void } } }).process;
const argv1 = proc?.argv?.[1];
if (typeof argv1 === "string" && import.meta.url === `file://${argv1}`) {
  proc?.stdout?.write(runCli(proc.argv?.slice(2) ?? []) + "\n");
}
