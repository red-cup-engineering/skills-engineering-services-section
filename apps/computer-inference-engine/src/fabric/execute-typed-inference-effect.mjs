#!/usr/bin/env node
// The one generic FOUR-bottom typed-inference effect executor. Every
// provider team (Groq, NVIDIA, OpenRouter, the bare-cedar-fog NPU, Gemini,
// Claude Code, ...) previously hand-copied this exact orchestration --
// parse the A2A message, conform the SEN proposal, call out to the
// provider, conform the evidence, assay a wit transition, append a
// witness-journal entry, build the A2A completion message -- with only the
// provider's own model-call ("performInference"), settlement identity, and
// measurement units actually varying. Those are now parameters of ONE
// operation instead of N forked copies (owner ruling, 2026-09-11: "these
// things should not only be way more generic and then parameterized into
// what we need, but need to be written as part of a cohesive architecture,
// not just minorly fixed").
//
// @typedef {{instruction: string, input: string, model: string, mode: "dry-run"|"live"}} TypedInferenceOperationMarks
// @typedef {{disposition: "completion"|"refused", text: string, usage?: Record<string, unknown>, cost?: Record<string, unknown>}} TypedInferencePerformed
// @typedef {{instruction: string, input: string, model: string, mode: "dry-run"|"live", startedAt: number, performed: TypedInferencePerformed, error: (Error|undefined)}} TypedInferenceEvidenceContext

import { randomUUID } from "node:crypto";
import { ty, tm } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation";
import { effectBundle, effectBundleType } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { decodeSemantic } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { conformTerm, conformTermBytes } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/conformance";
import { assayWitTransition } from "@red-cup-engineering/computer-inference-engine/fabric/effect-assay";
import { recordWitnessJournalBatch, relationalWitnessJournalDocument } from "@red-cup-engineering/witness-journal-document-service";

/** The FOUR-bottom instruction/input/model/mode Marks type every typed inference effect proposal is stated over. Identical across every provider -- it is the shape of the customer's demand, never provider-specific. */
export const TYPED_INFERENCE_OPERATION_TYPE = ty.prod(ty.base(), ty.prod(ty.base(), ty.prod(ty.base(), ty.base())));

const WIT_TRANSITION_ASSAY_AGENT_ENV = "WIT_TRANSITION_ASSAY_AGENT";
const WITNESS_JOURNAL_RDF_AGENT_ENV = "WITNESS_JOURNAL_RDF_AGENT";

/** One required A2A hired-provider Agent Card URL, read from its standing environment variable. */
export function requiredAgentUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must name the hired provider's A2A 1.0 Agent Card`);
  return value;
}

/** The one application/sen+cbor A2A part a typed inference proposal message must carry. */
export function rawInferencePart(message, providerLabel) {
  const parts = (message.parts ?? []).filter((part) => part?.mediaType === "application/sen+cbor" && typeof part.raw === "string");
  if (parts.length !== 1) throw new Error(`${providerLabel} inference requires exactly one application/sen+cbor A2A part`);
  return parts[0];
}

/** Extracts the instruction/input/model/mode Marks a typed inference operation term carries. */
export function typedInferenceOperationMarks(term) {
  if (
    term?.[0] !== "pair" || term?.[1]?.[0] !== "mark"
    || term?.[2]?.[0] !== "pair" || term?.[2]?.[1]?.[0] !== "mark"
    || term?.[2]?.[2]?.[0] !== "pair" || term?.[2]?.[2]?.[1]?.[0] !== "mark" || term?.[2]?.[2]?.[2]?.[0] !== "mark"
  ) throw new Error("inference operation is not instruction/input/model/mode Marks");
  return { instruction: term[1][1], input: term[2][1][1], model: term[2][2][1][1], mode: term[2][2][2][1] };
}

function resolveSettlement(settlement) {
  const value = typeof settlement === "function" ? settlement() : settlement;
  if (typeof value !== "string" || value.length === 0) throw new Error("executeTypedInferenceEffect requires one resolved settlement account");
  return value;
}

async function appendTypedInferenceWitnessJournal({ settlement, proposal, completion, evidence, witness, disposition, documentExtra }) {
  const at = new Date().toISOString();
  const assertions = [
    ["urn:sen:proposal", proposal], ["urn:sen:completion", completion], ["urn:sen:evidence", evidence],
    ["urn:sen:witness", witness], ["urn:sen:disposition", disposition], ["urn:prov:generatedAtTime", at],
  ].map(([predicate, value]) => ({ subject: completion, predicate, object: { kind: "literal", value } }));
  return recordWitnessJournalBatch({
    agentUrl: requiredAgentUrl(WITNESS_JOURNAL_RDF_AGENT_ENV),
    batch: {
      settlement, graph: completion, recordedAt: at,
      document: relationalWitnessJournalDocument({ type: "InferenceExecutionWitness", proposal, completion, evidence, witness, disposition, ...(documentExtra ?? {}) }),
      assertions,
    },
  });
}

