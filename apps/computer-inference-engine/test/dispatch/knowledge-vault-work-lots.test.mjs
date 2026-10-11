import assert from "node:assert/strict";
import test from "node:test";
import { assayKnowledgeVaultCandidate, formKnowledgeVaultWorkLot, KNOWLEDGE_VAULT_WORK_LOT_KINDS } from "../../src/dispatch/knowledge-vault-work-lots.mjs";

const SOURCE = {
  id: "vault://terms/relation-model-notation",
  text: "Relation Model Notation (SEN) is a notation for typed relations. SEN terms are carried as data.",
};

function evidence(quote) {
  const start = SOURCE.text.indexOf(quote);
  return { sourceId: SOURCE.id, start, end: start + quote.length, quote };
}

test("the market admits four knowledge-vault lots through existing provider work types", () => {
  assert.deepEqual(KNOWLEDGE_VAULT_WORK_LOT_KINDS, ["term-normalization", "alias-suggestions", "keyword-enrichment", "claim-extraction"]);
  const normalization = formKnowledgeVaultWorkLot({ kind: "term-normalization", source: SOURCE, term: "Relation Model Notation" });
  const aliases = formKnowledgeVaultWorkLot({ kind: "alias-suggestions", source: SOURCE, term: "Relation Model Notation", maximumSuggestions: 3 });
  const keywords = formKnowledgeVaultWorkLot({ kind: "keyword-enrichment", source: SOURCE, maximumSuggestions: 4 });
  assert.deepEqual([normalization.workType, aliases.workType, keywords.workType], ["extraction", "inquiry", "extraction"]);
  assert.deepEqual([normalization.taskClass, aliases.taskClass, keywords.taskClass], [
    "knowledge-vault/term-normalization/v1",
    "knowledge-vault/alias-suggestions/v1",
    "knowledge-vault/keyword-enrichment/v1",
  ]);
  assert.equal(normalization.requiredCapabilities.includes("extraction"), true);
  assert.equal(normalization.enforceProviderSchema, false);
  assert.match(normalization.desiredUse, /no glossary or vault mutation authority/u);
  assert.match(normalization.workLotId, /^urn:work-lot:knowledge-vault:/u);
  assert.equal(aliases.outputSchema.properties.suggestions.maxItems, 3);
  assert.equal(keywords.outputSchema.properties.keywords.maxItems, 4);
});

test("term normalization remains a source-bound candidate after deterministic assay", () => {
  const lot = formKnowledgeVaultWorkLot({ kind: "term-normalization", source: SOURCE, term: "Relation Model Notation" });
  const context = JSON.parse(lot.context);
  const assay = assayKnowledgeVaultCandidate(lot, {
    type: "KnowledgeVaultTermNormalizationCandidate",
    version: 1,
    source: { id: SOURCE.id, textNi: context.source.textNi },
    observedTerm: "Relation Model Notation",
    normalizedTerm: "Relation Model Notation",
    rationale: "The supplied source spells out the term before introducing its abbreviation.",
    evidence: [evidence("Relation Model Notation (SEN)")],
  });
  assert.equal(assay.accepted, true);
  assert.deepEqual(assay.problems, []);
  assert.equal(assay.receiverAcceptanceGranted, false);
});

test("alias and keyword suggestions require unique source-grounded evidence", () => {
  const aliasLot = formKnowledgeVaultWorkLot({ kind: "alias-suggestions", source: SOURCE, term: "Relation Model Notation", maximumSuggestions: 3 });
  const aliasContext = JSON.parse(aliasLot.context);
  const aliasAssay = assayKnowledgeVaultCandidate(aliasLot, {
    type: "KnowledgeVaultAliasSuggestionsCandidate",
    version: 1,
    source: { id: SOURCE.id, textNi: aliasContext.source.textNi },
    canonicalTerm: "Relation Model Notation",
    suggestions: [{ alias: "SEN", relation: "abbreviation", evidence: [evidence("SEN")] }],
  });
  assert.equal(aliasAssay.accepted, true);

  const keywordLot = formKnowledgeVaultWorkLot({ kind: "keyword-enrichment", source: SOURCE, maximumSuggestions: 4 });
  const keywordContext = JSON.parse(keywordLot.context);
  const candidate = {
    type: "KnowledgeVaultKeywordEnrichmentCandidate",
    version: 1,
    source: { id: SOURCE.id, textNi: keywordContext.source.textNi },
    keywords: [
      { keyword: "typed relations", evidence: [evidence("typed relations")] },
      { keyword: "Typed Relations", evidence: [evidence("typed relations")] },
    ],
  };
  const keywordAssay = assayKnowledgeVaultCandidate(keywordLot, candidate);
  assert.equal(keywordAssay.accepted, false);
  assert.equal(keywordAssay.problems.some((problem) => problem.includes("case-insensitive-duplicate")), true);
});

