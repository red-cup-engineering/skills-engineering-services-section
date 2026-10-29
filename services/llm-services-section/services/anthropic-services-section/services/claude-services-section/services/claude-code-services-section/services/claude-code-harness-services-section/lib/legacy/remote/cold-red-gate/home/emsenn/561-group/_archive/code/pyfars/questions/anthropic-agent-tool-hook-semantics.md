---
type: question
status: open
explores: [sub-session-binding, hook-dispatch, witness-chain, anthropic-agent-tool, harness-claude-code-hooks]
---

# When this Claude session calls Anthropic's `Agent` tool to spawn a sub-Claude, do the sub-session's tool calls fire the parent harness's hooks, and if so for which event types?

The integration in [`claude-as-pyfars-runtime`](../work/goals/claude-as-pyfars-runtime.md) Phase 5 binds sub-Claude sessions as substrate-recorded sub-workitems.
The witness-chain discipline in Phase 4 — outcome-witnessed close — relies on session-lifecycle hooks (`SessionStart`, `Stop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`) firing to mark closure events.
For *parent* sessions the wiring is well-understood: `_pyfars-dispatch.sh` is the dispatcher; the hook fires; pyfars writes a witness.
For *sub-sessions* spawned via the `Agent` tool, the behavior is not documented in this repo and the architectural commitments of Phase 4 and Phase 5 depend on knowing it.

This is a realization question, not a design question.
The answer is empirically determinable from one careful test session and a read of Anthropic's published harness documentation; once known, it constrains what infrastructure Phase 4 and Phase 5 must provide.

## What the answer's shape looks like

A precise statement of the form *"In the running Claude Code harness, when the parent session invokes `Agent(subagent_type=X, prompt=…)` and the sub-session subsequently issues a tool call $C$, hook event $E$ fires {at the parent / at a separate sub-session scope / not at all}; the firing's payload includes {the parent session-id / the sub-session-id / both / neither}."* — for each of the six configured hook events.

## Why it matters for the realization

If sub-session tool calls fire the parent's hooks with the *parent's* session-id, then any witness emitted from those firings must be tagged at write-time with the sub-session-id (which the substrate must learn from a different source — most likely the sub-assignment-cell the parent wrote at `dispatch_subagent` time).
Phase 4's outcome-witnessed close must then read the sub-session-id from the assignment cell, not from the hook payload, and the parent harness's hook must look up the active sub-session before attributing the witness.

If sub-session tool calls fire under a separate session-id that the harness can read from the hook payload, then attribution is direct and the substrate machinery is correspondingly simpler — the sub-session-id flows through hooks the same way the parent's session-id does.

If sub-session tool calls fire *no* hooks at all, then the witness path for sub-sessions cannot rely on hook events; everything goes through MCP exclusively, and the `dispatch_subagent` tool's contract grows to include closing-witness emission triggered by the sub-session's MCP `release_workitem` call rather than a `Stop` hook.

These three branches lead to materially different harness designs.
Phase 5 cannot be shipped without the answer.

## What's hard

Two things make this less than a one-shot lookup:

- **Anthropic harness documentation.** The Claude Code published documentation describes hooks for sessions but does not explicitly characterize sub-session hook behavior under `Agent`.
  The implementation may also vary across Anthropic SDK versions; the test should pin the version used.
- **Test design must distinguish three outcomes cleanly.** A single trace must show whether a hook fired, under whose session-id, with what payload.
  The test cannot rely on grep over `.fars/event-log/` alone (which presumes hooks fired); it must instrument the dispatcher shim to log every received call regardless of payload.

## What would need to be answered

1. Run a one-off session that invokes `Agent` with a benign sub-task that issues exactly one tool call (e.g., a `Read` of a known file); inspect the resulting hook firings via an instrumented dispatcher logging every event verbatim.
2. Repeat with two sub-agents to confirm sub-session-id (if any) is unique per sub-spawn.
3. Read the relevant Anthropic SDK / Claude Code source or documentation to confirm the empirical observation matches the documented contract; if not, the contract may change in a future SDK version and the harness must defend against both.
4. Document the answer as a realization claim under `claims/`; encode the substrate-side commitment (where sub-session-id comes from for witness attribution) in a Phase 5 task.

When this resolves, the resolving claim goes to `claims/`.
This question note is then deleted; the corresponding Phase 5 task design folds the answer into the harness contract.
