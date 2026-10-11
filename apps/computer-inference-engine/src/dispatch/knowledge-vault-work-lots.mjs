import { validateSchemaInstance } from "@red-cup-engineering/json-schema-services-section/validate-schema-instance";
import { jsonValueId } from "./sen-carrier.mjs";

export const KNOWLEDGE_VAULT_WORK_LOT_KINDS = Object.freeze([
  "term-normalization",
  "alias-suggestions",
  "keyword-enrichment",
  "claim-extraction",
]);

const SPECIFICATIONS = Object.freeze({
  "term-normalization": Object.freeze({
    candidateType: "KnowledgeVaultTermNormalizationCandidate",
    taskClass: "knowledge-vault/term-normalization/v1",
    workType: "extraction",
  }),
  "alias-suggestions": Object.freeze({
    candidateType: "KnowledgeVaultAliasSuggestionsCandidate",
    taskClass: "knowledge-vault/alias-suggestions/v1",
    workType: "inquiry",
  }),
  "keyword-enrichment": Object.freeze({
    candidateType: "KnowledgeVaultKeywordEnrichmentCandidate",
    taskClass: "knowledge-vault/keyword-enrichment/v1",
    workType: "extraction",
  }),
  "claim-extraction": Object.freeze({
    candidateType: "KnowledgeVaultClaimExtractionCandidate",
    taskClass: "knowledge-vault/claim-extraction/v1",
    workType: "extraction",
  }),
});

