---
title: "Install the four claude sister harnesses against the 561 polity-root"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: claude-code-harness-properly-installed
depends-on:
  - author-installing-a-harness-skill
  - author-substrate-agent-record-set
  - author-substrate-claude-hook-record-set
requires-capabilities: [harness-install, nix-run]
theory-basis: [substrate-purity, normative-operational-layering]
---

# Install the four claude sister harnesses against the 561 polity-root

## Description

The Claude Code operator surface is the *conjunction* of four sister harnesses, not any one alone.
Per the bootstrap commit's `pyfars-install` flake app, the install pipeline is a single `nix run .#install` that runs `pyfars install-harness` for each:

1. `claude-code` — projects `561/records/engineering/agents/<slug>.md` → `.claude/agents/<slug>.md` per agent record.
  Frontmatter follows Claude-Code's name/description/model shape; `tools:` is intentionally omitted so subagents inherit the parent toolset.
2. `claude-code-hooks` — writes `.claude/hooks/_pyfars-dispatch.sh` (one shim, regardless of hook count) and populates the `hooks` block of `.claude/settings.json` from `561/records/engineering/hooks/`.
  Each entry references the dispatcher with `command: $CLAUDE_PROJECT_DIR/.claude/hooks/_pyfars-dispatch.sh hook:<slug>`.
3. `claude-code-mcp` — writes `.mcp.json` with the `pyfars-substrate` stdio MCP server entry, and appends `pyfars-substrate` to `enabledMcpjsonServers` in `.claude/settings.json`.
  Existing settings (permissions, env) are preserved.
4. `claude-agent-sdk-plugin` — projects every registered FARS verb (`pyfars.cli.__main__.
  VERB_MODULES`) as a slash command under `.claude/plugins/pyfars-substrate/commands/<verb>.md`, plus `.claude-plugin/plugin.json`.

All four installs write their manifest to `.pyfars/harness-manifests/<harness>.json`.

## Steps

1. Confirm Phase A and Phase B tasks are complete (manifest object, install skill, agent records, hook records all in place).
2. Run `nix run .#install` from the polity-root.
  This invokes `pyfars-install` from `flake.nix`, which:
   - `nix profile add .#pyfars` (puts `pyfars` on `PATH`).
   - `pyfars install-harness claude-code`
   - `pyfars install-harness claude-code-hooks`
   - `pyfars install-harness claude-code-mcp`
   - `pyfars install-harness claude-agent-sdk-plugin`
   - (also openclaw and cline-workflows per the existing `agentHarnesses` list — those are sister installs unrelated to this goal but ride along.)
3. Spot-check one file from each harness:
   - `.claude/agents/architect.md` exists, has the substrate record's `description:` in its frontmatter, body summarises duties/skills/jurisdiction.
   - `.claude/hooks/_pyfars-dispatch.sh` exists and is one file.
   - `.claude/settings.json` `hooks` block has an entry per hook record.
   - `.mcp.json` has `mcpServers.pyfars-substrate.command = "pyfars"`.
   - `.claude/plugins/pyfars-substrate/commands/witness.md` exists (or any other verb).

## Acceptance

- [ ] `nix run .#install` exits 0.
- [ ] All four manifest files exist under `.pyfars/harness-manifests/`.
- [ ] Spot-check files exist in their expected locations.
- [ ] `.claude/settings.json` parses as valid JSON.
- [ ] `.mcp.json` parses as valid JSON.
- [ ] No file under `.claude/` or `.mcp.json` is hand-edited; every byte traces back to a substrate record or harness template.

## Progress cells

*(empty — task not yet started)*
