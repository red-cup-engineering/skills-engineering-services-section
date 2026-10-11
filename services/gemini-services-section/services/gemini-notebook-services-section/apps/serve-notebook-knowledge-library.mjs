#!/usr/bin/env node
import process from "node:process";
import { createMcpServer } from "@red-cup-engineering/mcp-engineering-services-section/server";
import { operations } from "../src/notebook-library-market.mjs";

const tools = [
  ["observe_live_gemini_notebook_library", "Observe every Gemini notebook currently visible to this trusted provider adapter. Set includeSources only when source-topology scan is wanted.", {}, []],
  ["describe_live_gemini_notebook", "Observe one selected real notebook's complete source topology without changing it.", { notebookId: { type: "string" } }, ["notebookId"]],
  ["observe_live_gemini_notebook_studio", "List the existing Studio resources in one selected real notebook without generating or deleting anything.", { notebookId: { type: "string" }, type: { type: "string" } }, ["notebookId"]],
  ["get_live_gemini_notebook_studio_resource", "Get metadata for one exact existing Studio resource.", { notebookId: { type: "string" }, resourceId: { type: "string" } }, ["notebookId", "resourceId"]],
  ["read_live_gemini_notebook_studio_report", "Download and return one exact completed Studio report or provider-identified markdown/code artifact as bounded UTF-8 text.", { notebookId: { type: "string" }, resourceId: { type: "string" }, maximumBytes: { type: "integer", minimum: 1, maximum: 16777216 } }, ["notebookId", "resourceId"]],
  ["ask_live_gemini_notebook", "Ask one selected real Gemini notebook without exposing provider credentials; the answer retains provider citations.", { notebookId: { type: "string" }, question: { type: "string" } }, ["notebookId", "question"]],
].map(([name, description, properties, required]) => ({ name, description, inputSchema: { type: "object", properties, required, additionalProperties: false }, outputSchema: { type: "object" } }));
const route = { observe_live_gemini_notebook_library: operations.observeLiveNotebookLibrary, describe_live_gemini_notebook: operations.describeLiveNotebook, observe_live_gemini_notebook_studio: operations.observeLiveNotebookStudio, get_live_gemini_notebook_studio_resource: operations.getLiveNotebookStudioResource, read_live_gemini_notebook_studio_report: operations.readLiveNotebookStudioReport, ask_live_gemini_notebook: operations.askLiveNotebook };
async function dispatch(name, args) {
  const value = await route[name](args);
  if (value?.type !== "GeminiNotebookLiveStudioReport") return value;
  const { content: _content, ...carrier } = value.carrier;
  return { ...value, carrier };
}
const server = createMcpServer({
  name: "gemini-notebook-knowledge-library",
  version: "1.1.0",
  instructions: "Trusted local actors can observe live notebooks, their source topology and existing Studio resources, retrieve bounded report contents, and ask cited questions. The adapter never generates or deletes Studio resources, exposes provider credentials, or grants execution or governance authority.",
  tools: tools.map((tool) => ({ ...tool, handler: (args) => dispatch(tool.name, args) })),
});
await server.serveStdio({ input: process.stdin, output: process.stdout });
