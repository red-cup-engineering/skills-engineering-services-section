import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER } from "./contract-gemini-notebook-audio-delivery.js";
import { askLiveNotebook, observeLiveNotebookStudio, readLiveNotebookStudioReport } from "./notebook-library-market.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const KINDS = new Set(["question", "studio-observation", "studio-report-read"]);

export function loadLibraryReadActivation(path = join(ROOT, "content/config/a2a-library-read.json")) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.type !== "GeminiNotebookA2ALibraryReadActivation" || value.version !== 1 || value.status !== "active"
      || typeof value.customer !== "string" || value.notebookScope !== "provider-visible-library"
      || !Array.isArray(value.operations) || value.operations.some((kind) => !KINDS.has(kind))) {
    throw new TypeError("Gemini Notebook A2A library-read activation is malformed or closed");
  }
  return value;
}
function normalized(kind, request) {
  if (kind === "question") return { notebookId: request.notebookId, question: request.question };
  if (kind === "studio-observation") return { notebookId: request.notebookId, type: request.artifactType ?? null };
  return { notebookId: request.notebookId, resourceId: request.resourceId, maximumBytes: request.maximumBytes ?? 8 * 1024 * 1024 };
}
function resultType(kind) {
  return kind === "question" ? "GeminiNotebookA2ALiveQuestionResult"
    : kind === "studio-observation" ? "GeminiNotebookA2ALiveStudioObservationResult"
      : "GeminiNotebookA2ALiveStudioReportReadResult";
}
function refusal(kind, request, code) {
  return { type: resultType(kind), provider: PROVIDER, operation: request?.operationId ?? null, disposition: "refused", code, externalEffects: [] };
}
function valid(kind, request, policy) {
  if (!policy.operations.includes(kind) || request?.customer !== policy.customer || !isNiUri(request?.operationId ?? "")
      || !isNiUri(request?.providerRequestDigest ?? "") || typeof request.notebookId !== "string" || request.notebookId.trim() === "") return false;
  if (kind === "question" && (request.type !== "GeminiNotebookA2ALiveQuestion" || typeof request.question !== "string" || request.question.trim() === "" || request.question.length > 12_000)) return false;
  if (kind === "studio-observation" && (request.type !== "GeminiNotebookA2ALiveStudioObservation" || (request.artifactType !== undefined && typeof request.artifactType !== "string"))) return false;
  if (kind === "studio-report-read" && (request.type !== "GeminiNotebookA2ALiveStudioReportRead" || typeof request.resourceId !== "string" || request.resourceId === "" || (request.maximumBytes !== undefined && (!Number.isInteger(request.maximumBytes) || request.maximumBytes < 1 || request.maximumBytes > 16 * 1024 * 1024)))) return false;
  return request.providerRequestDigest === semanticId(normalized(kind, request));
}

export async function executeA2aLibraryRead(kind, request, options = {}) {
  let policy;
  try { policy = options.activation ?? loadLibraryReadActivation(options.activationPath); }
  catch { return refusal(kind, request, "library-read-not-activated"); }
  if (!valid(kind, request, policy)) return refusal(kind, request, "invalid-library-read-operation");
  try {
    const providerOptions = { ...(options.providerOptions ?? {}), ...(options.now ? { now: options.now } : {}) };
    const value = await (kind === "question"
      ? (options.ask ?? askLiveNotebook)({ notebookId: request.notebookId, question: request.question }, providerOptions)
      : kind === "studio-observation"
        ? (options.observeStudio ?? observeLiveNotebookStudio)({ notebookId: request.notebookId, type: request.artifactType }, providerOptions)
        : (options.readReport ?? readLiveNotebookStudioReport)({ notebookId: request.notebookId, resourceId: request.resourceId, maximumBytes: request.maximumBytes }, providerOptions));
    return { type: resultType(kind), provider: PROVIDER, operation: request.operationId, disposition: "completed", result: value, externalEffects: value.externalEffects ?? [] };
  } catch (error) {
    return { ...refusal(kind, request, error?.code === "GEMINI_NOTEBOOK_PROVIDER_TIMEOUT" ? "provider-timeout" : "provider-refused-library-read"), detail: error instanceof Error ? error.message : String(error) };
  }
}
