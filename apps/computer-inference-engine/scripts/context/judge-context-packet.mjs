#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { judgeContextPacket } from "../../src/context/judgment.mjs";

function argument(argv, flag) {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function slug(label) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "context-packet";
}

const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  process.stdout.write("usage: judge-context-packet [--provider id] [--model id] [--fuel 1..3] [--label label] [--verdict-dir path] [--resource-root path] < packet.json\n");
  process.exit(0);
}

try {
  for (const flag of ["--provider", "--model", "--fuel", "--label", "--verdict-dir", "--resource-root"]) {
    if (argv.includes(flag) && argument(argv, flag) === undefined) throw new Error(`${flag} requires a value`);
  }
  const packet = JSON.parse(readFileSync(0, "utf8"));
  const result = await judgeContextPacket(packet, {
    provider: argument(argv, "--provider"),
    model: argument(argv, "--model"),
    label: argument(argv, "--label"),
    ...(argument(argv, "--fuel") === undefined ? {} : { fuel: Number(argument(argv, "--fuel")) }),
    resourceRoot: argument(argv, "--resource-root"),
  });
  const verdictDir = argument(argv, "--verdict-dir");
  let output = result;
  if (verdictDir !== undefined && result.outcome === "judgment") {
    if (result.verdict["packet-label"] === "untitled-packet" && argument(argv, "--label") === undefined) throw new Error("--verdict-dir requires --label when the packet has no id, name, or slug");
    const directory = resolve(verdictDir);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${slug(result.verdict["packet-label"])}.json`);
    writeFileSync(path, `${JSON.stringify(result.verdict, null, 2)}\n`, { flag: "wx" });
    output = { ...result, path };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.outcome === "refusal") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
