---
title: "Wire slash-command installer to the captain's office"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: harness-claude-by-office-assignment
depends-on: [implement-office-resolver-in-installer, author-or-confirm-captain-office-record]
requires-capabilities: [pyfars-package-structure]
theory-basis: [eligibility-by-office, normative-operational-layering]
---

# Wire slash-command installer to the captain's office

## Description

Slash commands are *the captain's* invocation surface during a Claude session — the captain types `/<command>` and Claude Code dispatches it.
So the installed slash-command set should reflect the captain's authorization, not the model's.
Today, the `claude-agent-sdk-plugin` harness projects every PyFARS verb in `VERB_MODULES` as a slash command.
Wire it to the captain's office instead.

In `_install_claude_agent_sdk_plugin`:

1. Call `_resolve_captain_office(root)` to get the captain's `exposes-commands:` set.
2. If the set is `["*"]`, project every entry in `VERB_MODULES` (current behavior, preserved).
3. If the set is a specific list, project only those verbs.
4. If the captain office is missing or has no `exposes-commands:`, surface a warning and fall back to projecting every verb (graceful degradation: the captain hasn't curated yet, so retain the existing default rather than locking the captain out).

Document the office-filter behavior in `claude-agent-sdk-plugin/_index.md`.

A future task may *split* `claude-agent-sdk-plugin` into `claude-code-commands` (project-level slash commands at `.claude/commands/`, the more native Claude Code surface) and a leaner `claude-agent-sdk-plugin` (only what's strictly needed for the SDK plugin envelope).
That split is out of scope here; this task wires the existing surface to the captain's office.
If the split happens, the office-wire moves with the projection.

## Acceptance

- [ ] `_install_claude_agent_sdk_plugin` calls `_resolve_captain_office(root)` and filters its projected verb set accordingly.
- [ ] Wildcard `"*"` projects every VERB_MODULES entry.
- [ ] Missing captain office surfaces a warning and falls back to projecting all verbs.
- [ ] The harness `_index.md` documents the office filter.
- [ ] Install against 561 with a curated captain office produces only the captain's authorized slash commands at the projection target.

## Progress cells

*(empty — task not yet started)*
