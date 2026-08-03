import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { createInferenceSettlementStore } from "./witness-journal-settlement-store.mjs";
import { jsonValueId } from "./modern-rmn-carrier.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ni = (value) => jsonValueId(value);
function candidateText(procurement) { return procurement?.settlement?.candidate; }

function parsedJsonCandidates(text) {
  const sources = [];
  const seenSources = new Set();
  const add = (source, carrier) => {
    const trimmed = source.trim();
    if (!trimmed || seenSources.has(trimmed)) return;
    try {
      sources.push({ value: JSON.parse(trimmed), source: trimmed, carrier });
      seenSources.add(trimmed);
    } catch {
      // A non-JSON span is evidence in the provider output, not a candidate.
    }
  };
  const trimmed = text.trim();
  add(trimmed, "entire-output");
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) add(match[1], "fenced-block");
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const stack = [];
    let inString = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (inString) {
        if (character === "\\") end += 1;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const opener = stack.pop();
        if ((opener === "{" && character !== "}") || (opener === "[" && character !== "]")) break;
        if (stack.length === 0) {
          add(text.slice(start, end + 1), "balanced-span");
          start = end;
          break;
        }
      }
    }
  }
  return sources;
}

function inlineToolArguments(source) {
  const body = source.trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      Object.values(parsed).every((value) =>
        value === null || ["string", "number", "boolean"].includes(typeof value))) {
      return parsed;
    }
    return null;
  } catch {
    // Some providers emit JavaScript-like unquoted keys. Parse only the small
    // scalar-literal subset below; never evaluate provider output.
  }
  const args = {};
  let cursor = 1;
  while (cursor < body.length - 1) {
    while (/[\s,]/u.test(body[cursor] ?? "")) cursor += 1;
    if (cursor >= body.length - 1) break;
    const key = /^[A-Za-z_][A-Za-z0-9_-]*/u.exec(body.slice(cursor));
    if (!key) return null;
    cursor += key[0].length;
    while (/\s/u.test(body[cursor] ?? "")) cursor += 1;
    if (body[cursor] !== ":") return null;
    cursor += 1;
    while (/\s/u.test(body[cursor] ?? "")) cursor += 1;
    const tail = body.slice(cursor);
    const token = /^(?:"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|true|false|null)/u.exec(tail);
    if (!token) return null;
    try { args[key[0]] = JSON.parse(token[0]); } catch { return null; }
    cursor += token[0].length;
    while (/\s/u.test(body[cursor] ?? "")) cursor += 1;
    if (cursor < body.length - 1 && body[cursor] !== ",") return null;
  }
  return args;
}

function schemaMentionsProperty(schema, property) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.properties && Object.hasOwn(schema.properties, property)) return true;
  return ["oneOf", "anyOf", "allOf"].some((keyword) =>
    Array.isArray(schema[keyword]) && schema[keyword].some((branch) => schemaMentionsProperty(branch, property)));
}

function providerToolCallCandidates(text, schema) {
  const aliases = { read_file: "read", list_dir: "list_files", edit_file: "edit", create_file: "create", run_test: "test", apply_patch: "edit" };
  const candidates = [];
  const pattern = /<tool_call>\s*([A-Za-z][A-Za-z0-9_-]*)\s*([\s\S]*?)(?:<\/tool_call>|(?=<tool_call>)|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const args = {};
    let pairs = 0;
    for (const pair of match[2].matchAll(/<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gu)) {
      const key = pair[1].trim(), raw = pair[2].trim();
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(key) || Object.hasOwn(args, key)) { pairs = -1; break; }
      try { args[key] = JSON.parse(raw); } catch { args[key] = raw; }
      pairs += 1;
    }
    if (pairs < 0) continue;
    const residual = match[2].replace(/<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gu, "").trim();
    const inline = residual ? inlineToolArguments(residual) : null;
    if (residual && inline === null) continue;
    if (inline && (pairs > 0 || Object.keys(inline).some((key) => Object.hasOwn(args, key)))) continue;
    Object.assign(args, inline ?? {});
    const value = { action: aliases[match[1]] ?? match[1], args };
    if (schemaMentionsProperty(schema, "reason")) {
      const reasoning = text.slice(0, match.index).replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
      value.reason = reasoning.slice(-500) || "Provider selected this tool action after bounded reasoning.";
    }
    candidates.push({ value, source: match[0].trim(), carrier: "provider-tool-call" });
  }
  return candidates;
}

function schemaProblems(validate, value) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map(({ instancePath, keyword, message, params }) =>
    `${instancePath || "$"}:${keyword}:${message}:${JSON.stringify(params ?? {})}`);
}

export function projectTypedInferenceCandidate(text, schema) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { value: null, source: "", carrier: null, problem: "provider-returned-no-text-candidate", parsedCandidateCount: 0, validCandidateCount: 0 };
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const parsed = [...parsedJsonCandidates(text), ...providerToolCallCandidates(text, schema)]
    .map((candidate) => ({ ...candidate, problems: schemaProblems(validate, candidate.value) }));
  const validByValue = new Map();
  for (const candidate of parsed.filter(({ problems }) => problems.length === 0)) {
    const identity = JSON.stringify(candidate.value);
    if (!validByValue.has(identity)) validByValue.set(identity, candidate);
  }
  const valid = [...validByValue.values()];
  if (valid.length === 1) {
    return { ...valid[0], problem: null, parsedCandidateCount: parsed.length, validCandidateCount: 1 };
  }
  if (valid.length > 1) {
    return {
      value: null,
      source: "",
      carrier: null,
      problem: `candidate-projection-ambiguous:${valid.length}-schema-valid-json-values`,
      parsedCandidateCount: parsed.length,
      validCandidateCount: valid.length,
    };
  }
  const last = parsed.at(-1);
  if (last) return { ...last, problem: null, parsedCandidateCount: parsed.length, validCandidateCount: 0 };
  return {
    value: null,
    source: "",
    carrier: null,
    problem: "candidate-is-not-json:no-balanced-json-value-found",
    parsedCandidateCount: 0,
    validCandidateCount: 0,
  };
}

