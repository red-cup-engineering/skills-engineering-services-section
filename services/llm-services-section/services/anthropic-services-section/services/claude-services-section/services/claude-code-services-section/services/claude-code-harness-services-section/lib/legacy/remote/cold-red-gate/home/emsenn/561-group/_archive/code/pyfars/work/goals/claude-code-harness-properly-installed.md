---
title: "Claude Code harness properly installed"
type: goal
slug: claude-code-harness-properly-installed
milestone: m1-operational-housekeeping
status: open
horizon: captured
theory-basis: [substrate-purity, witness-as-increment, normative-operational-layering]
tasks:
  - author-harness-manifest-object-record
  - author-installing-a-harness-skill
  - verify-or-author-substrate-agent-record-skill
  - author-substrate-agent-record-set
  - author-substrate-claude-hook-record-set
  - install-four-claude-sister-harnesses
  - audit-claude-harness-manifest-coverage
  - verify-pyfars-hook-dispatch-on-path
  - round-trip-claude-hook-witness-test
  - file-followon-engine-uds-hook-endpoint-migration
  - emit-harness-installed-witnesses
  - author-claude-harness-install-observation
  - link-goal-to-m1-and-tasks-to-goal
---

# Claude Code harness properly installed

After this goal, the polity-root has a *proper* PyFARS harness against Claude Code, not the weak set of projectors that preceded it.
A proper harness commits to five things:

1. **Outbound projection from substrate records.** Every artifact under `.claude/` is generated from a substrate record under `records/engineering/agents/` or `records/engineering/hooks/` — never hand-edited.
2. **Inbound witness round-trip.** Every Claude Code event (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `UserPromptSubmit`, …) becomes a bilattice-graded substrate witness on `.pyfars/event-log/<date>.jsonl` via the `claude-code-hooks` single-dispatcher shim invoking `pyfars hook-dispatch`.
3. **Manifest-tracked install.** `.pyfars/harness-manifests/<harness>.json` records every projected file plus prior file state, so `--uninstall` is exact and reversible.
4. **Substrate-purity preserved across the boundary.** The polity's interaction history with Claude Code is reconstructable from substrate alone.
5. **Four sister harnesses installed jointly** — `claude-code` (agents), `claude-code-hooks` (event hooks), `claude-code-mcp` (`.mcp.json`), `claude-agent-sdk-plugin` (verbs as slash commands).
  Claude-Code's operator surface is the conjunction; any one alone is a partial projection.

## Theory grounding

**Per [`harness`](../../concepts/harness.md)**: a harness is an integration projection — bidirectional whenever the runtime supports inbound.
Claude Code does support inbound (its hook protocol).
An outbound-only "harness" against Claude Code is therefore not a harness at all but a templating system; substrate-purity does not survive without the inbound channel.

**Per [`witness`](../../concepts/witness.md)**: "every change to PyFARS substrate state is a witness; nothing changes without one."
The polity's interaction-history with Claude Code is a sequence of state changes; if those changes do not produce witnesses, replay cannot reconstruct the polity at any past moment that includes Claude-Code activity.

**Per the [wiring-protocols](../../governance/specifications/wiring-protocols.md) specification**: the Claude Code harness crosses three of the eight wiring-kinds:

- §4.4 LLM agent ↔ engine — MCP (handled by the `claude-code-mcp` harness writing `.mcp.json`).
- §4.5 inbound external event/hook — HTTP-POST (today, direct image write) via thin shim invoking `pyfars hook-dispatch`.
  Handled by `claude-code-hooks`.
- §4.7 polity ↔ host-OS supervisor — declarative file projection.
  `.claude/settings.json` and `.mcp.json` are the on-disk surface Claude Code reads at session start.

**Per [`markdown-as-projection`](../../governance/decisions/markdown-as-projection.md)**: `.claude/agents/<slug>.md` is a derived projection of a substrate `records/engineering/agents/<slug>.md` record, not a primary authored file.
Hand-editing the projection corrupts substrate-projection alignment.

**Per [`substrate-purity`](../../governance/decisions/substrate-purity.md)**: harness-specific accommodations are secondary to substrate correctness.
The harness writes nothing that violates substrate-purity, and every external event the runtime emits to the harness is captured as a substrate witness.

## Why an M1 goal

M1 — Operational Housekeeping — exists to give the autonomous loop a clean substrate foundation.
An unharnessed polity has no inbound channel for the captain's primary IDE runtime; the autonomous loop cannot witness the captain's prompts, tool uses, or session lifecycle.
The polity is structurally deaf to the operator surface that drives most of its work.
Resolving that is housekeeping.

Sister goals under M1:

- [`pyfars-instance-directory-clean`](pyfars-instance-directory-clean.md) lists `.pyfars/harness-manifests/` as one of the directories that *should* exist after housekeeping.
  This goal is what fills it.
- [`operations-directory-structured`](operations-directory-structured.md) names the `agents/` sub-layout that the substrate-side of the harness reads from.

## Acceptance

- [ ] `tools/platform/pyfars/objects/harness-manifest.md` exists declaring the harness-manifest object's frontmatter schema.
- [ ] `tools/platform/pyfars/governance/skills/installing-a-harness.md` exists documenting the install discipline (read records → render templates → capture prior state → write projection → witness install → write manifest).
- [ ] An `authoring-a-substrate-agent-record` skill record exists (or the equivalent is folded into an existing skill) and is cited by the `claude-code` harness's `_index.md`.
- [ ] `561/records/engineering/agents/` contains substrate agent records covering at least the agents listed in the wiped `.agents/skills/agent-*.md` set (architect, build-error-resolver, code-reviewer, …).
  Each record is authored to substrate-agent shape, not the deleted projector shape.
- [ ] `561/records/engineering/hooks/` contains hook records targeting `runtime: claude-code` for at least: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`.
  Each record declares bilattice axes with rationale.
- [ ] `nix run .#install` runs cleanly, projecting:
  - `.claude/agents/<slug>.md` per agent record.
  - `.claude/hooks/_pyfars-dispatch.sh` (one shim) and the `hooks` block of `.claude/settings.json` per hook record.
  - `.mcp.json` and `enabledMcpjsonServers` settling for the MCP harness.
  - `.claude/plugins/pyfars-substrate/commands/<verb>.md` per registered FARS verb.
- [ ] `.pyfars/harness-manifests/{claude-code,claude-code-hooks,claude-code-mcp,claude-agent-sdk-plugin}.json` each exist and list every projected file.
- [ ] `pyfars hook-dispatch` is on `PATH` and a deliberate Claude Code event of each registered kind appears as a JSONL line in `.pyfars/event-log/<date>.jsonl` with the bilattice axes the substrate hook record declares.
- [ ] One observation record under `561/records/` records what was installed, why, and against which FARS spec version.

## Done when

The captain runs a Claude Code session in `561/`, performs prompt-submit / tool-use / session-stop, and the substrate event log contains the corresponding bilattice-graded witnesses; the four sister manifests cover every file under `.claude/` and `.mcp.json`; `pyfars install-harness --uninstall` reverts the polity to its pre-install state with no orphan files.
