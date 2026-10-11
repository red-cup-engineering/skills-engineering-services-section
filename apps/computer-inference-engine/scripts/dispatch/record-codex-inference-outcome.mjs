#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { recordInferenceOutcome } from "../../src/dispatch/inference-dispatch.mjs";

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--input", "--output", "--pricing-root"].includes(flag) || value === undefined) {
      throw new TypeError(`unknown or incomplete argument ${flag ?? "(missing)"}`);
    }
    if (values[flag] !== undefined) throw new TypeError(`duplicate argument ${flag}`);
    values[flag] = value;
  }
  if (!values["--input"]) throw new TypeError("--input is required");
  if (!values["--pricing-root"]) throw new TypeError("--pricing-root is required");
  return Object.freeze({ input: values["--input"], output: values["--output"] ?? null, pricingRoot: values["--pricing-root"] });
}

export async function main(argv = process.argv.slice(2), {
  read = readFile,
  write = writeFile,
  record = recordInferenceOutcome,
  emit = (text) => process.stdout.write(text),
} = {}) {
  const { input, output, pricingRoot } = parseArguments(argv);
  const disposition = JSON.parse(await read(input, "utf8"));
  if (!disposition || typeof disposition !== "object" || Array.isArray(disposition)) {
    throw new TypeError("input must contain one receiver disposition object");
  }
  const result = await record(disposition, { pricingRoot });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (output) await write(output, serialized, { flag: "wx", mode: 0o600 });
  else emit(serialized);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
