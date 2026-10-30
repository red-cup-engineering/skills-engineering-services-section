import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { observeLifecycle } from "../scripts/observe-claude-lifecycle.mjs";
import { openHarnessLifecycleJournal } from "@red-cup-engineering/harness-lifecycle-journal-service";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("lifecycle observation retains metadata and digests identities without retaining hook content", () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  try {
    const secret = "a prompt that must never be retained";
    const result = observeLifecycle({
      input: { hook_event_name: "UserPromptSubmit", session_id: "raw-session-id", cwd: "/secret/workspace", prompt: secret },
      expectedEvent: "UserPromptSubmit",
      journalRoot: scratch,
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    });
    const observation = result.observation;
    assert.equal(observation.event, "UserPromptSubmit");
    assert.equal(observation.occurredAt, "2026-08-27T12:00:00.000Z");
    assert.match(observation.sessionDigest, /^sha256:/u);
    assert.match(observation.workspaceDigest, /^sha256:/u);
    assert.match(observation.promptDigest, /^sha256:/u);
    const onDisk = readFileSync(join(scratch, "data/logs/2026/08/27/witness-journal-seavt.jsonl"), "utf8");
    assert.doesNotMatch(onDisk, /raw-session-id|a prompt that must never be retained/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("Stop observation carries a transcriptDigest without retaining the transcript path", () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  try {
    const result = observeLifecycle({
      input: { hook_event_name: "Stop", session_id: "s", cwd: scratch, transcript_path: "/secret/transcript.jsonl" },
      expectedEvent: "Stop",
      journalRoot: scratch,
    });
    assert.match(result.observation.transcriptDigest, /^sha256:/u);
    const onDisk = readFileSync(join(scratch, `data/logs/${result.observation.occurredAt.slice(0, 10).replaceAll("-", "/")}/witness-journal-seavt.jsonl`), "utf8");
    assert.doesNotMatch(onDisk, /secret\/transcript/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("lifecycle observation defaults its journal root to this package, never the project root", () => {
  const datedDir = join(PACKAGE_ROOT, "data/logs/2099/01/01");
  try {
    const result = observeLifecycle({
      input: { hook_event_name: "SessionStart", session_id: "s", cwd: "/some/other/project", source: "startup" },
      expectedEvent: "SessionStart",
      projectRoot: "/some/other/project",
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });
    assert.equal(result.root, PACKAGE_ROOT);
    assert.ok(existsSync(join(datedDir, "witness-journal-seavt.jsonl")));
  } finally {
    rmSync(datedDir, { recursive: true, force: true });
  }
});

test("SessionStart admits only the bounded source label and mismatched events fail", () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  try {
    const observed = observeLifecycle({
      input: { hook_event_name: "SessionStart", session_id: "s", cwd: scratch, source: "resume", injected_context: "discard me" },
      expectedEvent: "SessionStart",
      journalRoot: scratch,
    });
    assert.equal(observed.observation.source, "resume");
    assert.equal("injected_context" in observed.observation, false);
    assert.throws(() => observeLifecycle({
      input: { hook_event_name: "Stop", cwd: scratch }, expectedEvent: "SessionStart", journalRoot: scratch,
    }), /does not match/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("UserPromptSubmit and Stop chain to the session's prior lifecycle record, rooted at SessionStart", () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  try {
    const clock = (iso) => () => new Date(iso);
    const start = observeLifecycle({
      input: { hook_event_name: "SessionStart", session_id: "chain-session", cwd: scratch, source: "startup" },
      expectedEvent: "SessionStart",
      journalRoot: scratch,
      now: clock("2026-09-02T10:00:00.000Z"),
    });
    assert.equal(start.relation, null);

    const prompt = observeLifecycle({
      input: { hook_event_name: "UserPromptSubmit", session_id: "chain-session", cwd: scratch, prompt: "hi" },
      expectedEvent: "UserPromptSubmit",
      journalRoot: scratch,
      now: clock("2026-09-02T10:00:01.000Z"),
    });
    assert.deepEqual(prompt.relation, { subject: prompt.id, predicate: "follows", object: start.id });

    const stop = observeLifecycle({
      input: { hook_event_name: "Stop", session_id: "chain-session", cwd: scratch, transcript_path: "/t" },
      expectedEvent: "Stop",
      journalRoot: scratch,
      now: clock("2026-09-02T10:00:02.000Z"),
    });
    assert.deepEqual(stop.relation, { subject: stop.id, predicate: "follows", object: prompt.id });

    const secondPrompt = observeLifecycle({
      input: { hook_event_name: "UserPromptSubmit", session_id: "chain-session", cwd: scratch, prompt: "again" },
      expectedEvent: "UserPromptSubmit",
      journalRoot: scratch,
      now: clock("2026-09-02T10:00:03.000Z"),
    });
    assert.deepEqual(secondPrompt.relation, { subject: secondPrompt.id, predicate: "follows", object: stop.id });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("SubagentStop commissions a provider on the harness lifecycle journal, linked to the turn's UserPromptSubmit", () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  try {
    const clock = (iso) => () => new Date(iso);
    const prompt = observeLifecycle({
      input: { hook_event_name: "UserPromptSubmit", session_id: "subagent-session", cwd: scratch, prompt: "go do it" },
      expectedEvent: "UserPromptSubmit",
      journalRoot: scratch,
      now: clock("2026-09-02T11:00:00.000Z"),
    });

    const subagentStop = observeLifecycle({
      input: { hook_event_name: "SubagentStop", session_id: "subagent-session", cwd: scratch, transcript_path: "/secret/subagent-transcript.jsonl" },
      expectedEvent: "SubagentStop",
      journalRoot: scratch,
      now: clock("2026-09-02T11:00:05.000Z"),
    });
    assert.match(subagentStop.observation.transcriptDigest, /^sha256:/u);
    assert.deepEqual(subagentStop.relation, { subject: subagentStop.id, predicate: "follows", object: prompt.id });
    assert.equal(subagentStop.commission.turnId, prompt.id);

    const commissions = openHarnessLifecycleJournal({ root: scratch }).query({ category: "provider-commissioned" });
    assert.equal(commissions.length, 1);
    assert.equal(commissions[0].record.turn, prompt.id);
    assert.equal(commissions[0].record.name, "claude-subagent");
    assert.match(commissions[0].record.task, /^sha256:/u);

    const onDisk = readFileSync(join(scratch, "data/logs/2026/09/02/witness-journal-seavt.jsonl"), "utf8");
    assert.doesNotMatch(onDisk, /secret\/subagent-transcript/u);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("SubagentStop with no prior UserPromptSubmit for the session refuses", () => {
  const scratch = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  try {
    assert.throws(() => observeLifecycle({
      input: { hook_event_name: "SubagentStop", session_id: "lonely-session", cwd: scratch, transcript_path: "/t" },
      expectedEvent: "SubagentStop",
      journalRoot: scratch,
    }), /no UserPromptSubmit record/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
