#!/usr/bin/env node
// @red-cup-engineering/llm-server CLI — start the OpenAI-compatible chat-completions service.
//
// Configuration via environment: LLM_UPSTREAM (groq|nvidia|cerebras|anthropic,
// default groq), LLM_MODEL, PORT (default 8787). Keys are read by holography from
// the upstream's own env vars (e.g. GROQ_API_KEY).

import { start } from "@red-cup-engineering/http-server";
import { ENDPOINTS, type EndpointSpec } from "@red-cup-engineering/organizing-with-llm-agents/algebra";
import { createLlmServerApp } from "./service.mjs";

export async function main(env: Readonly<Record<string, string | undefined>>): Promise<void> {
  const upstreamId = env["LLM_UPSTREAM"] ?? "groq";
  const upstream = (ENDPOINTS as Record<string, EndpointSpec>)[upstreamId];
  if (upstream === undefined) throw new Error(`llm-server: unknown LLM_UPSTREAM ${upstreamId}`);
  const port = Number(env["PORT"] ?? 8787);
  const app = createLlmServerApp({
    upstream,
    ...(env["LLM_MODEL"] === undefined ? {} : { model: env["LLM_MODEL"] }),
  });
  const started = await start(app, port);
  const info = started as { port?: number };
  process.stdout.write(`llm-server listening on :${info.port ?? port} → ${upstream.id}\n`);
}

const proc = (globalThis as { process?: { argv?: string[]; env?: Record<string, string | undefined> } }).process;
const argv1 = proc?.argv?.[1];
if (typeof argv1 === "string" && import.meta.url === `file://${argv1}`) {
  void main(proc?.env ?? {});
}
