import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { writeFileAtomic } from "@red-cup-engineering/computer-system-engine/filesystem";
import { runProviderExchange } from "../openai/provider-runtime.mjs";

/** A report could not be admitted from the available inference/evidence. */
export class ResearchBlocked extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ResearchBlocked";
    this.status = status;
  }
}

function urlsIn(text) {
  return [...new Set((String(text).match(/https?:\/\/[^\s)\]>"']+/gu) ?? []).map((url) => url.replace(/[.,;:]+$/u, "")))];
}

function wordCount(text) {
  // CJK prose has no word-separating spaces. Segment only that prose so Latin counts stay stable.
  const value=String(text),cjk=value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)??[];
  const segmenter=cjk.length?new Intl.Segmenter('zh',{granularity:'word'}):null;
  const cjkWords=cjk.reduce((sum,run)=>sum+[...segmenter.segment(run)].filter(part=>part.isWordLike).length,0);
  return cjkWords+value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu,' ').trim().split(/\s+/u).filter(Boolean).length;
}

export function citedUrls(text) {
  return urlsIn(text).filter((raw) => {
    try { const url = new URL(raw); return url.protocol === "http:" || url.protocol === "https:"; }
    catch { return false; }
  });
}

function digest(text) { return createHash("sha256").update(text, "utf8").digest("hex"); }

async function readText(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function readJson(path, fallback) {
  const text = await readText(path);
  return text ? JSON.parse(text) : fallback;
}

async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, value);
}

async function archiveDraft(reportPath, draft, checkpointText) {
  const stem = reportPath.replace(/\.md$/u, ".draft.previous");
  let suffix = "";
  for (let index = 2; ; index += 1) {
    if (!(await readText(`${stem}${suffix}.md`))) break;
    suffix = `-${index}`;
  }
  const archivedDraftPath = `${stem}${suffix}.md`;
  await save(archivedDraftPath, draft);
  if (checkpointText) await save(archivedDraftPath.replace(/\.md$/u, ".sources.json"), checkpointText);
  return archivedDraftPath;
}

/**
 * Produce or resume a source-grounded research report. The report and its
 * evidence stay beside the consumer's requested reportPath; this capability
 * does not own curriculum, channel, or episode state.
 *
 * @param {object} options
 * @param {string} options.reportPath Final Markdown report path.
 * @param {string} options.prompt Research question and report requirements.
 * @param {string} options.model Provider model.
 * @param {string} [options.provider='codex'] Inference provider id.
 * @param {number} [options.minWords=2000]
 * @param {number} [options.minSources=2]
 * @param {number} [options.completedSearches=0] Completed searches from a migrated caller checkpoint.
 * @param {Array<string|object>} [options.searchEvidence] Previously retained evidence, including source URIs.
 * @param {object} [options.env=process.env]
 * @param {Function} [options.onRecord] Receives `{step:'research', ...}` exchange checkpoints.
 * @param {Function} [options.runExchange] Injectable exchange function for alternate transports and deterministic use.
 * @param {boolean} [options.preserveSubmitted=true] Reuse an already admitted report even if its size is below current limits.
 * @returns {Promise<{reportPath:string,draftPath:string,sourcesPath:string,words:number,sources:number,searches:number,citedUrls:string[],status:string}>}
 */
