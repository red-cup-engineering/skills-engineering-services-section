#!/usr/bin/env node
import process from "node:process";
import { readHarness, planHarness, renderHarness, applyMcpConfig } from "../harness.mjs";

function flag(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function main(argv: readonly string[]): number {
  const cmd = argv[0];
  const root = flag("--root", argv);
  if (cmd === "read") {
    console.log(renderHarness(readHarness(root === undefined ? {} : { root })));
    return 0;
  }
  if (cmd === "plan") {
    console.log("# canonical harness - the wiring organizing-with-claude-harness would project:");
    console.log(renderHarness(planHarness()));
    return 0;
  }
  if (cmd === "apply") {
    const dry = argv.includes("--dry-run");
    const hubUrl = flag("--hub-url", argv);
    const r = applyMcpConfig({
      ...(root === undefined ? {} : { root }),
      ...(hubUrl === undefined ? {} : { hubUrl }),
      write: !dry,
    });
    console.log(`${r.wrote ? "wrote" : "(dry-run) would write"} ${r.path}:`);
    console.log(JSON.stringify(r.after, null, 2));
    return 0;
  }
  console.error("usage: organizing-with-claude-harness <read|plan|apply> [--root <dir>] [--dry-run] [--hub-url <url>]");
  return 2;
}

process.exitCode = main(process.argv.slice(2));
