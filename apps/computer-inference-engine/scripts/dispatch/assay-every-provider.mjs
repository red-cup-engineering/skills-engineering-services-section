#!/usr/bin/env node

import { inspectInferenceResources } from "../../src/dispatch/inference-resource-inspection.mjs";
import { observeProviderModelCatalogs } from "../../src/dispatch/provider-model-catalog.mjs";
import { dispatchInference } from "../../src/dispatch/inference-dispatch.mjs";
import { generateImageWithReceipt } from "../../src/media/generation-receipt.mjs";
import { synthesizeSpeech } from "../../src/audio/speech-synthesis.mjs";

const started = Date.now();
const inspection = await inspectInferenceResources({}, { observeCatalogs: observeProviderModelCatalogs });
const eligible = inspection.providers.filter((provider) => provider.eligibility === "admitted-by-requested-filters");
const chatProviders = eligible.filter((provider) => provider.capabilities.includes("chat"));
const actors = inspection.providers.map(({ provider }) => provider);
const chats = [];
for (const provider of chatProviders) {
  const result = await dispatchInference({
    objective: "Return the word ready.",
    context: "One receiving probe per configured provider.",
    workType: "chat",
    requiredCapabilities: ["chat"],
    excludeProviders: actors.filter((actor) => actor !== provider.provider),
    chatCompletion: { messages: [{ role: "user", content: "Return exactly: ready" }] },
  });
  chats.push({ provider: provider.provider, outcome: result.outcome, receipt: result.receipt?.id ?? null, measured: result.measuredResources ?? null });
}

let speech, image;
try {
  const result = await synthesizeSpeech({ text: "Ready.", voice: "Aoede", language: "en-US", format: "wav", sampleRate: 24_000 });
  speech = { bytes: result.bytes.length, provenance: result.provenance };
} catch (error) { speech = { error: error instanceof Error ? error.message : String(error) }; }
try {
  const result = await generateImageWithReceipt("A small green circle on a plain white background.");
  image = { bytes: result.bytes.length, receipt: result.receipt };
} catch (error) { image = { error: error instanceof Error ? error.message : String(error) }; }

const output = {
  type: "InferenceEngineReceivingCheck",
  elapsedMs: Date.now() - started,
  inspection: { configuredProviders: inspection.configuredProviders, eligibleProviders: eligible.length, providers: eligible.map(({ provider, model }) => ({ provider, model })) },
  chats,
  speech,
  image,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
const chatPass = chatProviders.length >= 5 && chats.every(({ receipt }) => typeof receipt === "string");
const mediaPass = Number.isSafeInteger(speech.bytes) && speech.bytes > 0 && Number.isSafeInteger(image.bytes) && image.bytes > 0;
if (!chatPass || !mediaPass) process.exitCode = 1;