function nonemptyText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must contain text`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function evidenceSchema(sourceId) {
  return {
    type: "object",
    required: ["sourceId", "start", "end", "quote"],
    properties: {
      sourceId: { const: sourceId },
      start: { type: "integer", minimum: 0 },
      end: { type: "integer", minimum: 1 },
      quote: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  };
}

function sourceSchema(source) {
  const required = ["id", "textNi"];
  const properties = { id: { const: source.id }, textNi: { const: source.textNi } };
  if (source.url !== undefined) { required.push("url"); properties.url = { const: source.url }; }
  return { type: "object", required, properties, additionalProperties: false };
}

function outputSchema(kind, source, term, maximumSuggestions) {
  const spec = SPECIFICATIONS[kind];
  const common = {
    type: { const: spec.candidateType },
    version: { const: 1 },
    source: sourceSchema(source),
  };
  if (kind === "term-normalization") return {
    type: "object",
    required: ["type", "version", "source", "observedTerm", "normalizedTerm", "rationale", "evidence"],
    properties: {
      ...common,
      observedTerm: { const: term },
      normalizedTerm: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 },
      evidence: { type: "array", minItems: 1, items: evidenceSchema(source.id) },
    },
    additionalProperties: false,
  };
  if (kind === "alias-suggestions") return {
    type: "object",
    required: ["type", "version", "source", "canonicalTerm", "suggestions"],
    properties: {
      ...common,
      canonicalTerm: { const: term },
      suggestions: {
        type: "array",
        maxItems: maximumSuggestions,
        items: {
          type: "object",
          required: ["alias", "relation", "evidence"],
          properties: {
            alias: { type: "string", minLength: 1 },
            relation: { enum: ["abbreviation", "former-name", "spelling-variant", "synonym"] },
            evidence: { type: "array", minItems: 1, items: evidenceSchema(source.id) },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  };
  if (kind === "claim-extraction") return {
    type: "object",
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        maxItems: maximumSuggestions,
        items: {
          type: "object",
          required: ["subject", "predicate", "object", "quote"],
          properties: {
            subject: { type: "string", minLength: 1, maxLength: 200 },
            predicate: { type: "string", minLength: 1, maxLength: 200 },
            object: { type: "string", minLength: 1, maxLength: 200 },
            quote: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  };
  return {
    type: "object",
    required: ["type", "version", "source", "keywords"],
    properties: {
      ...common,
      keywords: {
        type: "array",
        maxItems: maximumSuggestions,
        items: {
          type: "object",
          required: ["keyword", "evidence"],
          properties: {
            keyword: { type: "string", minLength: 1 },
            evidence: { type: "array", minItems: 1, items: evidenceSchema(source.id) },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  };
}

function objective(kind, term, maximumSuggestions) {
  if (kind === "term-normalization") return `Suggest one normalized display form for the observed knowledge-vault term ${JSON.stringify(term)}. Use only the supplied source and cite exact character spans.`;
  if (kind === "alias-suggestions") return `Suggest at most ${maximumSuggestions} aliases for the canonical knowledge-vault term ${JSON.stringify(term)}. Return no suggestion without an exact supporting character span.`;
  if (kind === "claim-extraction") return `Extract at most ${maximumSuggestions} factual claims from the supplied source. Return only one JSON object conforming to the supplied closed output schema. Every claim quote must reproduce source text exactly, word for word. The subject and object must each appear literally in that exact quote; preserve the source’s wording rather than substituting pronouns, aliases or paraphrases. Predicate is the relation expressed by the cited text. Return an empty claims array rather than an unsupported claim.`;
  return `Suggest at most ${maximumSuggestions} retrieval keywords grounded in the supplied knowledge-vault source. Return no keyword without an exact supporting character span.`;
}

export function formKnowledgeVaultWorkLot({ kind, source, term, maximumSuggestions = 8 }) {
  const spec = SPECIFICATIONS[kind];
  if (!spec) throw new TypeError(`kind must be one of: ${KNOWLEDGE_VAULT_WORK_LOT_KINDS.join(", ")}`);
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError("source must be one finite knowledge-vault source");
  const sourceId = nonemptyText(source.id, "source.id").trim();
  const sourceText = nonemptyText(source.text, "source.text");
  const exactTerm = kind === "keyword-enrichment" || kind === "claim-extraction" ? undefined : nonemptyText(term, "term");
  const sourceUrl = kind === "claim-extraction" ? nonemptyText(source.url, "source.url").trim() : undefined;
  positiveInteger(maximumSuggestions, "maximumSuggestions");
  const admittedSource = Object.freeze({ id: sourceId, text: sourceText, textNi: jsonValueId(sourceText), ...(sourceUrl === undefined ? {} : { url: sourceUrl }) });
  const schema = outputSchema(kind, admittedSource, exactTerm, maximumSuggestions);
  const context = JSON.stringify({
    kind,
    source: admittedSource,
    ...(exactTerm === undefined ? {} : { term: exactTerm }),
    maximumSuggestions,
    evidenceLaw: "Every evidence item must reproduce source.text.slice(start, end) exactly. Empty output arrays are preferable to unsupported suggestions.",
  });
  const identity = jsonValueId({ kind, source: { id: sourceId, textNi: admittedSource.textNi, url: sourceUrl ?? null }, term: exactTerm ?? null, maximumSuggestions });
  // Claim extraction asks schema-capable lanes to shape their answer; every lane that emits JSON
  // may answer, since the customer's assay below is the schema authority.
  const shapesProviderSchema = kind === "claim-extraction";
  return Object.freeze({
    objective: objective(kind, exactTerm, maximumSuggestions),
    context,
    desiredUse: "Produce an untrusted, source-grounded knowledge-vault candidate for deterministic customer assay; this lot grants no glossary or vault mutation authority.",
    workType: spec.workType,
    taskClass: spec.taskClass,
    requiredCapabilities: Object.freeze([spec.workType, ...(shapesProviderSchema ? ["json-output"] : [])]),
    outputSchema: schema,
    enforceProviderSchema: shapesProviderSchema,
    workLotId: `urn:work-lot:knowledge-vault:${identity.split(";")[1]}`,
    mode: "live",
  });
}

function schemaProblems(schema, candidate) {
  const result = validateSchemaInstance({ schema, instance: candidate });
  if (result.ok) return [];
  return result.errors.map(({ pointer, keyword, message }) => `$${pointer}:${keyword}:${message}`);
}

function canonicalSuggestion(value) {
  return typeof value === "string" && value === value.trim() && !/[\r\n\t]/u.test(value) && !/ {2,}/u.test(value);
}

function evidenceProblems(items, source, path) {
  const problems = [];
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}/${index}`;
    if (item.end <= item.start) problems.push(`${itemPath}:span:end-must-exceed-start`);
    if (item.end > source.text.length) problems.push(`${itemPath}:span:end-exceeds-source`);
    if (source.text.slice(item.start, item.end) !== item.quote) problems.push(`${itemPath}:span:quote-does-not-match-source`);
  }
  return problems;
}

function suggestionAppearsInEvidence(value, evidence) {
  const needle = value.normalize("NFKC").toLocaleLowerCase("en-US");
  return evidence.some(({ quote }) => quote.normalize("NFKC").toLocaleLowerCase("en-US").includes(needle));
}

/**
 * A claim-extraction quote reproduces the source verbatim when it appears as
 * an exact substring; the customer (never the provider) is trusted to have
 * located it, so the assay's only job is to check the customer's own work.
 * @param {unknown} quote
 * @param {{text: string}} source
 * @returns {boolean}
 */
function quoteReproducesSource(quote, source) {
  return typeof quote === "string" && quote.length > 0 && source.text.includes(quote);
}

