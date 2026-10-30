import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { admitSourcePinnedAdvisory, providerAdvisoryCandidate, sourceBoundCorpus } from "../src/source-pinned-analysis.mjs";

const ACTOR = "urn:ame:bare-cedar-fog-codex";
const NOTEBOOK = "urn:ame:notebooklm-inference-team";

function fixture() {
  const corpus = sourceBoundCorpus([
    { source: "urn:source:one", digest: "urn:sha256:one", coordinates: "one.md:10" },
    { source: "urn:source:two", digest: "urn:sha256:two", coordinates: "two.md:20" },
  ]);
  const providerCandidate = providerAdvisoryCandidate({
    provider: NOTEBOOK, corpus: corpus.id, advice: "The two sources disagree about closure authority.",
    citations: [{ source: "urn:source:one", coordinates: "one.md:10" }, { source: "urn:source:two", coordinates: "two.md:20" }],
    contradictions: ["source one permits supplier completion while source two requires receiver acceptance"],
    unknowns: ["no receiver outcome is present"], providerReceipt: "ni:///sha-256;notebook-receipt",
    consideration: { denomination: "relative-resolution-milliquanta-v1", amount: { numerator: "21", denominator: "1" }, source: "urn:offer:notebook" },
  });
  return { corpus, providerCandidate };
}

function input(corpus, providerCandidate) {
  return { actor: ACTOR, demand: "urn:demand:analysis", corpus, deterministicLookupReceipt: "urn:receipt:corpus-query", providerCandidate };
}

test("source-pinned advice preserves exact corpus, citations, unknowns, contradictions, economics, and no authority", () => {
  const { corpus, providerCandidate } = fixture();
  const result = admitSourcePinnedAdvisory(input(corpus, providerCandidate));
  assert.equal(result.type, "ReceiptedAdvisoryK");
  assert.equal(result.corpus, corpus.id);
  assert.equal(result.providerReceipt, providerCandidate.providerReceipt);
  assert.equal(result.citations.length, 2);
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.unknowns.length, 1);
  assert.equal(result.mutationAuthority, false);
  assert.equal(result.acceptanceAuthority, false);
  assert.deepEqual(result.conveys, []);
});

test("corpus drift, foreign citation, wrong provider, and authority-bearing advice are refused", () => {
  const { corpus, providerCandidate } = fixture();
  assert.throws(() => admitSourcePinnedAdvisory(input({ ...corpus, segments: corpus.segments.slice(0, 1) }, providerCandidate)), /content addressed exactly/u);
  const foreign = providerAdvisoryCandidate({ ...providerCandidate, citations: [{ source: "urn:source:foreign", coordinates: "x:1" }] });
  assert.throws(() => admitSourcePinnedAdvisory(input(corpus, foreign)), /outside the exact corpus/u);
  const wrong = providerAdvisoryCandidate({ ...providerCandidate, provider: "urn:ame:generic-model" });
  assert.throws(() => admitSourcePinnedAdvisory(input(corpus, wrong)), /requires urn:ame:notebooklm-inference-team/u);
  assert.throws(() => providerAdvisoryCandidate({ ...providerCandidate, conveys: ["mutation-authority"] }), /cannot convey/u);
});

test("provider refusal becomes a receipted no-bypass obstruction", () => {
  const { corpus } = fixture();
  const result = admitSourcePinnedAdvisory({ actor: ACTOR, demand: "urn:demand:x", corpus, deterministicLookupReceipt: "urn:lookup:x", providerRefusal: { receipt: "urn:refusal:notebook-unavailable" } });
  assert.equal(result.type, "SourcePinnedAnalysisObstructionK");
  assert.equal(result.bypassAuthorized, false);
  assert.deepEqual(result.conveys, []);
});

test("a fresh MAPE MCP process admits exact source-pinned advice", () => {
  const { corpus, providerCandidate } = fixture();
  const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "admit_source_pinned_advisory", arguments: input(corpus, providerCandidate) } };
  const server = new URL("../src/mape-office-mcp.mjs", import.meta.url);
  const run = spawnSync(process.execPath, [server.pathname], { input: `${JSON.stringify(request)}\n`, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const response = JSON.parse(run.stdout).result.structuredContent;
  assert.equal(response.type, "ReceiptedAdvisoryK");
  assert.equal(response.providerReceipt, providerCandidate.providerReceipt);
  assert.deepEqual(response.conveys, []);
});
