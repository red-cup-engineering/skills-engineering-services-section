#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const valued = new Set(["output", "count", "prefix"]), booleans = new Set(["help"]);
function parse(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) throw new Error(`unexpected argument ${raw}`);
    const key = raw.slice(2);
    if (booleans.has(key)) out[key] = true;
    else if (valued.has(key)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      out[key] = value;
    } else throw new Error(`unknown flag --${key}`);
  }
  return out;
}

const fixtures = [
  { text: "The invoice total is due on the fifteenth and must be reconciled against the purchase order.", label: "finance" },
  { text: "The function passes locally but the integration test fails after the dependency upgrade.", label: "software" },
  { text: "The weekly coordination meeting moved to Thursday and the room reservation was updated.", label: "operations" },
  { text: "The quarterly ledger contains a duplicate debit that needs an auditable correction.", label: "finance" },
  { text: "The API handler returns the wrong status code when validation rejects an empty payload.", label: "software" },
  { text: "The delivery roster needs a new shift assignment before tomorrow's opening window.", label: "operations" }
];

function usage(code) {
  process.stderr.write("usage: prepare-throughput-benchmark --output jobs.jsonl --count N --prefix stable-id-prefix\n");
  process.exit(code);
}

try {
  const args = parse(process.argv.slice(2));
  if (args.help) usage(0);
  if (!args.output || !args.count || !args.prefix) usage(2);
  const count = Number(args.count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("--count must be an integer from 1 to 1000");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(args.prefix)) throw new Error("--prefix must be 1-64 lowercase letters, digits, or hyphens");
  const jobs = Array.from({ length: count }, (_, index) => {
    const fixture = fixtures[index % fixtures.length];
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: { label: { type: "string", const: fixture.label } }
    };
    return {
      id: `${args.prefix}-${String(index + 1).padStart(4, "0")}`,
      workType: "classification",
      difficulty: 0.08,
      requiredCapabilities: ["classification"],
      maxTokens: 32,
      messages: [
        { role: "system", content: "Classify the supplied work item as finance, software, or operations. Return only JSON matching the supplied schema." },
        { role: "user", content: fixture.text }
      ],
      outputContract: { format: "json", mode: "json_schema", schema }
    };
  });
  const output = resolve(args.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${jobs.map((job) => JSON.stringify(job)).join("\n")}\n`, { flag: "wx", mode: 0o600 });
  process.stderr.write(`${JSON.stringify({ type: "InferenceThroughputBenchmarkPrepared", output, jobs: jobs.length, prefix: args.prefix, acceptance: "exact-schema-verified-classification" })}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
