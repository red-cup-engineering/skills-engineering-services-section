#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { decodeJsonValue, identifyJsonValue } from "../src/modern-rmn-carrier.mjs";
import { admitInferenceWorkOutput, admitInferenceWorkRequest } from "../src/inference-work-carriers.mjs";
import { contractInferenceWork } from "../src/codex-inference-market.mjs";

function decodeRequest(bytes) {
  return admitInferenceWorkRequest(decodeJsonValue(bytes).value);
}

function encodeResult(value) {
  const identified = identifyJsonValue(admitInferenceWorkOutput(value));
  return { bytes: identified.bytes, id: identified.token };
}

function suspensionFromResult(result) {
  const dependency = result?.settlementResidues?.find(({ dependency }) => dependency)?.dependency;
  if (!dependency || typeof dependency.agentUrl !== "string" || typeof dependency.taskId !== "string") return undefined;
  return {
    type: "A2aTaskDependency",
    protocol: "A2A",
    protocolVersion: "1.0",
    agentUrl: dependency.agentUrl,
    taskId: dependency.taskId,
  };
}

export async function executeA2aMessage(source, { contract = contractInferenceWork, signal } = {}) {
  const message = Message.fromJSON(source);
  if (message.role !== Role.ROLE_USER) throw new Error("inference work contracting requires an A2A ROLE_USER message");
  const input = extractRmnPart(message.parts);
  const request = decodeRequest(input.bytes);
  const result = await contract(request, { signal });
  const output = encodeResult(result);
  return Message.toJSON({
    messageId: randomUUID(),
    contextId: message.contextId,
    taskId: message.taskId,
    role: Role.ROLE_AGENT,
    parts: [rmnPart(output.bytes, "inference-work-lot-result.rmn.cbor")],
    metadata: {
      disposition: result.disposition ?? result.outcome,
      requestNi: input.ni,
      resultNi: output.id,
      customerAcceptanceRequired: true,
      ...(suspensionFromResult(result) ? { suspension: suspensionFromResult(result) } : {}),
    },
    extensions: [],
    referenceTaskIds: [],
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const cancellation = new AbortController();
  const abort = (name) => {
    const error = new Error(`inference-work executor received ${name}`);
    error.name = "AbortError";
    cancellation.abort(error);
  };
  const onSigterm = () => abort("SIGTERM");
  const onSigint = () => abort("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  try {
    const source = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(await executeA2aMessage(source, { signal: cancellation.signal }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.code ?? "inference-work-lot-refusal"}: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
  }
}
