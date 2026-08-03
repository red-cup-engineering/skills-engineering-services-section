---
title: "Route `pyfars hook-dispatch` through the MCP `append_witness` codepath"
type: task
area: engineering
status: complete
completed: 2026-05-09
horizon: doing
milestone: m5-agential-self-generation
goal: claude-as-pyfars-runtime
plan: ship-mcp-write-tool-surface
depends-on: [author-mcp-append-witness-tool]
requires-capabilities: [python-editing, hook-dispatch, mcp-client-development]
theory-basis: [witness-emission-is-surface-invariant, surface-invariant-codepath, witness-as-increment]
derives-from-claim: witness-emission-is-surface-invariant
derives-from-spec: "event-log-append:2026.05.09+event-log-append"
satisfies-requirements: [R1, R2]
---

# Route `pyfars hook-dispatch` through the MCP `append_witness` codepath

## Description

This task realizes specification [`event-log-append`](../../../governance/specifications/event-log-append.md) requirements R1–R2 (canonical-call-site uniqueness) for the hook-dispatch surface.
The Claude Code harness's six hook events (`SessionStart`, `SessionStop`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`) all funnel through `_pyfars-dispatch.sh` → `pyfars hook-dispatch <slug>`.
Today the `hook-dispatch` CLI verb at [`cli/hook_dispatch.py`](../../../src/pyfars/cli/hook_dispatch.py) instantiates an `EventLog` and calls `.append(witness)` — which already terminates at the canonical call site (verified in cycle [`2026-05-09-witness-emission-codepath-uniformity`](../../cycles/2026-05-09-witness-emission-codepath-uniformity.md) stage-2 prior-art audit).
The codepath uniqueness commitment (spec R1–R2) is *already substantially satisfied* for this surface.

What this task adds: explicit factoring + verification + audit posture.
After [`author-mcp-append-witness-tool`](author-mcp-append-witness-tool.md) lands, the MCP path and the hook path both reach `EventLog.append`; the surface-invariance claim's codepath-uniqueness clause holds for both surfaces.
This task verifies and documents that joint condition — making it a substrate-readable invariant rather than an incidental architectural property.

Two acceptable approaches:

**Option A — both paths call one library function.** The cleaner shape: factor the event-log append into `pyfars.runtime.event_log.append_witness(witness, *, root)`, have both the MCP tool's body and the `pyfars hook-dispatch` CLI verb's body call it.
No MCP server is *invoked* by the hook; both paths share the same in-process Python function.
The "single codepath" is the library function, not an MCP transport.

**Option B — the hook acts as an MCP client.** The `pyfars hook-dispatch` CLI verb opens an MCP client connection to the running `pyfars-substrate` server (stdio-spawned per-call, or HTTP if the server is running supervised) and issues an `append_witness` tool call.
The "single codepath" is the MCP transport itself.

Option A is recommended because (i) the hook fires in a non-login shell with no MCP server context and per-firing connection setup is fragile; (ii) the hook may fire while no MCP server is running, but witness-emission must not fail-loud during routine session work; (iii) Option B's transport overhead is non-trivial relative to the witness payload.
Option B's only advantage is that it exercises the MCP transport on every hook firing, which makes integration regressions louder; that's not enough to justify the fragility.

If Option A is taken, the recommended factoring:

1. Identify the current append codepath in `pyfars hook-dispatch` (most likely `pyfars/cli/hook_dispatch.py` or similar).
  Extract it into `pyfars.runtime.event_log.append_witness(witness, *, root)` — the same function [`author-mcp-append-witness-tool`](author-mcp-append-witness-tool.md) routes its MCP tool to.
2. Modify `pyfars hook-dispatch` to construct a `Witness` from the hook event payload (event name → `operator`; root → `target`; channel="hook"; origin=hook slug; truth=1.0; evidence=1.0) and call `append_witness(witness, root=root)` on the new library function.
3. Confirm the existing harness installation does not require a re-installation: the dispatcher shim at `.claude/hooks/_pyfars-dispatch.sh` already calls `pyfars hook-dispatch "$1"` with no path-coupling to the append routine; the path-bake is to the `pyfars` binary itself, not to the append function.
  Witnesses authored before and after the routing change should be byte-equivalent for the same hook event (verifiable in the test below).

