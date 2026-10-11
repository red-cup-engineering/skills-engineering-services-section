#!/usr/bin/env node
// infer — one chat completion against any provider in content/openai/providers/catalog.json, keyed from
// the repository's .env. Plain Node, no dependencies. Prints the assistant text (or the whole
// response with --json). This is how agents send mechanical text work to the cheaper endpoints
// instead of spending Claude or Codex on it.
//
//   node infer.mjs --provider groq --model llama-3.3-70b-versatile --prompt "…"
//   printf "%s" "$TEXT" | node infer.mjs --provider openrouter --system "Classify…"
//   node infer.mjs --providers          # the catalog rows and whether their key is present
//   node infer.mjs --provider groq --models   # current model ids at that provider
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(HERE, "../../content/openai/providers/catalog.json"), "utf8"));
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k) => args.includes(`--${k}`);

function loadEnv() {
  // .env is read, never printed and never rotated. Walk up from the script to the repository root.
  let dir = HERE;
  for (let i = 0; i < 20; i++) { const p = resolve(dir, ".env"); if (existsSync(p)) { for (const line of readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim(); } return; } const up = dirname(dir); if (up === dir) return; dir = up; }
}
loadEnv();

function row(providerId) {
  const r = catalog.rows.find((x) => x.providerId === providerId);
  if (!r) throw new Error(`unknown provider ${providerId}; see --providers`);
  const family = r.providerFamily ? catalog.rows.find((x) => x.providerId === r.providerFamily) : null;
  return { ...(family ?? {}), ...r };
}
function keyOf(r) {
  const names = [r.apiKeyEnvVar, ...(r.apiKeyEnvVars ?? [])].filter(Boolean);
  for (const n of names) if (process.env[n]) return process.env[n];
  return r.keyed === false ? null : undefined;
}
if (flag("providers")) {
  for (const r of catalog.rows) { const full = row(r.providerId); const k = keyOf(full); process.stdout.write(`${r.providerId.padEnd(34)} ${k === undefined ? "no key" : "keyed "} ${full.chatCompletionsUrl}${full.defaultModelEnvVar && process.env[full.defaultModelEnvVar] ? `  model=${process.env[full.defaultModelEnvVar]}` : ""}\n`); }
  process.exit(0);
}
const providerId = arg("provider") ?? "groq";
const r = row(providerId);
const key = keyOf(r);
if (flag("models")) {
  // GET <base>/models on the OpenAI-compatible surface; prints ids one per line.
  const url = r.chatCompletionsUrl.replace(/\/chat\/completions$/, "/models");
  const res = await fetch(url, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  const j = await res.json().catch(() => ({}));
  for (const m of (j.data ?? j.models ?? [])) process.stdout.write(`${m.id ?? m.name}\n`);
  process.exit(res.ok ? 0 : 1);
}
if (key === undefined) { process.stderr.write(`infer: no API key in the environment for ${providerId} (${[r.apiKeyEnvVar, ...(r.apiKeyEnvVars ?? [])].filter(Boolean).join(", ")})\n`); process.exit(2); }
const model = arg("model") ?? (r.defaultModelEnvVar && process.env[r.defaultModelEnvVar]) ?? r.defaultModel;
if (!model) { process.stderr.write(`infer: --model is required for ${providerId}\n`); process.exit(2); }
const prompt = arg("prompt") ?? readFileSync(0, "utf8");
const messages = [];
if (arg("system")) messages.push({ role: "system", content: arg("system") });
messages.push({ role: "user", content: prompt });
const body = { model, messages, ...(arg("max-tokens") ? { max_tokens: Number(arg("max-tokens")) } : {}), ...(arg("temperature") ? { temperature: Number(arg("temperature")) } : {}) };
if (flag("json-schema")) body.response_format = { type: "json_object" };
const response = await fetch(r.chatCompletionsUrl, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(providerId.startsWith("openrouter") ? { "HTTP-Referer": "https://561.group", "X-Title": "561 Group" } : {}) }, body: JSON.stringify(body) });
const text = await response.text();
if (!response.ok) { process.stderr.write(`infer: ${providerId} ${response.status}: ${text.slice(0, 400)}\n`); process.exit(1); }
let parsed; try { parsed = JSON.parse(text); } catch { process.stdout.write(text); process.exit(0); }
if (flag("json")) { process.stdout.write(JSON.stringify(parsed, null, 2) + "\n"); process.exit(0); }
const content = parsed?.choices?.[0]?.message?.content ?? "";
process.stdout.write(typeof content === "string" ? content : JSON.stringify(content));
process.stdout.write("\n");
