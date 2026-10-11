#!/usr/bin/env node
import { runGeminiNotebookSync } from "./gemini-notebook-cli.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument as arg } from "@red-cup-engineering/javascript-node-services-section/argv";
import { queryProviderCategory } from "./provider-evidence.mjs";
import { recordProviderJobRecord } from "./contract-gemini-notebook-async-jobs.js";
import { verifyNotebookCreationAuthorization } from "./notebook-creation-authorization-client.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-engineering-services-section/semiotic-content-address";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER = "urn:ame:notebooklm-inference-team";
const CATEGORY = "notebook-creation-jobs";
const PREDICATE = "urn:emsenn:gemini-notebook:category";
async function rows(dataRoot, operationId, options = {}) { return (await queryProviderCategory(CATEGORY, { predicate: PREDICATE, witnessJournalAgentUrl: options.witnessJournalAgentUrl })).map(({ value }) => value).filter((value) => value?.type === "GeminiNotebookJobRecord" && value.category === CATEGORY && value.row?.operationId === operationId).map((value) => value.row).sort((a, b) => Number(a.sequence) - Number(b.sequence)); }
function defaultCli(args) { const execution = runGeminiNotebookSync(args, { json: false, root: NODE_ROOT, maxBuffer: Number.POSITIVE_INFINITY }); return { status: execution.status, signal: execution.signal, errorCode: execution.errorCode, json: execution.value }; }

export function formNotebookCreationRequest(customer, title, authorization, authorizationRequestDigest) { const body = { type: "GeminiNotebookCreationRequest", customer, provider: PROVIDER, title, authorization, authorizationRequestDigest, effect: "create-one-empty-notebook", contextSwitch: false }; return { id: semanticId(body), ...body }; }

function exactVerification(value, request, now) {
  return value?.type === "NotebookCreationAuthorizationVerification" && value.active === true
    && value.authorization === request.authorization && value.provider === PROVIDER
    && value.beneficiary === request.customer && value.title === request.title
    && value.requestDigest === request.authorizationRequestDigest
    && typeof value.id === "string" && isNiUri(value.id)
    && Date.parse(value.expiresAt) >= Date.parse(now);
}

export async function createNotebook(request, options = {}) {
  const { id: requestId, ...requestBody } = request ?? {};
  if (requestId !== semanticId(requestBody) || request.provider !== PROVIDER || request.effect !== "create-one-empty-notebook" || request.contextSwitch !== false || !isNiUri(request.authorization ?? "") || !isNiUri(request.authorizationRequestDigest ?? "")) throw new TypeError("notebook creation request is not exact and authorization-bound");
  const dataRoot = resolve(options.dataRoot ?? join(NODE_ROOT, "data")), prior = await rows(dataRoot, request.id, options), completed = prior.find((row) => row.status === "completed");
  if (completed) return completed;
  if (prior.some((row) => row.status === "effect-intent-recorded")) throw new TypeError("notebook creation has ambiguous prior effect intent; automatic retry is refused");
  const now = options.now ?? new Date().toISOString(), recordOptions = { dataRoot, now, witnessJournalAgentUrl: options.witnessJournalAgentUrl };
  const verifyAuthorization = options.verifyAuthorization ?? ((input) => verifyNotebookCreationAuthorization(input, { agentUrl: options.authorizationAgentUrl, signal: options.signal }));
  const verification = await verifyAuthorization({ authorizationId: request.authorization, provider: PROVIDER, beneficiary: request.customer, title: request.title, requestDigest: request.authorizationRequestDigest });
  if (!exactVerification(verification, request, now)) throw new TypeError("notebook creation authorization verification is absent, expired, or changed");
  await recordProviderJobRecord(CATEGORY, { type: "GeminiNotebookCreationEffectIntent", operationId: request.id, request, authorizationVerification: verification.id, status: "effect-intent-recorded", startedAt: now }, recordOptions);
  const execution = (options.runCli ?? defaultCli)(["create", request.title, "--json"]);
  if (execution?.status !== 0) throw new Error(`Gemini Notebook creation effect is ambiguous (${execution?.errorCode ?? execution?.signal ?? execution?.status ?? "unknown"})`);
  const notebook = execution.json?.notebook;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(notebook?.id ?? "") || notebook.title !== request.title) throw new TypeError("Gemini Notebook creation returned malformed or changed notebook identity");
  return recordProviderJobRecord(CATEGORY, { type: "GeminiNotebookCreationReceipt", operationId: request.id, request: request.id, authorization: request.authorization, authorizationVerification: verification.id, provider: PROVIDER, customer: request.customer, notebookId: notebook.id, title: notebook.title, url: `https://notebook.google.com/notebook/${notebook.id}`, createdAt: notebook.created_at ?? now, status: "completed", authorityGranted: ["notebook-identity-custody"], authorityWithheld: ["source-mutation", "sharing", "generation", "deletion", "publication"] }, recordOptions);
}

export async function main() { const request = formNotebookCreationRequest(arg("--customer"), arg("--title"), arg("--authorization"), arg("--authorization-request-digest")); if (!process.argv.includes("--execute")) return process.stdout.write(`${JSON.stringify({ ...request, disposition: "dry-run-no-effect" }, null, 2)}\n`); if (arg("--request-id") !== request.id) throw new TypeError("live creation requires the exact --request-id"); process.stdout.write(`${JSON.stringify(await createNotebook(request), null, 2)}\n`); }
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