If Option B is taken instead — for example, if the captain decides exercising the MCP transport on every hook firing is desirable — the task body adjusts but the acceptance pattern below still applies: the goal is "exactly one place authors event-log records, both paths reach it."

## Acceptance

Acceptance criteria are derived from spec [`event-log-append`](../../../governance/specifications/event-log-append.md) §6.
Each criterion cites the spec section it operationalizes.

- [ ] **(spec §6.1 + R1–R2)** `pyfars.runtime.event_log.
  EventLog.append` is the *only* function in `pyfars/` that opens the event-log path pattern in append mode.
  Verifiable by `grep -rn "open(.*\\.jsonl.*\"a\"" pyfars/src/` returning exactly one match (in `event_log.py`).
- [ ] **(spec R1)** `pyfars hook-dispatch <slug>` (CLI verb at `pyfars/cli/hook_dispatch.py`) constructs a `Witness` and calls `EventLog.append(witness)`; it does not author event-log records by any other path.
  The CLI's docstring explicitly cites spec R1 as the codepath-uniqueness invariant it preserves.
- [ ] **(spec §6.5 + plan milestone-cell joint-settlement)** The MCP `append_witness` tool from [`author-mcp-append-witness-tool`](author-mcp-append-witness-tool.md) calls the same `EventLog.append`.
  Both the hook path and the MCP path are exercised by the test suite under `tests/test_event_log_append.py`.
- [ ] **(operates over code-example fixture)** An end-to-end test: drive `pyfars hook-dispatch hook:claude-session-start` against a temp polity loaded from `examples/event-log-append/temp-polity-fixture/`, then via the MCP client call `append_witness(operator="hook:claude-session-start", target="<root>", channel="hook", ...)
  ` with the same fields; assert the resulting two event-log entries are byte-equivalent except for `timestamp`, `before_hash`, and `after_hash` fields.
  The test loads expected fields from `examples/event-log-append/audit-fixture-pass.json`.
- [ ] **(no harness re-install required)** The dispatcher shim at `.claude/hooks/_pyfars-dispatch.sh` is unchanged; re-running `pyfars install-harness claude-code-hooks` is not required for this task's behavior to take effect (the routing is in pyfars itself, not in the shim).
- [ ] **(uniform record stream)** An audit query of the event-log across a session that includes hook firings AND in-session MCP `append_witness` calls produces a uniform record stream: no schema divergence between hook-authored and MCP-authored entries; identical filterable fields (`channel`, `origin`, `agent`); identical bilattice-axis presentation.
- [ ] **(manual codepath-uniqueness check)** Per [`ship-mcp-write-tool-surface`](../../plans/ship-mcp-write-tool-surface.md) §"What this plan does NOT claim," milestone-cell `(witness-event-log, single-codepath, true) = T` is settled at plan completion by manual grep producing the codepath-uniqueness pass condition.
  Substrate-resident audit is deferred to a follow-on plan.

## Progress cells

- 2026-05-09 — Verified Option A was already substantially in place: `pyfars/cli/hook_dispatch.py` already calls `EventLog(root=root).append(witness)`, and the new MCP `append_witness` tool also calls `EventLog(root=root).append(witness)`.
  Both surfaces reach the canonical site at `pyfars/src/pyfars/runtime/event_log.py:103`.
  The §6.1 grep test passes — exactly one match in `pyfars/src/` for `path.open(...
  "a", ...)
  ` targeting jsonl/event-log files.
- 2026-05-09 — End-to-end §6.5 test confirms both paths land witnesses in the same daily log file under a temp polity; both witnesses are well-formed; surface identity is preserved (distinct `channel` values per R6).
- 2026-05-09 — Plan `ship-mcp-write-tool-surface`'s milestone-cells `(mcp-server, has-append-witness-tool, true)`, `(hook-dispatch, routes-through-mcp-append-witness, true)`, and `(witness-event-log, single-codepath, true)` are all settled at $\mathbf{t}$ by manual inspection per the plan's deferred-audit posture.
