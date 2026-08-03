import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createAuthorityBoundedIntegration } from "../src/client.mjs";

const ACTOR = "urn:ame:test-actor";
const CUSTOMER = "urn:leader:test-customer";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function identity(value) { return `urn:sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function byteDigest(bytes) { return `urn:sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function inertPlan(actor, demand) {
  const body = { type: "RequirementBoundActuationPlanK", version: 1, actor, demand, mutationAuthorized: false, acceptanceAuthorized: false, conveys: [] };
  return Object.freeze({ id: identity(body), ...body });
}

function scenario(client, workspaceRoot, { path = ".claude/agents/test-office.md", content = "hello\n" } = {}) {
  mkdirSync(join(workspaceRoot, ".claude/agents"), { recursive: true });
  const demand = "seat test-office as a colleague";
  const plan = inertPlan(client.actor, demand);
  const intent = client.mutationIntent({ demand, plan: plan.id, path, afterContent: content, sourceProviderReceipts: ["urn:sha256:" + "0".repeat(64)] });
  const now = new Date();
  const authority = client.leaderAuthority({
    demand, plan: plan.id,
    sourceDigest: byteDigest(Buffer.from(demand)), transportReceipt: "urn:test:transport",
    issuedAt: new Date(now.getTime() - 1000).toISOString(),
    scope: [{ path, operation: "write-file", beforeDigest: intent.beforeDigest, afterDigest: intent.afterDigest }],
  });
  return { demand, plan, intent, authority, workspaceRoot };
}

function makeClient() {
  return createAuthorityBoundedIntegration({ actor: ACTOR, customer: CUSTOMER, identity, byteDigest, defaultStateRoot: mkdtempSync(join(tmpdir(), "abi-state-")) });
}

test("createAuthorityBoundedIntegration requires actor, customer, identity, byteDigest, and defaultStateRoot", () => {
  assert.throws(() => createAuthorityBoundedIntegration({}), /actor/);
  assert.throws(() => createAuthorityBoundedIntegration({ actor: ACTOR }), /customer/);
  assert.throws(() => createAuthorityBoundedIntegration({ actor: ACTOR, customer: CUSTOMER }), /identity/);
  assert.throws(() => createAuthorityBoundedIntegration({ actor: ACTOR, customer: CUSTOMER, identity }), /byteDigest/);
});

test("record types stay actor-neutral so two actors' outputs are structurally comparable", () => {
  const client = makeClient();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "abi-ws-"));
  try {
    const { intent } = scenario(client, workspaceRoot);
    assert.equal(intent.type, "MutationIntentK");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("a valid single-use authority materializes exactly the authorized bytes", () => {
  const client = makeClient();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "abi-ws-"));
  const claimsRoot = join(workspaceRoot, ".claims");
  try {
    const { demand, plan, intent, authority } = scenario(client, workspaceRoot);
    const result = client.executeAuthorityBoundIntegration(
      { actor: ACTOR, demand, actuationPlan: plan, intent, authority, nativeResourceReceipt: "urn:test:native-resource" },
      { workspaceRoot, claimsRoot },
    );
    assert.equal(result.type, "CandidatePatchK");
    assert.equal(readFileSync(join(workspaceRoot, ".claude/agents/test-office.md"), "utf8"), "hello\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("replaying the same authority is refused, not silently re-applied", () => {
  const client = makeClient();
  const first = mkdtempSync(join(tmpdir(), "abi-ws-"));
  const second = mkdtempSync(join(tmpdir(), "abi-ws-"));
  const claimsRoot = mkdtempSync(join(tmpdir(), "abi-claims-"));
  try {
    const scenarioA = scenario(client, first);
    mkdirSync(join(second, ".claude/agents"), { recursive: true });
    const input = (workspaceRoot, { demand, plan, intent, authority }) => ({ actor: ACTOR, demand, actuationPlan: plan, intent, authority, nativeResourceReceipt: "urn:test:native-resource", workspaceRoot });
    client.executeAuthorityBoundIntegration(input(first, scenarioA), { workspaceRoot: first, claimsRoot });
    assert.throws(() => client.executeAuthorityBoundIntegration(input(second, scenarioA), { workspaceRoot: second, claimsRoot }), /already been consumed/);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
    rmSync(claimsRoot, { recursive: true, force: true });
  }
});

test("a target path escaping the workspace is refused before any write", () => {
  const client = makeClient();
  assert.throws(() => client.mutationIntent({ demand: "x", plan: "urn:sha256:" + "0".repeat(64), path: "../outside.md", afterContent: "x" }), /normalized workspace-relative path/);
});

test("an authority scope that does not bind the exact mutation bytes is refused", () => {
  const client = makeClient();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "abi-ws-"));
  const claimsRoot = join(workspaceRoot, ".claims");
  try {
    const { demand, plan, intent, authority } = scenario(client, workspaceRoot);
    const tamperedIntent = client.mutationIntent({ demand, plan: plan.id, path: intent.path, afterContent: "different bytes\n", sourceProviderReceipts: ["urn:sha256:" + "0".repeat(64)] });
    assert.throws(
      () => client.executeAuthorityBoundIntegration({ actor: ACTOR, demand, actuationPlan: plan, intent: tamperedIntent, authority, nativeResourceReceipt: "urn:test:native-resource" }, { workspaceRoot, claimsRoot }),
      /authority scope does not bind the exact mutation bytes/,
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("two different actors produce independently namespaced offer identifiers", () => {
  const otherClient = createAuthorityBoundedIntegration({ actor: "urn:ame:other-actor", customer: CUSTOMER, identity, byteDigest, defaultStateRoot: mkdtempSync(join(tmpdir(), "abi-state-")) });
  const client = makeClient();
  const wsA = mkdtempSync(join(tmpdir(), "abi-ws-"));
  const wsB = mkdtempSync(join(tmpdir(), "abi-ws-"));
  try {
    const a = scenario(client, wsA);
    const b = scenario(otherClient, wsB);
    const resultA = client.executeAuthorityBoundIntegration({ actor: client.actor, demand: a.demand, actuationPlan: a.plan, intent: a.intent, authority: a.authority, nativeResourceReceipt: "urn:test:native-resource" }, { workspaceRoot: wsA, claimsRoot: join(wsA, ".claims") });
    const resultB = otherClient.executeAuthorityBoundIntegration({ actor: otherClient.actor, demand: b.demand, actuationPlan: b.plan, intent: b.intent, authority: b.authority, nativeResourceReceipt: "urn:test:native-resource" }, { workspaceRoot: wsB, claimsRoot: join(wsB, ".claims") });
    assert.equal(resultA.offer, "urn:offer:test-actor-authority-bounded-integration");
    assert.equal(resultB.offer, "urn:offer:other-actor-authority-bounded-integration");
  } finally {
    rmSync(wsA, { recursive: true, force: true });
    rmSync(wsB, { recursive: true, force: true });
  }
});