/**
 * Execute one typed inference A2A effect proposal against one provider,
 * parameterized entirely by `config`. This is the whole shared FOUR-bottom
 * orchestration; a provider team supplies only what actually differs:
 * its settlement identity, its own model-call, and how it measures usage.
 *
 * `options` (per-call, matching the tested Gemini DI contract) may override
 * `settlement` and `performInference` for testing without touching the
 * provider's static configuration.
 */
export async function executeTypedInferenceEffect(message, config, options = {}) {
  const {
    providerLabel,
    settlement: staticSettlement,
    performInference: staticPerformInference,
    measures,
    documentExtra,
    buildExtraEvidence,
    evidenceSink,
  } = config;
  if (typeof providerLabel !== "string" || providerLabel.length === 0) throw new Error("executeTypedInferenceEffect requires one providerLabel");
  if (typeof measures !== "function") throw new Error("executeTypedInferenceEffect requires one measures(prior, performed) function");
  const performInference = options.performInference ?? staticPerformInference;
  if (typeof performInference !== "function") throw new Error("executeTypedInferenceEffect requires one performInference(marks) function");
  const settlement = resolveSettlement(options.settlement ?? staticSettlement);

  if (message?.role !== "ROLE_USER") throw new Error(`contracted ${providerLabel} executor requires an A2A ROLE_USER Message`);
  const part = rawInferencePart(message, providerLabel);
  const proposalBytes = Buffer.from(part.raw, "base64");
  const proposal = conformTermBytes({
    bytes: proposalBytes,
    expectedType: effectBundleType(decodeSemantic(proposalBytes), TYPED_INFERENCE_OPERATION_TYPE),
    expectedNi: part.metadata?.ni,
  });
  const cell = proposal.effectCell;
  if (cell.provider !== settlement) throw new Error(`effect cell is not addressed to the ${providerLabel} team's account and task scale`);
  if (cell.outcome?.positiveEvidence !== false || cell.outcome?.negativeEvidence !== false) throw new Error("proposal effect must enter at FOUR-bottom");

  const operation = proposal.normalForm[2];
  const marks = typedInferenceOperationMarks(operation);
  const startedAt = performance.now();
  let performed, caughtError;
  try { performed = await performInference(marks); }
  catch (error) { caughtError = error instanceof Error ? error : new Error(String(error)); performed = { disposition: "refused", text: caughtError.message, usage: {}, cost: {} }; }

  const evidence = conformTerm({ term: tm.mark(performed.text), expectedType: ty.base() });
  const completionCell = {
    ...cell, evidenceRoot: evidence.term,
    outcome: { positiveEvidence: performed.disposition === "completion", negativeEvidence: performed.disposition === "refused" },
    measures: measures(cell.measures, performed),
  };
  const transition = await assayWitTransition({ agentUrl: requiredAgentUrl(WIT_TRANSITION_ASSAY_AGENT_ENV), proposalCell: cell, completionCell, evidence: evidence.term });
  const completionTerm = effectBundle(completionCell, operation);
  const completion = conformTerm({ term: completionTerm, expectedType: effectBundleType(completionTerm, TYPED_INFERENCE_OPERATION_TYPE) });
  await appendTypedInferenceWitnessJournal({
    settlement, proposal: proposal.term, completion: completion.term, evidence: evidence.term, witness: transition.witness, disposition: performed.disposition,
    documentExtra: typeof documentExtra === "function" ? documentExtra({ marks, performed }) : documentExtra,
  });

  const parts = [
    { raw: completion.canonicalBytesBase64, metadata: { ni: completion.term }, filename: "completion.sen.cbor", mediaType: "application/sen+cbor" },
    { text: performed.text, metadata: { evidenceNi: evidence.term, disposition: performed.disposition }, mediaType: "text/plain" },
  ];
  const metadata = { disposition: performed.disposition, proposalNi: proposal.term, completionNi: completion.term, witnessNi: transition.witness };

  if (typeof buildExtraEvidence === "function") {
    const extra = buildExtraEvidence({ instruction: marks.instruction, input: marks.input, model: marks.model, mode: marks.mode, startedAt, performed, error: caughtError });
    if (extra !== undefined) {
      if (typeof (options.evidenceSink ?? evidenceSink) === "function") await (options.evidenceSink ?? evidenceSink)(extra);
      parts.push({ text: JSON.stringify(extra), filename: "exchange-evidence.json", mediaType: "application/json" });
      metadata.exchangeEvidenceId = extra.id;
    }
  }

  return { messageId: randomUUID(), role: "ROLE_AGENT", parts, metadata };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.stderr.write("execute-typed-inference-effect.mjs is a library entrypoint composed by each provider team's own src/execute-sen-inference.mjs; it is not run directly.\n");
  process.exitCode = 1;
}
