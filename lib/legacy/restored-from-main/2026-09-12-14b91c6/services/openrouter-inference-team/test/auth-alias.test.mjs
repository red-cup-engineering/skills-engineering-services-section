import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const root = resolve(import.meta.dirname, ".."); const aliases = ["OPENROUTER_API_KEY", "API_KEY_OPENROUTER"];
function invoke(extra = {}) { const env = { ...process.env, ...extra }; for (const key of aliases) if (!(key in extra)) delete env[key]; const dir = mkdtempSync(join(tmpdir(), "openrouter-alias-test-")); const packet = join(dir, "packet.json"); writeFileSync(packet, JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "dry run" }] })); try { return spawnSync(process.execPath, [join(root, "run-one-exchange.mjs"), packet, "--dry-run"], { encoding: "utf8", env }); } finally { rmSync(dir, { recursive: true, force: true }); } }
test("OpenRouter recognizes custody aliases in dry-run without network or secret output", () => { const none = invoke(); assert.equal(none.status, 0); assert.deepEqual(JSON.parse(none.stdout)["auth-presence"], Object.fromEntries(aliases.map((key) => [key, false]))); for (const alias of aliases) { const result = invoke({ [alias]: "test-only" }); assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout)["auth-presence"][alias], true); assert.equal(result.stdout.includes("test-only"), false); } });