function projectedSourceCandidate(text, contract) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { value: null, source: "", carrier: null, problem: "provider-returned-no-text-candidate", parsedCandidateCount: 0, validCandidateCount: 0 };
  }
  const projection = contract?.projection;
  if (contract?.format !== "projected" || !["single-file-create", "single-source-artifact"].includes(projection?.type) || typeof projection.path !== "string" || !projection.path) return null;
  const fenced = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)];
  if (fenced.length > 1) {
    return { value: null, source: "", carrier: null, problem: `candidate-projection-ambiguous:${fenced.length}-fenced-source-blocks`, parsedCandidateCount: fenced.length, validCandidateCount: 0 };
  }
  const source = (fenced.length === 1 ? fenced[0][1] : text).replace(/\s+$/u, "") + "\n";
  const value = projection.type === "single-file-create"
    ? { action: "create", args: { path: projection.path, content: source } }
    : {
        artifact: { path: projection.path, text: source },
        rationale: "Provider supplied the complete source artifact for independent customer assay.",
      };
  return {
    value,
    source,
    carrier: fenced.length === 1 ? "fenced-source-block" : "entire-source-output",
    problem: null,
    parsedCandidateCount: 1,
    validCandidateCount: 1,
  };
}

function projectedFencedToolCall(text, contract) {
  if (contract?.format !== "projected" || contract?.projection?.type !== "fenced-json-tool-call") return null;
  if (typeof text !== "string" || text.trim().length === 0) {
    return { value: null, source: "", carrier: null, problem: "provider-returned-no-text-candidate", parsedCandidateCount: 0, validCandidateCount: 0 };
  }
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/giu)];
  if (fenced.length !== 1) {
    return { value: null, source: "", carrier: null, problem: `candidate-projection-requires-one-fenced-tool-call:${fenced.length}`, parsedCandidateCount: fenced.length, validCandidateCount: 0 };
  }
  const source = fenced[0][1].trim();
  try {
    return { value: JSON.parse(source), source, carrier: "fenced-json-tool-call", problem: null, parsedCandidateCount: 1, validCandidateCount: 1 };
  } catch (error) {
    return { value: null, source, carrier: "fenced-json-tool-call", problem: `candidate-tool-call-is-not-json:${error.message}`, parsedCandidateCount: 1, validCandidateCount: 0 };
  }
}

function projectedTextCandidate(text, contract) {
  if (contract?.format !== "text") return null;
  if (typeof text !== "string" || text.length === 0) {
    return { value: null, source: "", carrier: null, problem: "provider-returned-no-text-candidate", parsedCandidateCount: 0, validCandidateCount: 0 };
  }
  return { value: text, source: text, carrier: "entire-text-output", problem: null, parsedCandidateCount: 1, validCandidateCount: 1 };
}
export async function assayTypedInferenceCandidate(procurement, { customer = "urn:ame:inference-work-lot-service", customerServices, settlementRoot = ROOT, dataRoot = resolve(settlementRoot, "data"), at = new Date().toISOString(), store: suppliedStore } = {}) {
  if (procurement?.type !== "TypedRmnInferenceProcurement" || procurement.disposition !== "candidate-pending-customer-assay") throw new Error("customer assay requires one pending typed inference candidate");
  if (!/^urn:/u.test(customer)) throw new Error("customer assay requires the owning customer's stable URN");
  const schema = procurement.demand?.outputContract?.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("customer-owned JSON Schema is required");
  const providerOutput = candidateText(procurement);
  const projected = projectedTextCandidate(providerOutput, procurement.demand?.outputContract)
    ?? projectedFencedToolCall(providerOutput, procurement.demand?.outputContract)
    ?? projectedSourceCandidate(providerOutput, procurement.demand?.outputContract);
  const parsed = projected ?? projectTypedInferenceCandidate(providerOutput, schema);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const problems = parsed.problem ? [parsed.problem] : schemaProblems(validate, parsed.value);
  const accepted = problems.length === 0;
  const core = {
    type: "CustomerTypedInferenceAssay",
    customer,
    procurement: procurement.settlement.completion,
    provider: procurement.selection.selected.provider.actor,
    providerOutput: ni(providerOutput ?? ""),
    candidate: ni(parsed.source),
    candidateValue: parsed.value,
    carrierProjection: {
      type: "DeterministicInferenceCarrierProjection",
      carrier: parsed.carrier,
      parsedCandidateCount: parsed.parsedCandidateCount,
      validCandidateCount: parsed.validCandidateCount,
    },
    schema: ni(schema),
    accepted,
    problems,
    assayedAt: at,
    providerSelfAttestation: false,
  };
  const assay = { id: ni(core), ...core };
  const witnessJournal = customerServices?.witnessJournal;
  if (!witnessJournal?.actor) throw new Error("customer assay requires one explicitly admitted semantic record journal");
  const store = suppliedStore ?? await createInferenceSettlementStore({ settlementRoot, actor: customer, caip2: process.env.SETTLEMENT_CAIP2 });
  if (store.actor !== customer) throw new Error("customer assay actor differs from the settlement-owned WitnessJournal plate");
  const projection = await store.record({ category: "typed-inference.customer-assay", recordedAt: at, record: { ...assay, witnessJournalProvider: witnessJournal.actor } });
  assay.projection = { graph: projection.documentNi, projection: projection.digest, networkReference: projection.reference };
  return Object.freeze(assay);
}
