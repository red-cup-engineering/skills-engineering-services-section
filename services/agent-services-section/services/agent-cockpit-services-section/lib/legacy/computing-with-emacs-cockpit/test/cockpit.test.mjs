// Tests for @emsenn/computing-with-emacs, run against the built dist. Each name
// is a falsifiable claim about the cockpit topology morphisms.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asCockpitConfig,
  defaultAgent,
  resolveCockpit,
  emacsInvocation,
  assignPersona,
  personaByName,
  sessionEnv,
  DEFAULT_PERSONAS,
} from "../dist/cockpit/index.mjs";
import { actions } from "../dist/actions.mjs";

const CONFIG = {
  defaultAgentId: "claude",
  agents: [
    { id: "codex", label: "Codex CLI", kind: "tui", command: "codex", streamIds: ["hooks"] },
    {
      id: "claude",
      label: "Claude CLI",
      kind: "tui",
      command: "claude",
      args: ["--dangerously-skip-permissions"],
      streamIds: ["context", "hooks"],
    },
  ],
  streams: [
    { id: "context", label: "Context Injections", kind: "context-injection", path: "data/logs/context.jsonl" },
    { id: "hooks", label: "Hook Calls", kind: "hook-call", path: "data/logs/operations.jsonl" },
  ],
};

test("asCockpitConfig accepts a well-formed config and rejects junk", () => {
  assert.equal(asCockpitConfig(CONFIG).agents.length, 2);
  assert.throws(() => asCockpitConfig({ agents: [{ id: 1 }] }));
  assert.throws(() => asCockpitConfig(null));
});

test("defaultAgent honors defaultAgentId, else the first agent", () => {
  assert.equal(defaultAgent(asCockpitConfig(CONFIG))?.id, "claude");
  const noDefault = asCockpitConfig({ agents: CONFIG.agents });
  assert.equal(defaultAgent(noDefault)?.id, "codex");
});

test("resolveCockpit (sessionless) builds chat + stream monitors, paths absolutized", () => {
  const plan = resolveCockpit(asCockpitConfig(CONFIG), { agentId: "claude", cwd: "/repo/site" });
  assert.equal(plan.agentId, "claude");
  assert.equal(plan.chat.role, "chat");
  assert.equal(plan.chat.command, "claude");
  assert.deepEqual(plan.chat.args, ["--dangerously-skip-permissions"]);
  assert.equal(plan.session, undefined);
  assert.equal(plan.chat.persona, undefined);
  assert.equal(plan.cwd, "/repo/site");
  assert.equal(plan.monitors.length, 2);
  assert.equal(plan.monitors[0]?.path, "/repo/site/data/logs/context.jsonl");
  assert.equal(plan.monitors[1]?.kind, "hook-call");
});

test("resolveCockpit falls back to the default agent when none is named", () => {
  const plan = resolveCockpit(asCockpitConfig(CONFIG), { cwd: "/repo" });
  assert.equal(plan.agentId, "claude");
});

test("a bound session adds a leading world pane, a persona, and identity env", () => {
  const session = {
    id: "sess-abc-123",
    agentId: "claude",
    persona: assignPersona("sess-abc-123"),
  };
  const plan = resolveCockpit(asCockpitConfig(CONFIG), { cwd: "/repo", session });
  assert.equal(plan.session?.id, "sess-abc-123");
  // chat pane is persona-tinted and namespaced and carries identity env
  assert.equal(plan.chat.persona?.name, session.persona.name);
  assert.match(plan.chat.buffer, /claude·/);
  assert.equal(plan.chat.env?.CWE_SESSION, "sess-abc-123");
  assert.equal(plan.chat.env?.CWE_PERSONA, session.persona.name);
  // first monitor is the world card; then the streams
  assert.equal(plan.monitors[0]?.kind, "world");
  assert.match(plan.monitors[0]?.content ?? "", /its own data/);
  assert.equal(plan.monitors.length, 3);
});

test("personas are deterministic in the session id but differ across ids", () => {
  assert.equal(assignPersona("same-id").name, assignPersona("same-id").name);
  const names = new Set(["a", "b", "c", "d", "e", "f"].map((id) => assignPersona(id).name));
  assert.ok(names.size > 1, "distinct ids should spread across the persona pool");
});

test("two sessions of the same agent get distinct buffers (not one shared claude)", () => {
  const planA = resolveCockpit(asCockpitConfig(CONFIG), {
    cwd: "/repo",
    session: { id: "alpha-1111", agentId: "claude", persona: assignPersona("alpha-1111") },
  });
  const planB = resolveCockpit(asCockpitConfig(CONFIG), {
    cwd: "/repo",
    session: { id: "beta-2222", agentId: "claude", persona: assignPersona("beta-2222") },
  });
  assert.notEqual(planA.chat.buffer, planB.chat.buffer);
});

