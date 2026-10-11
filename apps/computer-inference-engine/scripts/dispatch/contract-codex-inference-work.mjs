#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function contractWithMarket(request, { pricingRoot }) {
  const { CODEX_CUSTOMER, dispatchInferenceAsConfiguredCustomer } = await import("../../src/dispatch/inference-dispatch.mjs");
  return dispatchInferenceAsConfiguredCustomer(request, { customerActor: CODEX_CUSTOMER, pricingRoot });
}

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
  if (!values["--pricing-root"]) throw new TypeError("--pricing-root is required so delivery and receiver disposition share one observer");
  return Object.freeze({ input: values["--input"], output: values["--output"] ?? null, pricingRoot: values["--pricing-root"] });
}

function payloadFromInvocation(invocation) {
  if (typeof invocation?.outcome === "string") return invocation;
  if (invocation?.structuredContent) return invocation.structuredContent;
  const text = invocation?.content?.find(({ type }) => type === "text")?.text;
  if (typeof text !== "string") throw new Error("inference invocation returned no structured or text result");
  try { return JSON.parse(text); } catch { return { outcome: "unstructured-inference-result", text }; }
}

export async function main(argv = process.argv.slice(2), {
  read = readFile,
  write = writeFile,
  contract = contractWithMarket,
  emit = (text) => process.stdout.write(text),
} = {}) {
  const { input, output, pricingRoot } = parseArguments(argv);
  const request = JSON.parse(await read(input, "utf8"));
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("input must contain one inference-work request object");
  }
  const invocation = await contract(request, { pricingRoot });
  const payload = payloadFromInvocation(invocation);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (output) await write(output, serialized, { flag: "wx", mode: 0o600 });
  else emit(serialized);
  const isError = invocation.isError === true || payload.outcome !== "candidate-pending-codex-acceptance";
  return Object.freeze({ isError, payload });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().then(({ isError }) => { if (isError) process.exitCode = 1; }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
