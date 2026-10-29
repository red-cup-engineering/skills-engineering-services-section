---
title: "Verify pyfars hook-dispatch is on PATH for Claude Code sessions"
type: task
area: engineering
status: superseded
horizon: done
milestone: m1-operational-housekeeping
goal: claude-code-harness-properly-installed
depends-on: [install-four-claude-sister-harnesses]
requires-capabilities: [environment-audit, shell-exec]
theory-basis: [witness-as-increment]
superseded-by: governance/specifications/nix-harness.md
superseded-at: 2026-05-09
---

# Verify pyfars hook-dispatch is on PATH for Claude Code sessions

## Superseded

**The premise of this task is now wrong.** Per `governance/specifications/nix-harness.md` §6.2 and pyfars commit 9a267e1, the dispatch shim no longer assumes `pyfars` is on Claude Code's hook-firing PATH.
It invokes pyfars via `nix run "$CLAUDE_PROJECT_DIR#pyfars" -- hook-dispatch "$1"` instead — `nix` IS on PATH (the operator's assumed deploy dependency); `nix run` resolves the polity's flake; pyfars runs.

The "verify pyfars on PATH" check this task was about is no longer a precondition; what matters now is that `nix` is on PATH.
That's verified by `make install` (which checks for nix and prompts the operator to install if absent).

The original task body is preserved below for archive value.

## (original) Description

## Description

The `claude-code-hooks` harness writes one shim — `.claude/hooks/_pyfars-dispatch.sh` — that execs `pyfars hook-dispatch "$1"`.
The shim assumes `pyfars` is on `PATH` at the time Claude Code fires a hook.
If the user's interactive shell has `pyfars` on `PATH` but Claude Code's environment does not (e.g., because the IDE was launched from a desktop launcher with a stripped environment), every hook fires silently — the shim invokes a non-existent command, the inbound witness is never written, and the polity's substrate-purity claim against Claude Code is silently violated.

Verify the inbound chain end-to-end:

1. From the same shell type Claude Code will inherit (or as Claude Code itself starts a session), run `command -v pyfars` and confirm it resolves.
2. Manually invoke the shim with a synthetic hook payload (`$CLAUDE_PROJECT_DIR/.claude/hooks/_pyfars-dispatch.sh hook:claude-session-start <fixture-payload>`).
  Confirm it exits 0 and a JSONL line is appended to `.pyfars/event-log/<today>.jsonl`.
3. Audit the witness fields: timestamp present, actor (`claude-code`) named, verb (`hook-dispatch`) named, bilattice axes match the substrate hook record's declared (truth, evidence).
4. Repeat for one Pre/PostToolUse pair to confirm matcher dispatch works.

## Acceptance

- [ ] `command -v pyfars` resolves in the environment Claude Code inherits.
- [ ] Manual shim invocation with a synthetic payload appends a witness to the event-log.
- [ ] The witness's bilattice axes equal the substrate record's declared values (no silent default-to-zero).
- [ ] Failure modes documented in "Progress cells" for the one-line readme: what happens when `pyfars` is not on `PATH`, what happens when the substrate hook record is malformed, what happens when the event-log directory is unwritable.

## Progress cells

*(empty — task not yet started)*
