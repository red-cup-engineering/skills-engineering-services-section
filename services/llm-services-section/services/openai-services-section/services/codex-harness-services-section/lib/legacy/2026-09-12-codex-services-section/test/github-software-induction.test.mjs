import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createGithubSoftwareInductionCarrier, githubSoftwareInductionReadiness } from "../src/github-software-induction.mjs";

const configured = Object.freeze({
  ACTIVITYPUB_ORIGIN: "https://sender.example",
  ACTIVITYPUB_IDENTIFIER: "sender",
  ACTIVITYPUB_KEYS_PATH: "/private/key.json",
  ACTIVITYPUB_A2A_AGENT_CARD: "https://sender.example/card.json",
  GITHUB_SOFTWARE_INDUCTION_ACTIVITYPUB_ACTOR: "https://provider.example/actor",
  GITHUB_SOFTWARE_INDUCTION_ACTIVITYPUB_INBOX: "https://provider.example/inbox",
});

test("readiness reveals only configured names, never configuration values", () => {
  const readiness = githubSoftwareInductionReadiness({ environment: { ...configured, ACTIVITYPUB_IDENTIFIER: "private-identifier" } });
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.sender.missing, []);
  assert.equal(JSON.stringify(readiness).includes("private-identifier"), false);
  assert.equal(JSON.stringify(readiness).includes("/private/key.json"), false);
  const incomplete = githubSoftwareInductionReadiness({ environment: { ACTIVITYPUB_ORIGIN: configured.ACTIVITYPUB_ORIGIN } });
  assert.deepEqual(incomplete.sender.present, ["ACTIVITYPUB_ORIGIN"]);
  assert.ok(incomplete.provider.missing.includes("GITHUB_SOFTWARE_INDUCTION_ACTIVITYPUB_INBOX"));
});

test("submission fails closed before loading or delivering without exact confirmation and complete identity", async () => {
  let loaded = 0, delivered = 0;
  const loader = async () => { loaded += 1; return { induceGithubSoftwareProposal: async (_, options) => options.deliver({}) }; };
  const deliver = async () => { delivered += 1; return { accepted: true }; };
  const carrier = createGithubSoftwareInductionCarrier({ environment: configured, loader, deliver });
  await assert.rejects(carrier.submit({ proposal: {}, confirmExternalMutation: false }), /confirmExternalMutation: true/u);
  assert.equal(loaded, 0); assert.equal(delivered, 0);
  const incomplete = createGithubSoftwareInductionCarrier({ environment: { ...configured, ACTIVITYPUB_KEYS_PATH: "" }, loader, deliver });
  await assert.rejects(incomplete.submit({ proposal: {}, confirmExternalMutation: true }), /ACTIVITYPUB_KEYS_PATH/u);
  assert.equal(loaded, 0); assert.equal(delivered, 0);
});

test("confirmed complete submission delegates exactly once through injected sovereign loader and deliverer", async () => {
  let loaded = 0, delivered = 0, received;
  const deliver = async () => { delivered += 1; return { accepted: true }; };
  const carrier = createGithubSoftwareInductionCarrier({
    environment: configured,
    loader: async () => ({ induceGithubSoftwareProposal: async (proposal, options) => { loaded += 1; received = { proposal, options }; return options.deliver({}); } }),
    deliver,
  });
  assert.deepEqual(await carrier.submit({ proposal: { change: "small" }, confirmExternalMutation: true }), { accepted: true });
  assert.equal(loaded, 1); assert.equal(delivered, 1);
  assert.deepEqual(received.proposal, { change: "small" });
  assert.equal(received.options.deliver, deliver);
});

test("enterprise MCP advertises readiness and rejects unconfirmed submission without a delivery", () => {
  const server = new URL("../src/mcp-server.mjs", import.meta.url);
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "observe_github_software_induction_readiness", arguments: {} } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "github_software_induction", arguments: { proposal: {}, confirmExternalMutation: false } } },
  ];
  const run = spawnSync(process.execPath, [server.pathname], { input: `${requests.map(JSON.stringify).join("\n")}\n`, encoding: "utf8", env: { ...process.env, ...configured } });
  assert.equal(run.status, 0, run.stderr);
  const replies = run.stdout.trim().split("\n").map(JSON.parse);
  assert.ok(replies[0].result.tools.some(({ name }) => name === "observe_github_software_induction_readiness"));
  assert.equal(replies[1].result.structuredContent.ready, true);
  assert.match(replies[2].error.message, /confirmExternalMutation: true/u);
});
