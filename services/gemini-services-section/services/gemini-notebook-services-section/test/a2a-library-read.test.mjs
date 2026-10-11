import assert from "node:assert/strict";
import test from "node:test";
import { executeA2aLibraryRead } from "../src/a2a-library-read.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";

const CUSTOMER = "urn:ame:bare-cedar-fog-codex";
const OPERATION = `ni:///sha-256;${"7".repeat(42)}A`;
const activation = {
  type: "GeminiNotebookA2ALibraryReadActivation",
  version: 1,
  status: "active",
  customer: CUSTOMER,
  notebookScope: "provider-visible-library",
  operations: ["question", "studio-observation", "studio-report-read"],
};

function request(kind, body) {
  const normalized = kind === "question"
    ? { notebookId: body.notebookId, question: body.question }
    : kind === "studio-observation"
      ? { notebookId: body.notebookId, type: body.artifactType ?? null }
      : { notebookId: body.notebookId, resourceId: body.resourceId, maximumBytes: body.maximumBytes ?? 8 * 1024 * 1024 };
  return { customer: CUSTOMER, operationId: OPERATION, providerRequestDigest: semanticId(normalized), ...body };
}

test("the A2A library face executes the existing source-grounded question capability", () => {
  const input = request("question", { type: "GeminiNotebookA2ALiveQuestion", notebookId: "notebook-1", question: "What is proven?" });
  const result = executeA2aLibraryRead("question", input, {
    activation,
    ask: ({ notebookId, question }) => ({
      type: "GeminiNotebookLiveAnswer",
      notebookId,
      question,
      answer: { answer: "A cited result", references: ["source-1"] },
      externalEffects: ["gemini-notebook-chat-request"],
    }),
  });
  assert.equal(result.disposition, "completed");
  assert.deepEqual(result.result.answer.references, ["source-1"]);
  assert.deepEqual(result.externalEffects, ["gemini-notebook-chat-request"]);
});

test("the A2A library face preserves bounded Markdown report bytes and digest", () => {
  const input = request("studio-report-read", { type: "GeminiNotebookA2ALiveStudioReportRead", notebookId: "notebook-1", resourceId: "report-1", maximumBytes: 4096 });
  const result = executeA2aLibraryRead("studio-report-read", input, {
    activation,
    readReport: () => ({
      type: "GeminiNotebookLiveStudioReport",
      carrier: { mediaType: "text/markdown", byteLength: 9, sha256: "sha256:report", content: "# Report\n" },
      externalEffects: ["gemini-notebook-report-download"],
    }),
  });
  assert.equal(result.disposition, "completed");
  assert.equal(result.result.carrier.content, "# Report\n");
  assert.equal(result.result.carrier.sha256, "sha256:report");
});

test("a foreign customer is refused before the provider is called", () => {
  let calls = 0;
  const input = request("studio-observation", { type: "GeminiNotebookA2ALiveStudioObservation", notebookId: "notebook-1" });
  const result = executeA2aLibraryRead("studio-observation", { ...input, customer: "urn:ame:foreign" }, {
    activation,
    observeStudio: () => { calls += 1; },
  });
  assert.equal(result.code, "invalid-library-read-operation");
  assert.equal(calls, 0);
});
