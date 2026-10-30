// Behavioral tests for the JSON data this package ships: the subagent
// roster (content/characters + content/incumbencies) and the harness/
// permission/census policy files the scripts in scripts/ read at runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJSON = (relativePath) => JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
const listJSON = (relativeDir) =>
  readdirSync(join(ROOT, relativeDir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(relativeDir, name));

test("root character.json has the required session fields", () => {
  const character = readJSON("content/character.json");
  assert.equal(typeof character.id, "string");
  assert.equal(typeof character.name, "string");
  assert.equal(character.kind, "session");
  assert.equal(typeof character.disposition, "string");
  assert.ok(character.disposition.length > 0);
});

test("every character record has id, name, kind, and disposition", () => {
  for (const path of listJSON("content/characters")) {
    const character = readJSON(path);
    assert.equal(typeof character.id, "string", `${path} needs an id`);
    assert.equal(typeof character.name, "string", `${path} needs a name`);
    assert.equal(character.kind, "session", `${path} kind should be "session"`);
    assert.equal(typeof character.disposition, "string", `${path} needs a disposition`);
  }
});

test("every incumbency names an office, a holder, and an effective date", () => {
  for (const path of listJSON("content/incumbencies")) {
    const incumbency = readJSON(path);
    assert.equal(typeof incumbency.id, "string", `${path} needs an id`);
    assert.equal(typeof incumbency.office, "string", `${path} needs an office`);
    assert.equal(typeof incumbency.holder, "string", `${path} needs a holder`);
    assert.equal(typeof incumbency.from, "string", `${path} needs a from date`);
    assert.match(incumbency.from, /^\d{4}-\d{2}-\d{2}$/, `${path} from should be YYYY-MM-DD`);
  }
});

test("every incumbency's holder resolves to a character record in this package", () => {
  const characterIds = new Set(listJSON("content/characters").map((path) => readJSON(path).id));
  characterIds.add(readJSON("content/character.json").id);
  for (const path of listJSON("content/incumbencies")) {
    const incumbency = readJSON(path);
    assert.ok(
      characterIds.has(incumbency.holder),
      `${path} holder "${incumbency.holder}" has no matching character record`,
    );
  }
});

test("claude-agent-harness.json is a well-formed ClaudeAgentHarnessProjection", () => {
  const policy = readJSON("content/harness/claude-agent-harness.json");
  assert.equal(policy.type, "ClaudeAgentHarnessProjection");
  assert.match(policy.actor, /^actor:[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof policy.rootOffice, "string");
  assert.ok(Array.isArray(policy.colleagueOffices));
  assert.equal(typeof policy.colleagueSeatings, "object");
  for (const officePath of policy.colleagueOffices) {
    assert.doesNotMatch(officePath, /\/lib\/legacy\//u, "live roster must not use a legacy office as authority");
    const id = officePath.split("/").at(-1).replace(/\.json$/u, "");
    const seating = policy.colleagueSeatings[id];
    assert.ok(seating, `colleagueSeatings is missing an entry for office "${id}"`);
    assert.equal(typeof seating.character, "string");
    assert.equal(typeof seating.incumbency, "string");
  }
  assert.deepEqual(
    Object.keys(policy.colleagueSeatings).sort(),
    policy.colleagueOffices.map((path) => path.split("/").at(-1).replace(/\.json$/u, "")).sort(),
    "colleague seatings must exactly match the admitted current office roster",
  );
  assert.equal(typeof policy.rootSeating.character, "string");
  assert.equal(typeof policy.rootSeating.incumbency, "string");
});

test("claude-permission-policy.json is a well-formed ClaudePermissionProjection", () => {
  const policy = readJSON("content/harness/claude-permission-policy.json");
  assert.equal(policy.type, "ClaudePermissionProjection");
  assert.match(policy.actor, /^actor:[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof policy.defaultMode, "string");
  assert.ok(Array.isArray(policy.allow));
});

test("claude-lifecycle-hook-policy.json names bounded declarative handlers without executable content", () => {
  const policy = readJSON("content/harness/claude-lifecycle-hook-policy.json");
  assert.equal(policy.type, "ClaudeLifecycleHookProjection");
  assert.equal(policy.actor, readJSON("content/harness/claude-agent-harness.json").actor);
  assert.equal(policy.owner, "bare-cedar-fog-claude");
  assert.ok(Array.isArray(policy.handlers) && policy.handlers.length === 16);
  for (const handler of policy.handlers) {
    assert.match(handler.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"].includes(handler.event));
    assert.ok(Number.isInteger(handler.timeout) && handler.timeout <= 30);
    assert.equal("command" in handler, false);
    assert.equal("args" in handler, false);
  }
});

test("package.json bin declares admit-set-of-health-work-intents (a CLI, per its own --help/argv entrypoint)", () => {
  const packageManifest = readJSON("package.json");
  assert.equal(packageManifest.bin?.["admit-set-of-health-work-intents"], "./scripts/admit-set-of-health-work-intents.mjs");
  const source = readFileSync(join(ROOT, "scripts/admit-set-of-health-work-intents.mjs"), "utf8");
  assert.match(source, /^#!\/usr\/bin\/env node/u, "the bin target must carry a shebang");
});

test("package consumes the canonical harness projection service by exact registry pin", () => {
  const packageManifest = readJSON("package.json");
  const dependency = packageManifest.dependencies?.["@red-cup-engineering/claude-harness-projection-service"];
  assert.equal(typeof dependency, "string");
  assert.match(dependency, /^\d+\.\d+\.\d+$/u);
});

test("census-targets.json lists targets with an id, path, and command", () => {
  const { targets } = readJSON("content/harness/census-targets.json");
  assert.ok(Array.isArray(targets) && targets.length > 0);
  for (const target of targets) {
    assert.equal(typeof target.id, "string");
    assert.equal(typeof target.path, "string");
    assert.ok(Array.isArray(target.command) && target.command.length > 0);
  }
});

test("Claude Code A2A unit targets the live inference service tree", () => {
  const unit = readFileSync(join(ROOT, "data/records/systemd/claude-code-inference-a2a.service"), "utf8");
  const serviceRoot = "/home/emsenn/info/lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-inference-system-services-section/services/llm-services-section/services/anthropic-services-section/services/claude-services-section/services/claude-code-services-section";
  assert.match(unit, new RegExp(`^WorkingDirectory=${serviceRoot}$`, "m"));
  assert.match(unit, new RegExp(`^Environment=CLAUDE_CODE_BIN=${serviceRoot}/src/claude-via-private-relay\\.mjs$`, "m"));
  assert.match(unit, new RegExp(`^Environment=AGENT_CARD_SIGNING_KEY=${serviceRoot}/data/agent-card-signing/ed25519-private\\.pem$`, "m"));
  assert.match(unit, new RegExp(`^Environment=AGENT_CARD_JWKS=${serviceRoot}/content/agent-card-signing/jwks\\.json$`, "m"));
  assert.match(unit, new RegExp(`^ExecStart=/usr/bin/node ${serviceRoot}/scripts/serve-a2a\\.mjs$`, "m"));
  assert.doesNotMatch(unit, /%h\/services\/inference-services-section/u);
  assert.doesNotMatch(unit, /\/bin\/serve-a2a\.mjs/u);
});