export async function ensureResearchReport({
  reportPath,
  prompt,
  model,
  provider = "codex",
  minWords = 2000,
  language = "en",
  minSources = 2,
  completedSearches = 0,
  searchEvidence = [],
  env = process.env,
  onRecord = async () => {},
  runExchange = runProviderExchange,
  preserveSubmitted = true,
} = {}) {
  if (typeof reportPath !== "string" || !reportPath.trim()) throw new TypeError("reportPath is required");
  if (!reportPath.trim().endsWith(".md")) throw new TypeError("reportPath must end in .md");
  if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("prompt is required");
  if (typeof model !== "string" || !model.trim()) throw new TypeError("model is required");
  if (!Number.isSafeInteger(minWords) || minWords < 1 || !Number.isSafeInteger(minSources) || minSources < 1) throw new TypeError("minWords and minSources must be positive integers");
  if (!Number.isSafeInteger(completedSearches) || completedSearches < 0) throw new TypeError("completedSearches must be a nonnegative integer");
  if (!Array.isArray(searchEvidence)) throw new TypeError("searchEvidence must be an array");
  if (typeof onRecord !== "function" || typeof runExchange !== "function") throw new TypeError("onRecord and runExchange must be functions");

  const finalPath = resolve(reportPath);
  const draftPath = finalPath.replace(/\.md$/u, ".draft.md");
  const sourcesPath = finalPath.replace(/\.md$/u, ".sources.json");
  const checkpointPath = finalPath.replace(/\.md$/u, ".draft.sources.json");
  const previousReport = await readText(finalPath);
  const previousMetadata = await readJson(sourcesPath, {});
  const priorUrls = citedUrls(previousReport);
  const priorWords = wordCount(previousReport);
  const priorSearches = Number.isSafeInteger(previousMetadata?.grounding?.completedSearches) ? previousMetadata.grounding.completedSearches : 0;
  if (previousReport && priorWords >= minWords && priorUrls.length >= minSources && priorSearches >= 1) {
    return { reportPath: finalPath, draftPath, sourcesPath, words: priorWords, sources: priorUrls.length, searches: priorSearches, citedUrls: priorUrls, status: "reused" };
  }
  if (previousReport && preserveSubmitted) {
    return { reportPath: finalPath, draftPath, sourcesPath, words: priorWords, sources: priorUrls.length, searches: priorSearches, citedUrls: priorUrls, status: "preserved" };
  }
  if (previousReport) await save(finalPath.replace(/\.md$/u, ".previous.md"), previousReport);

  let draft = await readText(draftPath);
  const checkpointText = await readText(checkpointPath);
  let checkpoint = checkpointText ? JSON.parse(checkpointText) : { searches: completedSearches, exchanges: [], evidence: [] };
  if (draft && checkpointText && checkpoint.draftSha256 !== digest(draft)) {
    throw new ResearchBlocked("checkpoint-mismatch", "The saved research draft changed after its evidence checkpoint; remove or repair the checkpoint before continuing.");
  }
  let searches = draft ? Math.max(completedSearches, Number.isSafeInteger(checkpoint.searches) ? checkpoint.searches : 0) : 0;
  const priorEvidence = [...(Array.isArray(checkpoint.evidence) ? checkpoint.evidence : []), ...searchEvidence];
  const evidence = [...priorEvidence];
  const attempts = Array.isArray(checkpoint.exchanges) ? [...checkpoint.exchanges] : [];
  const saveCheckpoint = () => save(checkpointPath, JSON.stringify({ ...(draft ? { draftSha256: digest(draft) } : {}), searches, exchanges: attempts, evidence }, null, 2));

  const admitDraft = async (savedDraft) => {
    const urls = citedUrls(savedDraft), words = wordCount(savedDraft);
    if (searches < 1 || words < minWords || urls.length < minSources) {
      throw new ResearchBlocked("insufficient-evidence", `Saved research draft has ${words}/${minWords} words, ${urls.length}/${minSources} cited sources, and ${searches}/1 completed searches. Edit or remove the saved draft and its checkpoint to retry.`);
    }
    const sourceMetadata = {
      at: new Date().toISOString(),
      grounding: { completed: true, completedSearches: searches, sources: urls.map((uri) => ({ uri })) },
      inference: { model, provider, exchanges: attempts },
    };
    await save(finalPath, savedDraft);
    await save(sourcesPath, JSON.stringify(sourceMetadata, null, 2));
    return { reportPath: finalPath, draftPath, sourcesPath, words, sources: urls.length, searches, citedUrls: urls, status: "admitted" };
  };

  let revisionContext = "";
  if (draft) {
    const urls = citedUrls(draft), words = wordCount(draft);
    if (searches >= 1 && words >= minWords && urls.length >= minSources) return admitDraft(draft);
    const deficiency = `Saved research draft has ${words}/${minWords} words, ${urls.length}/${minSources} cited sources, and ${searches}/1 completed searches.`;
    const archivedDraftPath = await archiveDraft(finalPath, draft, checkpointText);
    revisionContext = `Existing deficient draft (${archivedDraftPath}) to revise and complete, retaining useful work:\n${draft}`;
    attempts.push({ outcome: "insufficient-evidence", message: deficiency, archivedDraftPath, recordedAt: new Date().toISOString() });
    draft = "";
    searches = 0;
    checkpoint = { searches: 0, exchanges: attempts, evidence: priorEvidence };
  }
  const instruction = [
    "Write a careful research report grounded in web sources. Treat sources as evidence, distinguish established findings from uncertainty, and include inline links for every factual claim that depends on a source.",
    `Minimum length: ${minWords} words. Cite at least ${minSources} distinct source URLs.`,
    "Return only the complete report in Markdown. Do not claim research was completed if you could not inspect adequate sources.",
  ].join("\n");
  const request = [
    `Research request:\n${prompt.trim()}`,
    evidence.length ? `Previously retained search evidence (use and cite relevant items):\n${JSON.stringify(evidence)}` : "",
    revisionContext,
  ].filter(Boolean).join("\n\n");

  let exchange;
  try {
    exchange = await runExchange(provider, {
      model,
      messages: [{ role: "system", content: instruction }, { role: "user", content: request }],
      params: { webSearch: true },
      "max-tokens": Math.max(4096, Math.ceil(minWords * (language.startsWith("zh") ? 5 : 2.2))),
    }, { env });
  } catch (error) {
    const refusal = { outcome: "refusal", message: error instanceof Error ? error.message : String(error), recordedAt: new Date().toISOString() };
    attempts.push(refusal);
    await save(draftPath, draft);
    await saveCheckpoint();
    await onRecord({ step: "research", provider, outcome: "refusal", message: refusal.message });
    throw new ResearchBlocked("provider-error", refusal.message);
  }

  const raw = exchange?.completion?.raw ?? {};
  const justSearched = Number.isSafeInteger(raw.completedSearches) ? raw.completedSearches : 0;
  searches = justSearched;
  const record = { outcome: exchange?.outcome ?? "invalid", recordedAt: exchange?.recordedAt ?? new Date().toISOString(), completedSearches: justSearched };
  if (exchange?.outcome !== "completion" || typeof exchange?.completion?.text !== "string") {
    record.refusal = exchange?.refusal ?? { grounds: ["missing-completion"] };
    attempts.push(record);
    await save(draftPath, draft);
    await saveCheckpoint();
    await onRecord({ step: "research", provider, outcome: "refusal", completedSearches: justSearched, refusal: record.refusal });
    throw new ResearchBlocked("provider-refusal", `Research provider refused: ${JSON.stringify(record.refusal)}`);
  }

  draft = exchange.completion.text.trim();
  record.model = exchange.completion.model ?? model;
  record.citedUrls = citedUrls(draft);
  attempts.push(record);
  await save(draftPath, draft);
  await save(checkpointPath, JSON.stringify({ draftSha256: digest(draft), searches, exchanges: attempts, evidence }, null, 2));
  await onRecord({ step: "research", provider, outcome: "completion", completedSearches: justSearched, citedUrls: record.citedUrls });

  const words = wordCount(draft), urls = record.citedUrls;
  if (searches < 1 || words < minWords || urls.length < minSources) {
    const why = `Research draft has ${words}/${minWords} words, ${urls.length}/${minSources} cited sources, and ${searches}/1 completed searches.`;
    await onRecord({ step: "research", provider, outcome: "blocked", words, sources: urls.length, searches });
    throw new ResearchBlocked("insufficient-evidence", why);
  }
  return admitDraft(draft);
}
