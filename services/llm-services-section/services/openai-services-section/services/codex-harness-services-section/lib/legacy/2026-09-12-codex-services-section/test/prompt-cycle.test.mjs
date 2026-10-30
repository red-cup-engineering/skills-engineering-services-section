import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readTrajectory } from "../src/enterprise.mjs";
import { admitPrompt, pausePromptCycleBoundary, promptWorkBoard, readPromptEvents, setPromptWorkState, toolUseDisposition } from "../src/prompt-cycle.mjs";

const now = () => "2026-07-27T23:30:00.000Z";
const fixture = () => ({ stateRoot: mkdtempSync(join(tmpdir(), "codex-prompt-cycle-")), now });
const prompt = (session_id, turn_id, text) => ({ session_id, turn_id, prompt: text });

test("a prompt starts a persisted MAPE cycle over retained source data", () => {
  const options = fixture();
  const admitted = admitPrompt(prompt("session-1", "turn-1", "repair the harness"), options);
  assert.equal(admitted.interruption, false);
  assert.equal(admitted.cycle.type, "CodexMapeCycle");
  assert.ok(admitted.cycle.lots.some(({ stage }) => stage === "monitor"));
  assert.equal(readPromptEvents(options)[0].prompt, "repair the harness");
  assert.equal(readTrajectory(options).filter(({ type }) => type === "PromptMapeCycleStarted").length, 1);
  assert.deepEqual(readTrajectory(options).filter(({ type }) => type === "MapeKnowledgeArtifactObserved").map(({ knowledgeClass }) => knowledgeClass), ["LeaderMoveK", "RequirementK"]);
  assert.equal(Object.hasOwn(admitted, "placementIntent"), false);
});

test("an interruption supersedes the prior cycle and denies its later tool execution", () => {
  const options = fixture();
  const first = admitPrompt(prompt("session-1", "turn-1", "continue the repair"), options);
  const correction = admitPrompt(prompt("session-1", "turn-2", "restart monitoring from this correction"), options);
  assert.equal(correction.interruption, true);
  assert.equal(correction.supersededCycle, first.cycle.id);
  assert.equal(toolUseDisposition({ session_id: "session-1", turn_id: "turn-1" }, options).allowed, false);
  assert.equal(toolUseDisposition({ session_id: "session-1", turn_id: "turn-2" }, options).allowed, true);
});

test("a same-turn correction permits only its restarted generation", () => {
  const options = fixture();
  admitPrompt(prompt("session-1", "turn-1", "old generation"), options);
  const correction = admitPrompt(prompt("session-1", "turn-1", "same-turn steering correction"), options);
  const restarted = toolUseDisposition({ session_id: "session-1", turn_id: "turn-1" }, options);
  assert.equal(restarted.allowed, true);
  assert.equal(restarted.restartedGeneration, true);
  assert.equal(restarted.cycle, correction.cycle.id);
});

test("a normal turn boundary leaves the retained prompt visible and changes state only explicitly", () => {
  const options = fixture();
  const admitted = admitPrompt(prompt("session-1", "turn-1", "retain this exact demand"), options);
  pausePromptCycleBoundary({ hook_event_name: "Stop", session_id: "session-1", turn_id: "turn-1" }, options);
  assert.equal(promptWorkBoard(options)[0].state, "open");
  setPromptWorkState({ cycle: admitted.cycle.id, state: "completed", issuer: "urn:ame:bare-cedar-fog-codex", evidence: "receiver-visible outcome", observedAt: now() }, options);
  assert.equal(promptWorkBoard(options)[0].state, "completed");
});
