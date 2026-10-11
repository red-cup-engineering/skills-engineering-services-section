import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ACTOR = "urn:ame:gemini-notebook-binding-service";
export const NOTEBOOK_ID = "9c3eed44-7fa3-4203-8b79-e0a20b91017f";

const notebookUrl = (notebookId) => `https://notebook.google.com/notebook/${notebookId}`;
const NOTEBOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function readNotebookBinding(path = join(SERVICE_ROOT, "content/config/notebook.json")) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    value?.type !== "GeminiNotebookBoundNotebook" ||
    value.status !== "bound" ||
    value.actor !== ACTOR ||
    value.notebookId !== NOTEBOOK_ID ||
    value.url !== notebookUrl(value.notebookId) ||
    !/^urn:sha256:[a-f0-9]{64}$/u.test(value.creationReceipt ?? "")
  ) {
    throw new TypeError("Gemini Notebook binding is malformed");
  }
  return value;
}

export function formNotebookBindingCandidate(url) {
  const parsed = new URL(url);
  const notebookId = parsed.pathname.match(/^\/notebook\/([0-9a-f-]{36})$/u)?.[1];
  if (parsed.protocol !== "https:" || parsed.hostname !== "notebook.google.com" || !NOTEBOOK_ID_PATTERN.test(notebookId ?? "")) {
    throw new TypeError("Gemini Notebook binding requires an exact Gemini Notebook UUID URL");
  }
  return {
    type: "GeminiNotebookBindingCandidate",
    status: "candidate-not-accepted",
    actor: ACTOR,
    notebookId,
    url: notebookUrl(notebookId),
    authorityGranted: [],
  };
}