test("personaByName resolves a pooled name and synthesizes an unpooled one", () => {
  assert.equal(personaByName(DEFAULT_PERSONAS[0].name).color, DEFAULT_PERSONAS[0].color);
  assert.equal(personaByName("Quartz").name, "Quartz");
});

test("sessionEnv exports the session identity", () => {
  const env = sessionEnv({ id: "x", agentId: "claude", persona: { name: "Vex", color: "#000", glyph: "✦" } });
  assert.deepEqual(env, { CWE_SESSION: "x", CWE_PERSONA: "Vex", CWE_PERSONA_COLOR: "#000", CWE_AGENT: "claude" });
});

const IDENTITY_CONFIG = {
  defaultAgentId: "claude",
  sharedMemory: ["mem/shared.md"],
  agents: [
    { id: "codex", label: "Codex CLI", kind: "tui", command: "codex" },
    {
      id: "claude",
      label: "Claude CLI",
      kind: "tui",
      command: "claude",
      identity: {
        sessionArgs: ["--session-id", "{session}"],
        nameArgs: ["--name", "{persona}"],
        embodimentArgs: ["--append-system-prompt", "{embodiment}"],
        homeEnv: "CLAUDE_CONFIG_DIR",
        homeTemplate: "{cwd}/chars/{slug}",
        memoryFile: "CLAUDE.md",
      },
    },
  ],
};

test("an agent identity embodies a session via upstream args, config dir, and memory", () => {
  const session = { id: "11111111-2222-3333-4444-555555555555", agentId: "claude", persona: assignPersona("seed-x") };
  const plan = resolveCockpit(asCockpitConfig(IDENTITY_CONFIG), { agentId: "claude", cwd: "/repo", session });
  assert.deepEqual(plan.chat.args.slice(0, 4), ["--session-id", session.id, "--name", session.persona.name]);
  assert.equal(plan.chat.args[4], "--append-system-prompt");
  assert.match(plan.chat.args[5], new RegExp(session.persona.name));
  assert.match(plan.chat.args[5], /own data, memory/);
  assert.equal(plan.chat.env.CLAUDE_CONFIG_DIR, `/repo/chars/${session.persona.name.toLowerCase()}`);
  assert.equal(plan.character.home, `/repo/chars/${session.persona.name.toLowerCase()}`);
  assert.equal(plan.character.memoryFile, `/repo/chars/${session.persona.name.toLowerCase()}/CLAUDE.md`);
  assert.deepEqual(plan.character.sharedMemory, ["/repo/mem/shared.md"]);
  assert.match(plan.character.memorySeed, /@\/repo\/mem\/shared\.md/);
});

test("an agent without identity gets no character embodiment", () => {
  const session = { id: "abc-def", agentId: "codex", persona: assignPersona("abc-def") };
  const plan = resolveCockpit(asCockpitConfig(IDENTITY_CONFIG), { agentId: "codex", cwd: "/repo", session });
  assert.equal(plan.character, undefined);
  assert.equal(plan.chat.args.length, 0);
  assert.equal(plan.chat.env?.CLAUDE_CONFIG_DIR, undefined);
});

test("--session-id is pinned to the cockpit session id (one world key)", () => {
  const session = { id: "unify-9999", agentId: "claude", persona: assignPersona("unify-9999") };
  const plan = resolveCockpit(asCockpitConfig(IDENTITY_CONFIG), { cwd: "/repo", session });
  const sessionIdArg = plan.chat.args[plan.chat.args.indexOf("--session-id") + 1];
  assert.equal(sessionIdArg, "unify-9999");
  assert.equal(plan.chat.env.CWE_SESSION, "unify-9999");
});

test("emacsInvocation threads init dir, chdir, eval forms, and extra args", () => {
  const argv = emacsInvocation({
    initDirectory: "/pkg",
    cwd: "/repo",
    eval: ["(cwe-launch-cockpit)"],
    args: ["--debug-init"],
  });
  assert.deepEqual(argv, [
    "--init-directory",
    "/pkg",
    "--chdir",
    "/repo",
    "--eval",
    "(cwe-launch-cockpit)",
    "--debug-init",
  ]);
});

test("the package registers exactly its four cockpit actions", () => {
  assert.deepEqual(
    actions.map((a) => a.verb).sort(),
    ["emacs-invocation", "list-agents", "open-session", "resolve-cockpit"],
  );
});
