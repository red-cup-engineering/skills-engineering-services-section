import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertCapabilityDiscoveryBoundary, assertHarnessIdentityBoundary, assertMcpReachability, assertMcpServerBoundary, assertReceiverBootstrapBoundary, checkGlobalEngineeringMethod, checkInstalledHarnessStatic, installGlobalEngineeringMethod, installHarness, loadPolicy, renderConfig, renderGlobalEngineeringMethod, renderRootInstructions } from "../scripts/project-codex-agent-harness.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function isRepoRootDirectory(dir) {
  return existsSync(join(dir, ".git")) && existsSync(join(dir, "lib/emsenn"));
}
function repositoryRootFromPackage() {
  let current = PACKAGE_ROOT;
  while (true) {
    if (isRepoRootDirectory(current) && existsSync(join(current, "lib/emsenn"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("cannot resolve enclosing git repository root with lib/emsenn");
    current = parent;
  }
}
const REPO_ROOT = repositoryRootFromPackage();

/**
 * Reads the authored harness policy directly off disk, independent of
 * `loadPolicy()`'s own parsing, so tests can assert the loaded/projected
 * form matches its source rather than a literal copied into the test.
 * @returns {object}
 */
function loadPolicySource() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "agents/harness/codex-agent-harness.json"), "utf8"));
}

test("Bare Cedar Fog Codex parameterizes the shared behavioral law", () => {
  const source = loadPolicySource();
  const policy = loadPolicy();
  assert.equal(Object.hasOwn(source, "conversationStyle"), false);
  assert.equal(Object.hasOwn(source, "repositoryMaturity"), false);
  assert.match(renderRootInstructions(REPO_ROOT, policy), /MetroPlat is the MARSH user interface/u);
  assert.match(renderRootInstructions(REPO_ROOT, policy), /shared executable ontology/u);
});