export function assayKnowledgeVaultCandidate(workLot, candidate) {
  if (!workLot || typeof workLot !== "object" || Array.isArray(workLot)) throw new TypeError("one formed knowledge-vault work lot is required");
  const specification = Object.values(SPECIFICATIONS).find(({ taskClass }) => taskClass === workLot.taskClass);
  if (!specification) throw new TypeError("workLot is not an admitted knowledge-vault lot kind");
  let context;
  try { context = JSON.parse(workLot.context); } catch { throw new TypeError("workLot context is not its structured finite source carrier"); }
  const schema = workLot.outputSchema ?? outputSchema(context.kind, context.source, context.term, context.maximumSuggestions);
  const identifiedCandidate = candidate === undefined ? null : candidate;
  const problems = schemaProblems(schema, identifiedCandidate);
  const schemaValid = problems.length === 0;
  if (schemaValid) {
    if (context.kind === "term-normalization") {
      if (!canonicalSuggestion(candidate.normalizedTerm)) problems.push("/normalizedTerm:canonical-form:must-be-trimmed-single-line-text");
      problems.push(...evidenceProblems(candidate.evidence, context.source, "/evidence"));
      if (!suggestionAppearsInEvidence(candidate.normalizedTerm, candidate.evidence)) problems.push("/normalizedTerm:grounding:not-present-in-cited-evidence");
    } else if (context.kind === "claim-extraction") {
      for (const [index, claim] of candidate.claims.entries()) {
        for (const field of ["subject", "predicate", "object"]) {
          if (!canonicalSuggestion(claim[field])) problems.push(`/claims/${index}/${field}:canonical-form:must-be-trimmed-single-line-text`);
        }
        if (!quoteReproducesSource(claim.quote, context.source)) {
          problems.push(`/claims/${index}/quote:span:quote-does-not-match-source`);
        } else if (!suggestionAppearsInEvidence(claim.subject, [{ quote: claim.quote }]) || !suggestionAppearsInEvidence(claim.object, [{ quote: claim.quote }])) {
          problems.push(`/claims/${index}:grounding:subject-or-object-not-present-in-cited-evidence`);
        }
      }
    } else {
      const entries = context.kind === "alias-suggestions" ? candidate.suggestions : candidate.keywords;
      const field = context.kind === "alias-suggestions" ? "alias" : "keyword";
      const seen = new Set();
      for (const [index, entry] of entries.entries()) {
        const value = entry[field];
        if (!canonicalSuggestion(value)) problems.push(`/${context.kind === "alias-suggestions" ? "suggestions" : "keywords"}/${index}/${field}:canonical-form:must-be-trimmed-single-line-text`);
        const key = value.toLocaleLowerCase("en-US");
        if (seen.has(key)) problems.push(`/${context.kind === "alias-suggestions" ? "suggestions" : "keywords"}/${index}/${field}:duplicate:case-insensitive-duplicate`);
        seen.add(key);
        if (context.kind === "alias-suggestions" && key === context.term.toLocaleLowerCase("en-US")) problems.push(`/suggestions/${index}/alias:identity:not-an-alias`);
        problems.push(...evidenceProblems(entry.evidence, context.source, `/${context.kind === "alias-suggestions" ? "suggestions" : "keywords"}/${index}/evidence`));
        if (!suggestionAppearsInEvidence(value, entry.evidence)) problems.push(`/${context.kind === "alias-suggestions" ? "suggestions" : "keywords"}/${index}/${field}:grounding:not-present-in-cited-evidence`);
      }
    }
  }
  // Each listed item is its own evidence cell: a schema-valid candidate's items are judged one
  // by one, so one ungrounded item refuses itself, never its grounded siblings.
  const itemsPath = { "claim-extraction": "claims", "alias-suggestions": "suggestions" }[context.kind]
    ?? (context.kind === "term-normalization" ? null : "keywords");
  const items = itemsPath && schemaValid ? candidate[itemsPath] : [];
  const admittedItems = items.flatMap((_, index) => problems.some((problem) => problem.startsWith(`/${itemsPath}/${index}/`) || problem.startsWith(`/${itemsPath}/${index}:`)) ? [] : [index]);
  const core = {
    type: "KnowledgeVaultInferenceCandidateAssay",
    version: 1,
    workLot: workLot.workLotId,
    taskClass: workLot.taskClass,
    candidate: jsonValueId(identifiedCandidate),
    accepted: problems.length === 0,
    problems,
    admittedItems,
    receiverAcceptanceGranted: false,
    nextAct: problems.length === 0
      ? "A receiving vault operation may now decide usefulness; this deterministic assay did not mutate or accept content into the vault."
      : "Refuse this candidate or contract a corrected lot using the exact assay problems.",
  };
  return Object.freeze({ id: jsonValueId(core), ...core });
}
