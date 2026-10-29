#!/usr/bin/env node
/**
 * openai-agent — drive one chat run against ANY OpenAI-compatible endpoint and
 * print the reply (or the run projection with --json).
 *
 * The prompt comes from --prompt, the trailing positionals, or stdin. The
 * endpoint defaults to the first built-in whose key is present (NVIDIA / Groq /
 * Cerebras / OpenAI), so `echo "hi" | openai-agent` just works in this
 * environment. This is the side-effecting boundary; the run/inference modules
 * stay pure of it.
 *
 *   openai-agent --endpoint nvidia --model meta/llama-3.1-8b-instruct "explain X"
 *   echo "summarize this" | openai-agent --json
 *   openai-agent --list            # show endpoints and key presence
 */
import process from "node:process";
import { availableEndpoints, firstAvailableEndpoint, resolveEndpoint } from "../endpoints.mjs";
import { openaiAgentInfer } from "../inference.mjs";
import { runChat } from "../run.mjs";

const VALUE = new Set(["--endpoint", "--model", "--system", "--session", "--prompt"]);
const BOOL = new Set(["--json", "--list", "--help", "-h"]);

function usage(): never {
  process.stderr.write(
    "usage: openai-agent [--endpoint id] [--model m] [--system t] [--session id]\n" +
    "                    [--json] (--prompt p | -- prompt… | stdin)\n" +
    "       openai-agent --list\n",
  );
  process.exit(2);
}

function parse(argv: readonly string[]): { options: Record<string, string>; bools: Set<string>; positionals: string[] } {
  const options: Record<string, string> = {};
  const bools = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (BOOL.has(arg)) { bools.add(arg); continue; }
    if (VALUE.has(arg)) {
      const value = argv[++i];
      if (value === undefined) { process.stderr.write(`flag ${arg} needs a value\n`); usage(); }
      options[arg] = value; continue;
    }
    if (arg.startsWith("-")) { process.stderr.write(`unknown flag: ${arg}\n`); usage(); }
    positionals.push(arg);
  }
  return { options, bools, positionals };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  const p = parse(process.argv.slice(2));
  if (p.bools.has("--help") || p.bools.has("-h")) usage();
  if (p.bools.has("--list")) {
    for (const e of availableEndpoints()) {
      process.stdout.write(`${e.apiKey.present ? "✓" : "·"} ${e.endpoint.padEnd(10)} ${e.baseUrl}${e.defaultModel ? `  (default ${e.defaultModel})` : ""}\n`);
    }
    return 0;
  }

  const prompt = p.options["--prompt"] ?? (p.positionals.length > 0 ? p.positionals.join(" ") : await readStdin());
  if (prompt.trim().length === 0) { process.stderr.write("openai-agent: no prompt given\n"); usage(); }

  const endpointId = p.options["--endpoint"] ?? firstAvailableEndpoint()?.endpoint;
  if (endpointId === undefined) {
    process.stderr.write("openai-agent: no endpoint key present (set NVIDIA_API_KEY/GROQ_API_KEY/CEREBRAS_API_KEY/OPENAI_API_KEY or pass --endpoint)\n");
    return 1;
  }
  const endpoint = resolveEndpoint(endpointId);
  const infer = openaiAgentInfer(endpoint);
  const outcome = await runChat(infer, {
    id: p.options["--session"] ?? `openai-agent:${endpoint.id}`,
    prompt,
    ...(p.options["--model"] === undefined ? {} : { model: p.options["--model"] }),
    ...(p.options["--system"] === undefined ? {} : { system: p.options["--system"] }),
  });

  if (p.bools.has("--json")) {
    process.stdout.write(JSON.stringify({
      endpoint: outcome.result.endpoint,
      model: outcome.result.model,
      regime: outcome.classification.regime,
      settled: outcome.classification.settled,
      usage: outcome.result.usage ?? null,
      cost: outcome.cost,
      text: outcome.result.text,
    }, null, 2) + "\n");
  } else {
    process.stdout.write(outcome.result.text + "\n");
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  process.stderr.write(`openai-agent: ${(error as Error).message}\n`);
  process.exit(1);
});