/**
 * Escapes regular-expression metacharacters in a string for embedding in a
 * dynamically built `RegExp` (house pattern shared with tool-evidence.test.mjs).
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("the default harness projects only the JavaScript code-analysis tool", () => {
  const policy = loadPolicy();
  assert.equal(policy.features.hooks, true);
  assert.deepEqual(policy.operationRoots, []);
  assert.equal(policy.mcpServers["jsnode-package-survey"].url, "http://127.0.0.1:18808/mcp");
  const config = renderConfig(REPO_ROOT, policy, "/exact/node");
  assert.match(config, /\[mcp_servers\."jsnode-package-survey"\]/u);
  assert.doesNotMatch(config, /\[mcp_servers\.(metroplat|ops_561_group|planning_engine|info_markdown)\]/u);
});

test("removed provider-agent sources are not projected", () => {
  const target = mkdtempSync(join(tmpdir(), "bare-cedar-fog-node-provider-"));
  try {
    installHarness({ repoRoot: REPO_ROOT, target });
    assert.equal(existsSync(join(target, ".codex/agents/node-programming.toml")), false);
    assert.equal(existsSync(join(target, ".codex/agents/guile-programming.toml")), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("global engineering method uses one managed block without replacing user text", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "codex-home-"));
  const project = mkdtempSync(join(tmpdir(), "independent-project-"));
  try {
    writeFileSync(join(codexHome, "AGENTS.md"), "# Personal instructions\n\nKeep this text.\n");
    const installed = installGlobalEngineeringMethod({ codexHome });
    assert.equal(installed.disposition, "global-engineering-method-installed");
    const once = readFileSync(join(codexHome, "AGENTS.md"), "utf8");
    assert.match(once, /# Personal instructions[\s\S]*Keep this text\./u);
    assert.match(once, /BEGIN Bare Cedar Fog managed engineering method[\s\S]*# Engineering working agreements/u);
    assert.equal(once.includes("node-programming"), false);
    installGlobalEngineeringMethod({ codexHome });
    assert.equal(readFileSync(join(codexHome, "AGENTS.md"), "utf8"), once);
    assert.equal(checkGlobalEngineeringMethod({ codexHome }).disposition, "global-engineering-method-current");
    assert.equal(existsSync(join(project, "AGENTS.md")), false);
    assert.match(readFileSync(join(codexHome, "AGENTS.md"), "utf8"), /Apply these to coding work in any project\./u);
    assert.equal(renderGlobalEngineeringMethod().includes("# Engineering working agreements"), true);
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test("a nonempty global override reports that it masks the managed method", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "codex-home-override-"));
  try {
    writeFileSync(join(codexHome, "AGENTS.override.md"), "# Override\n");
    assert.throws(() => installGlobalEngineeringMethod({ codexHome }), /nonempty override masks/u);
    assert.throws(() => checkGlobalEngineeringMethod({ codexHome }), /nonempty override masks/u);
    assert.equal(existsSync(join(codexHome, "AGENTS.md")), false);
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("capability discovery requires the projected JSNode tools", () => {
  const policy = loadPolicy();
  assert.doesNotThrow(() => assertCapabilityDiscoveryBoundary(policy));
  assert.throws(
    () => assertCapabilityDiscoveryBoundary({
      ...policy,
      mcpServers: {
        ...policy.mcpServers,
        "jsnode-package-survey": { ...policy.mcpServers["jsnode-package-survey"], enabledTools: ["jsnode_search"] },
      },
    }),
    /missing tools: jsnode_package/u,
  );
});

test("the projected harness starts in emergency architectural standardization mode", () => {
  const policy = loadPolicy();
  const instructions = renderRootInstructions(REPO_ROOT, policy);
  assert.ok(instructions.startsWith(`<!-- Generated by project-codex-agent-harness.mjs from codex-agent-harness.json. -->\n# Codex\n\n${policy.seating.promptRule}\n`));
  assert.match(instructions, /## Emergency architectural standardization/u);
  assert.match(instructions, /task backlog is growing faster than this system discharges it/u);
  assert.match(instructions, /Complete coherent replacement cuts through real consumers and delete the superseded mechanics/u);
  assert.doesNotMatch(instructions, /Chief Executive Officer of the Board of Directors|Executive Assistant to the Leader Movement Team|PrincipalSession authorization/u);
  assert.match(instructions, /## Operating boundary/u);
  assert.doesNotMatch(instructions, /named default\/current instruction seating|Harness custody:|Authored policy:|Generic projection service:/u);
  assert.match(instructions, /## Start the work/u);
  assert.match(instructions, /Select only skills needed for the request/u);
  assert.doesNotMatch(instructions, /Semantic duplication work|jsnode_duplication/u);
  assert.match(instructions, /\.agents\/skills\/improve-skills-before-work\/SKILL\.md/u);
});

test("the generated runtime has a bounded approval and sandbox policy", () => {
  const policy = loadPolicy();
  const config = renderConfig(REPO_ROOT, policy, "/exact/node");
  assert.match(config, /^approval_policy = "on-request"$/mu);
  assert.match(config, /^sandbox_mode = "workspace-write"$/mu);
  assert.doesNotMatch(config, /danger-full-access|config_file =/u);
});

test("the root conversation style handles frustration, routine updates, and real boundaries in plain English", () => {
  const instructions = renderRootInstructions(REPO_ROOT, loadPolicy());
  assert.match(instructions, /## How I talk/u);
  assert.match(instructions, /Lead with the practical result/u);
  assert.match(instructions, /When corrected, acknowledge the specific mistake briefly/u);
  assert.match(instructions, /Ask only for information or a decision that materially affects the outcome/u);
  assert.match(instructions, /not rushed guesses or bypassed safety, data, credential, or external-effect boundaries/u);
});

test("Codex startup routes to the global engineering method without inlining its table", () => {
  const instructions = renderRootInstructions(REPO_ROOT, loadPolicy());
  assert.match(instructions, /Use the portable Engineering method already loaded from global `CODEX_HOME\/AGENTS\.md`/u);
  assert.match(instructions, /agent-root-instructions-projection-service\/content\/engineering-method\.md/u);
  assert.doesNotMatch(instructions, /# Engineering working agreements/u);
});

test("the projected identity is pinned to its actor, seating, machine, surface, and source custody", () => {
  const policy = loadPolicy();
  assert.doesNotThrow(() => assertHarnessIdentityBoundary(policy, REPO_ROOT));
  assert.throws(
    () => assertHarnessIdentityBoundary({ ...policy, runtime: { ...policy.runtime, surface: "Claude" } }, REPO_ROOT),
    /bare-cedar-fog\/Codex machine and surface/u,
  );
  assert.throws(
    () => assertHarnessIdentityBoundary({ ...policy, harnessCustody: { ...policy.harnessCustody, skillSourceRoot: ".agents/skills" } }, REPO_ROOT),
    /canonical authored sources/u,
  );
  assert.throws(
    () => assertHarnessIdentityBoundary({ ...policy, harnessCustody: { ...policy.harnessCustody, runtimeProjections: [...policy.harnessCustody.runtimeProjections, ".codex/skills"] } }, REPO_ROOT),
    /canonical runtime projections/u,
  );
});

test("every projected program has an existing executive-receiver skill-improvement bootstrap", () => {
  const policy = loadPolicy();
  assert.doesNotThrow(() => assertReceiverBootstrapBoundary(policy, REPO_ROOT));
  assert.throws(
    () => assertReceiverBootstrapBoundary({ ...policy, receiverBootstrapSkill: undefined }, REPO_ROOT),
    /requires an existing executive-receiver bootstrap skill/u,
  );
  assert.throws(
    () => assertReceiverBootstrapBoundary({ ...policy, receiverBootstrapSkill: ".claude/skills/missing/SKILL.md" }, REPO_ROOT),
    /requires an existing executive-receiver bootstrap skill/u,
  );
});

test("a clean node receives custom instructions and the Codex runtime configuration", () => {
  const target = mkdtempSync(join(tmpdir(), "bare-cedar-fog-codex-harness-"));
  try {
    const result = installHarness({ repoRoot: REPO_ROOT, target });
    assert.equal(result.actor, loadPolicy().actor);
    assert.deepEqual(result.colleagues, []);
    assert.equal(readFileSync(join(target, "AGENTS.md"), "utf8"), renderRootInstructions(REPO_ROOT, loadPolicy()));
    assert.equal(existsSync(join(target, ".agents/skills/review-561-group-javascript-package/SKILL.md")), true);
    assert.equal(existsSync(join(target, ".agents/skills/improve-skills-before-work/SKILL.md")), true);
    assert.doesNotMatch(readFileSync(join(target, ".agents/skills/improve-skills-before-work/SKILL.md"), "utf8"), /\.claude\/skills\//u);
    assert.equal(existsSync(join(target, ".agents/rules/working-discipline.md")), true);
    assert.equal(existsSync(join(target, ".agents/skills/project-jsnode-operation-package/SKILL.md")), false);
    assert.equal(existsSync(join(target, ".codex/skills")), false);
    const config = readFileSync(join(target, ".codex/config.toml"), "utf8");
    assert.doesNotMatch(config, /^model_reasoning_effort\s*=/mu);
    assert.match(config, /max_threads = 2/u);
    assert.match(config, /multi_agent = true/u);
    assert.match(config, /hooks = true/u);
    assert.doesNotMatch(config, /config_file =/u);
    assert.doesNotMatch(config, /default_subagent_model|max_concurrent_threads_per_session/u);
    assert.equal(existsSync(join(target, ".codex/agents/executive-officer-to-the-leader.toml")), false);
    assert.equal(checkInstalledHarnessStatic({ repoRoot: REPO_ROOT, target }).disposition, "static-projection-current");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("a clean projected instruction preserves the shared-owner replacement discipline", () => {
  const target = mkdtempSync(join(tmpdir(), "bare-cedar-fog-codex-shared-owner-precondition-"));
  try {
    // This invariant belongs to the root-instruction renderer.  Calling the
    // full installer here also copies every projected skill and office into
    // the scratch node, turning this focused assertion into an unbounded
    // whole-harness integration run.
    writeFileSync(join(target, "AGENTS.md"), renderRootInstructions(REPO_ROOT, loadPolicy()));
    const instructions = readFileSync(join(target, "AGENTS.md"), "utf8");
    assert.match(instructions, /Preserve intended capabilities and user data, not accumulated implementation drift/u);
    assert.match(instructions, /Before selecting a repair, state briefly what capability the user intends/u);
    assert.match(instructions, /migrate real consumers, and delete competing implementations/u);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("the harness removes retired planning and knowledge MCP aliases", () => {
  const target = mkdtempSync(join(tmpdir(), "bare-cedar-fog-codex-markdown-alias-"));
  try {
    mkdirSync(join(target, ".codex"), { recursive: true });
    writeFileSync(join(target, ".codex/config.toml"), "[mcp_servers.markdown-vault]\ncommand = \"node\"\nargs = [\"stale-markdown-vault.mjs\"]\n");
    installHarness({ repoRoot: REPO_ROOT, target });
    const config = readFileSync(join(target, ".codex/config.toml"), "utf8");
    assert.doesNotMatch(config, /^\[mcp_servers\.markdown-vault\]$/mu);
    assert.doesNotMatch(config, /^\[mcp_servers\.info_markdown\]$/mu);
    assert.match(config, /^\[mcp_servers\.jsnode-package-survey\]$/mu);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("the harness replaces its managed output while preserving unowned Codex extensions", () => {
  const target = mkdtempSync(join(tmpdir(), "bare-cedar-fog-codex-stale-output-"));
  try {
    writeFileSync(join(target, "AGENTS.md"), "<!-- Generated by project-codex-agent-harness.mjs from codex-agent-harness.json. -->\nold\n");
    mkdirSync(join(target, ".agents/skills/orphan"), { recursive: true });
    writeFileSync(join(target, ".agents/skills/orphan/SKILL.md"), "old\n");
    mkdirSync(join(target, ".agents/skills/unowned"), { recursive: true });
    writeFileSync(join(target, ".agents/skills/unowned/SKILL.md"), "keep\n");
    mkdirSync(join(target, ".codex/agents"), { recursive: true });
    writeFileSync(join(target, ".codex/agents/old.toml"), "name = \"old\"\n");
    writeFileSync(join(target, ".codex/agents/unowned.toml"), "name = \"unowned\"\n");
    mkdirSync(join(target, ".codex"), { recursive: true });
    writeFileSync(join(target, ".codex/.codex-agent-manifest"), "old\nskill:orphan\n");
    installHarness({ repoRoot: REPO_ROOT, target });
    assert.equal(readFileSync(join(target, "AGENTS.md"), "utf8"), renderRootInstructions(REPO_ROOT, loadPolicy()));
    assert.equal(existsSync(join(target, ".agents/skills/orphan")), false);
    assert.equal(readFileSync(join(target, ".agents/skills/unowned/SKILL.md"), "utf8"), "keep\n");
    assert.equal(existsSync(join(target, ".agents/skills/review-561-group-javascript-package/SKILL.md")), true);
    assert.equal(existsSync(join(target, ".codex/agents/old.toml")), false);
    assert.equal(readFileSync(join(target, ".codex/agents/unowned.toml"), "utf8"), "name = \"unowned\"\n");
    assert.equal(existsSync(join(target, ".codex/agents/executive-officer-to-the-leader.toml")), false);
    assert.equal(existsSync(join(target, ".codex/config.toml")), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("the harness refuses an enabled MCP boundary that does not advertise its promised tool", () => {
  const root = mkdtempSync(join(tmpdir(), "bare-cedar-fog-codex-dead-mcp-"));
  try {
    writeFileSync(join(root, "dead.mjs"), `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\\n'));\n`);
    assert.throws(() => assertMcpReachability(root, {
      mcpServers: {
        dead: { enabled: true, script: "dead.mjs", cwd: ".", startupTimeoutSeconds: 1, enabledTools: ["promised_tool"] },
      },
    }), /does not advertise enabled tools: promised_tool/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("live MCP reachability preserves server-specific arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "bare-cedar-fog-codex-argument-mcp-"));
  try {
    writeFileSync(join(root, "argument.mjs"), `if (process.argv.slice(2).join(" ") !== "--actor codex --actor-urn urn:ame:bare-cedar-fog-codex") process.exit(9);
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"observe_actor"}]}}\\n'));
`);
    assert.doesNotThrow(() => assertMcpReachability(root, {
      mcpServers: {
        argument: {
          enabled: true,
          script: "argument.mjs",
          arguments: ["--actor", "codex", "--actor-urn", "urn:ame:bare-cedar-fog-codex"],
          cwd: ".",
          startupTimeoutSeconds: 1,
          enabledTools: ["observe_actor"],
        },
      },
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an external stdio command projects and reaches the same launch without Node overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "bare-cedar-fog-external-mcp-"));
  try {
    const source = `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"remote_tool"}]}}\\n'));`;
    const server = { enabled: true, command: process.execPath, arguments: ["-e", source], cwd: ".", startupTimeoutSeconds: 1, enabledTools: ["remote_tool"] };
    assert.doesNotThrow(() => assertMcpServerBoundary("external", server));
    assert.doesNotThrow(() => assertMcpReachability(root, { mcpServers: { external: server } }));
    const config = renderConfig(root, { colleagueOffices: [], features: {}, agents: { enabled: true, maximumConcurrentThreadsPerSession: 1, interruptMessage: true }, mcpServers: { external: server } }, "/not/the/external-command");
    assert.match(config, new RegExp(`^command = ${escapeRegExp(JSON.stringify(process.execPath))}$`, "mu"));
    assert.match(config, new RegExp(`^args = \\[${server.arguments.map((argument) => escapeRegExp(JSON.stringify(argument))).join(", ")}\\]$`, "mu"));
    assert.doesNotMatch(config, /not\/the\/external-command/u);
    assert.throws(() => assertMcpServerBoundary("ambiguous", { ...server, script: "local.mjs" }), /incomplete or ambiguous/u);
    assert.throws(() => assertMcpServerBoundary("external-package", { ...server, package: "leftover" }), /incomplete or ambiguous/u);
    assert.throws(() => assertMcpServerBoundary("external-env-file", { ...server, envFile: "/tmp/operator.env" }), /unsupported .* env-file/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("root instructions deliver the authored default duty and the projected discovery route", () => {
  const policy = loadPolicy();
  const instructions = renderRootInstructions(REPO_ROOT, policy);
  assert.ok(instructions.includes(policy.perTurnDuty.default));
  assert.match(instructions, /javascript-package-or-dependent-detail: `jsnode-package-survey`/u);
  assert.doesNotMatch(instructions, /organizational-work-or-roadmap|house-term-or-capability/u);
  const changedDuty = "Consult the current work record before choosing the next task.";
  assert.ok(renderRootInstructions(REPO_ROOT, { ...policy, perTurnDuty: { default: changedDuty } }).includes(changedDuty));
  assert.match(instructions, /keep work tied to the user's stated outcome/u);
  assert.match(instructions, /Select only skills needed for the request/u);
  assert.doesNotMatch(instructions, /Before substantive organizational conclusions or work/u);
  assert.match(instructions, /Select only skills needed for the request/u);
  assert.doesNotMatch(instructions, /and completes one batched skill-improvement/u);
});

test("the JSNode route rejects unavailable tools and missing duty", () => {
  const policy = loadPolicy();
  for (const change of [{ enabled: false }, { enabledTools: [] }]) {
    assert.throws(() => assertCapabilityDiscoveryBoundary({
      ...policy,
      mcpServers: { ...policy.mcpServers, "jsnode-package-survey": { ...policy.mcpServers["jsnode-package-survey"], ...change } },
    }), /requires .* at startup|missing tools/u);
  }
  for (const perTurnDuty of [undefined, {}, { default: " " }]) {
    assert.throws(() => renderRootInstructions(REPO_ROOT, { ...policy, perTurnDuty }), /default per-turn duty/u);
  }
});
