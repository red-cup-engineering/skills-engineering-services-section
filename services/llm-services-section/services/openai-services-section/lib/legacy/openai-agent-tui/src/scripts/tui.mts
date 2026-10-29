#!/usr/bin/env node
/**
 * openai-agent-tui — launch the pulse-backed chat TUI against an OpenAI-compatible
 * endpoint. Type to talk; each message is a pulse (logged, state derived, dreamed
 * when judged necessary). Ctrl-B toggles the standing panel, Ctrl-C quits.
 *
 *   openai-agent-tui --session demo --endpoint nvidia
 *   openai-agent-tui --session demo --endpoint groq --dream-endpoint nvidia --dream-every 2
 */
import process from "node:process";
import { runOpenaiAgentTui } from "../app/index.mjs";
import type { PulseConfig } from "@emsenn/organizing-with-openai-agents";

const VALUE = new Set([
  "--session", "--endpoint", "--model", "--dream-endpoint", "--dream-model",
  "--system", "--dream-every", "--root", "--namespace",
]);

function parse(argv: readonly string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: openai-agent-tui [--session id] [--endpoint id] [--model m]\n" +
        "                        [--dream-endpoint id] [--dream-model m] [--dream-every N]\n" +
        "                        [--system t] [--namespace ns] [--root dir]\n",
      );
      process.exit(0);
    }
    if (VALUE.has(arg)) {
      const value = argv[++i];
      if (value === undefined) { process.stderr.write(`flag ${arg} needs a value\n`); process.exit(2); }
      options[arg] = value;
    }
  }
  return options;
}

const o = parse(process.argv.slice(2));
const config: PulseConfig = {
  session: o["--session"] ?? "openai-agent-tui",
  ...(o["--endpoint"] === undefined ? {} : { chatEndpoint: o["--endpoint"] }),
  ...(o["--model"] === undefined ? {} : { model: o["--model"] }),
  ...(o["--dream-endpoint"] === undefined ? {} : { dreamEndpoint: o["--dream-endpoint"] }),
  ...(o["--dream-model"] === undefined ? {} : { dreamModel: o["--dream-model"] }),
  ...(o["--system"] === undefined ? {} : { system: o["--system"] }),
  ...(o["--namespace"] === undefined ? {} : { namespace: o["--namespace"] }),
  ...(o["--root"] === undefined ? {} : { root: o["--root"] }),
  ...(o["--dream-every"] === undefined ? {} : { dreamEvery: Number(o["--dream-every"]) }),
};

runOpenaiAgentTui({ config, exit: (code) => process.exit(code) });
