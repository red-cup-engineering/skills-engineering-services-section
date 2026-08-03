---
title: "Author the 561-polity substrate Claude-Code hook record set"
type: task
area: engineering
status: done
horizon: captured
milestone: m1-operational-housekeeping
goal: claude-code-harness-properly-installed
depends-on: []
requires-capabilities: [substrate-authoring, bilattice-calibration]
theory-basis: [witness-as-increment, substrate-purity]
---

# Author the 561-polity substrate Claude-Code hook record set

## Description

The `claude-code-hooks` harness projects substrate hook records (one record per Claude Code hook event the polity wants witnessed) into `.claude/settings.json`'s `hooks` block plus the single dispatcher shim `.claude/hooks/_pyfars-dispatch.sh`.
Without records, the harness installs a zero-event surface and the polity's interaction-history with Claude Code is dark.

Author records under `561/records/engineering/hooks/<slug>.md` for at least the following Claude Code hook events.
The schema is fixed by `src/pyfars/harnesses/claude-code-hooks/_index.md`:

```yaml
---
kind: hook
type: hook
slug: "hook:<slug>"
runtime: claude-code
event: <event-name>             # one of Claude Code's enum values
matcher: <regex>                # optional, only for tool-targeted events
channel: dispatch               # FARS witness channel
witness:
  operator: <operator-name>
  truth: <0..1>                 # bilattice truth axis
  evidence: <0..1>              # bilattice evidence axis
description: "Free-text — what this hook books, and why these bilattice values."
---
```

Required minimum hook record set:

| Event | slug | (truth, evidence) | rationale |
|---|---|---|---|
| `SessionStart` | `claude-session-start` | (1.0, 0.5) | The session did start (truth=1); we know nothing yet about its content (evidence=0.5). |
| `UserPromptSubmit` | `claude-user-prompt-submit` | (1.0, 1.0) | The captain submitted a prompt; we observed the literal payload. |
| `PreToolUse` | `claude-pre-tool-use` | (1.0, 0.5) | The model intends to call a tool (truth=1); the outcome is not yet observed (evidence=0.5). |
| `PostToolUse` | `claude-post-tool-use` | (1.0, 1.0) | A tool call returned successfully; we observed the post-event ourselves. |
| `PostToolUseFailure` | `claude-post-tool-use-failure` | (0.0, 1.0) | The tool call failed; we observed the failure ourselves. The asymmetric (truth, evidence) — low truth, high evidence — is the bilattice's leverage; truth-weighted views hide the failure, evidence-weighted views surface it. |
| `Stop` | `claude-session-stop` | (1.0, 1.0) | The session ended; we observed the closure event. |

Optional further records the polity may want (per Claude Code's full enum: `SubagentStart`, `SubagentStop`, `PreCompact`, `Notification`, `PermissionRequest`).

## Acceptance

- [ ] `561/records/engineering/hooks/_index.md` exists with `kind: index`.
- [ ] One substrate hook record per event in the required minimum table.
  Each carries `runtime: claude-code` (so the `claude-code-hooks` walker picks it up).
- [ ] Bilattice axes are in [0, 1] and the rationale in the `description:` field justifies the chosen axes (per the harness's substrate-record contract).
- [ ] No record under `records/engineering/hooks/` projects directly to `.claude/settings.json` content — the projection is the harness's job.
- [ ] Optional records for unobserved subagent / compaction events may be deferred to a follow-on task.

## Progress cells

- 2026-05-09: Authored `561/records/engineering/hooks/_index.md` plus the six required substrate hook records (`claude-session-start`, `claude-user-prompt-submit`, `claude-pre-tool-use`, `claude-post-tool-use`, `claude-post-tool-use-failure`, `claude-session-stop`).
  All six carry `runtime: claude-code` and bilattice axes matching the required-minimum table.
  Event-name validation against the harness's `_VALID_HOOK_EVENTS` enum was verified.
