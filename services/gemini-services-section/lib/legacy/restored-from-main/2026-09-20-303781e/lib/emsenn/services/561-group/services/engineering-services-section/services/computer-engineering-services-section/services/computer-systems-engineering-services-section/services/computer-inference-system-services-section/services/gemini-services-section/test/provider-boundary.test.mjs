import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const card = JSON.parse(readFileSync(new URL("content/agent-cards/gemini-inference-team.json", root), "utf8"));
const service = readFileSync(new URL("content/deployment/systemd-user/cold-red-gate/gemini-inference-a2a.service", root), "utf8");

function serviceValue(key) {
  return service.split(/\r?\n/u).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
}

function environmentValue(key) {
  const prefix = `Environment=${key}=`;
  return service.split(/\r?\n/u).find((line) => line.startsWith(prefix))?.slice(prefix.length);
}

test("Gemini has one semantic operation identical to its signed A2A skill", () => {
  assert.deepEqual(card.skills.map((skill) => skill.id), ["execute-typed-gemini-inference"]);
  assert.equal(manifest.bin["execute-rmn-inference"], "./src/execute-rmn-inference.mjs");
  assert.equal(manifest.bin["serve-inference-a2a"], "./scripts/serve-a2a.mjs");
  assert.equal("solicit-rmn-inference" in manifest.bin, false);
});

test("the release excludes historical exchanges and nested service trees", () => {
  assert.deepEqual(manifest.files, [
    "README.md",
    "scripts/",
    "src/",
    "content/agent-card-signing/",
    "content/agent-cards/",
    "content/deployment/",
    "content/evm/accounts/",
  ]);
  assert.equal(manifest.files.some((path) => path.includes("exchanges") || path.startsWith("services/")), false);
});

test("Cold Red Gate deployment selects the canonical release and state roots", () => {
  const releaseRoot = "%h/.local/share/561-group/releases/gemini-inference-team/current";
  assert.equal(serviceValue("WorkingDirectory"), releaseRoot);
  assert.equal(serviceValue("ExecStart"), "/usr/bin/node scripts/serve-a2a.mjs");
  assert.equal(environmentValue("BASE_URL"), "http://127.0.0.1:8790");
  assert.equal(environmentValue("AGENT_CARD_SIGNING_KEY"), "%h/.config/561-group/agent-card-signing/gemini-inference-team-ed25519-private.pem");
  assert.equal(environmentValue("AGENT_CARD_JWKS"), `${releaseRoot}/content/agent-card-signing/jwks.json`);
  assert.equal(environmentValue("GEMINI_WITNESS_JOURNAL_ROOT"), "%h/.local/state/561-group/gemini-inference-team");
  assert.doesNotMatch(service, /Requires=.*(?:rmn-semantic-conformance|rwil-rdf-services)/u);
});