test("the independent assay rejects invented or shifted evidence spans", () => {
  const lot = formKnowledgeVaultWorkLot({ kind: "alias-suggestions", source: SOURCE, term: "Relation Model Notation" });
  const context = JSON.parse(lot.context);
  const assay = assayKnowledgeVaultCandidate(lot, {
    type: "KnowledgeVaultAliasSuggestionsCandidate",
    version: 1,
    source: { id: SOURCE.id, textNi: context.source.textNi },
    canonicalTerm: "Relation Model Notation",
    suggestions: [{ alias: "RelMod", relation: "abbreviation", evidence: [{ sourceId: SOURCE.id, start: 0, end: 6, quote: "RelMod" }] }],
  });
  assert.equal(assay.accepted, false);
  assert.deepEqual(assay.problems, ["/suggestions/0/evidence/0:span:quote-does-not-match-source"]);
});

test("the independent assay rejects a suggestion backed by a real but unrelated quote", () => {
  const lot = formKnowledgeVaultWorkLot({ kind: "alias-suggestions", source: SOURCE, term: "Relation Model Notation" });
  const context = JSON.parse(lot.context);
  const assay = assayKnowledgeVaultCandidate(lot, {
    type: "KnowledgeVaultAliasSuggestionsCandidate",
    version: 1,
    source: { id: SOURCE.id, textNi: context.source.textNi },
    canonicalTerm: "Relation Model Notation",
    suggestions: [{ alias: "RelMod", relation: "abbreviation", evidence: [evidence("typed relations")] }],
  });
  assert.equal(assay.accepted, false);
  assert.deepEqual(assay.problems, ["/suggestions/0/alias:grounding:not-present-in-cited-evidence"]);
});

test("claim extraction is a schema-enforced closed JSON lot whose structured candidate is independently assayed", () => {
  const source = { ...SOURCE, url: "https://example.org/story/sen" };
  const lot = formKnowledgeVaultWorkLot({ kind: "claim-extraction", source, maximumSuggestions: 4 });
  assert.equal(lot.taskClass, "knowledge-vault/claim-extraction/v1");
  assert.equal(lot.workType, "extraction");
  assert.equal(lot.enforceProviderSchema, true);
  assert.deepEqual(lot.requiredCapabilities, ["extraction", "json-schema-output"]);
  assert.equal(lot.outputSchema.type, "object");
  assert.deepEqual(lot.outputSchema.required, ["claims"]);
  assert.equal(lot.outputSchema.additionalProperties, false);
  assert.equal(lot.outputSchema.properties.claims.items.additionalProperties, false);
  assert.deepEqual(lot.outputSchema.properties.claims.items.required, ["subject", "predicate", "object", "quote"]);
  assert.match(lot.objective, /JSON object/u);

  const accepted = assayKnowledgeVaultCandidate(lot, {
    claims: [{
      subject: "SEN",
      predicate: "is a notation for",
      object: "typed relations",
      quote: "SEN) is a notation for typed relations",
    }],
  });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.problems, []);

  const inventedQuote = assayKnowledgeVaultCandidate(lot, {
    claims: [{
      subject: "SEN",
      predicate: "is a notation for",
      object: "typed relations",
      quote: "wrong",
    }],
  });
  assert.equal(inventedQuote.accepted, false);
  assert.deepEqual(inventedQuote.problems, ["/claims/0/quote:span:quote-does-not-match-source"]);

  const ungroundedObject = assayKnowledgeVaultCandidate(lot, {
    claims: [{
      subject: "SEN",
      predicate: "is a notation for",
      object: "typed relations",
      quote: "SEN terms are carried as data",
    }],
  });
  assert.equal(ungroundedObject.accepted, false);
  assert.deepEqual(ungroundedObject.problems, ["/claims/0:grounding:subject-or-object-not-present-in-cited-evidence"]);

  const malformed = assayKnowledgeVaultCandidate(lot, {
    claims: [{ subject: "SEN", predicate: "is a notation for", object: "typed relations" }],
  });
  assert.equal(malformed.accepted, false);
  assert.equal(malformed.problems.some((problem) => problem.includes("required")), true);
});

test("formed lot identity is stable and changes with exact source content", () => {
  const first = formKnowledgeVaultWorkLot({ kind: "keyword-enrichment", source: SOURCE });
  const replay = formKnowledgeVaultWorkLot({ kind: "keyword-enrichment", source: SOURCE });
  const changed = formKnowledgeVaultWorkLot({ kind: "keyword-enrichment", source: { ...SOURCE, text: `${SOURCE.text} Added.` } });
  assert.equal(first.workLotId, replay.workLotId);
  assert.notEqual(first.workLotId, changed.workLotId);
});
