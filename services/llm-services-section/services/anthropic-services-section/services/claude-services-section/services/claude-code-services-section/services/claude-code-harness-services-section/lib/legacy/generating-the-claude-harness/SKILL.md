<!--
Legacy prior art, collected 2026-07-29. Originally lived at
.claude/.claude.backups/.claude.bk.2026-07-27/skills/generating-the-claude-harness/SKILL.md
in the root settlement repo (/home/emsenn/info) — a whole-settlement meta-skill
for regenerating .claude/ artifacts (agents, hooks, skills, settings.json,
CLAUDE.md) from source records. Superseded here by this section's own live
claude-harness-projection-service, which owns the narrower, current charter
of projecting one machine actor's office roster into .claude/agents/. Kept
for reference, not loaded or run.
-->
---
name: generating-the-claude-harness
description: "Generate this settlement's Claude harness through its own instruments. Load this BEFORE touching anything under .claude/ — hooks, skills, agents, settings.json, .mcp.json — or any CLAUDE.md, at any node. These files are deleted and regenerated as routine, so each one is output projected from a record, and the record is what a session edits. Carries the claude-md.md specification, the instrument for each artifact kind, and the byte-exact check that proves a projection still matches its source."
---

# Generating the Claude harness

Every file under `.claude/` and every `CLAUDE.md` in this settlement is
**output**. The record it projects from is the thing a session edits. This
settlement deletes and regenerates the harness as routine, so a hand-typed
line survives until the next regeneration and vanishes without a trace of why
it was there.

The projected files say so themselves. `.claude/agents/content-librarian.md`
carries: *"This file is output, projected from the office's record… edits here
are discarded on the next install."*

## The instrument for each artifact

| Artifact | Instrument | Source record |
| --- | --- | --- |
| `.claude/agents/<office-id>.md` | `installing-claude-as-an-agent` | one office JSON + its `bears-duty` records + each skill's SKILL.md |
| `CLAUDE.md` standing block | `installing-an-enterprise-in-claude` | an enterprise's whole office roster |
| a node's session identity | `installing-claude-as-an-office` | one office, seated as the identity the node's sessions step into |
| `<target>/<gerund>/SKILL.md` + `scripts/` | `projecting-a-skill` | a flat skill script's `@skill` header, validated against `skill.schema.json` |
| `CLAUDE.md` whole file | `authoring-claude-md`, `rendering-a-claude` | the `claude-md.md` specification |
| `.claude/settings.json` | `composing-a-claude-settings-file` | the node's settings record |

All of these live under a node's `lib/management/skills/` or a character's
`governance/skills/`. Find the nearest one and run it from the node that owns
the output.

## The CLAUDE.md specification

`claude-md.md` states the contract. A conformant `CLAUDE.md`:

- stays under 100 lines, and under 300 as a hard ceiling
- carries a session-start procedure, a memory policy, and an architecture
  pointer
- keeps domain knowledge, task lists, tool inventories, and behavioral
  constraints in the surface files and records that own them
- states each fact once, in the one place that owns it

A file that reads as a philosophy essay is a file that drifted. Check a
CLAUDE.md against these six lines before adding to it, and move whatever fails
into the record that owns it.

## The standing block and its markers

`installing-an-enterprise-in-claude` splices its projection between
`<!-- installing-an-enterprise-in-claude: begin -->` and its end marker. A file
holding both markers has the block replaced byte-exact with everything outside
untouched. A file holding one marker is a torn block, which the installer
names as a contradiction and refuses.

Four CLAUDE.md files in this settlement carry that block today
(`executive-office`, `aagaard`, `agrodao`, `divination`). A CLAUDE.md without
markers is a file that has never been generated, and standing up its enterprise
is what gives it a source.

## Check before you conclude a projection is current

Each projector holds a `--check` mode that re-renders and compares byte for
byte. Run it to learn whether a projected file still matches its record. A
difference is drift with a number attached, which is the measurement this
settlement wants.

```sh
node .../project-a-skill.js --all --target .claude/skills --check
```

## Mesh scope

An installer refuses a source that crosses a sovereign settlement boundary and
names the remedy in its refusal: invoke the settlement-local installer with
`--authority-root` naming that settlement and a source enterprise local to it.
Read the refusal as the routing instruction it is.

## When the artifact has no generator

Hooks and `settings.json` are generated at some nodes and hand-held at others.
Where a generator exists, run it. Where one is absent, say which artifact lacks
one and name it as the missing stage, so the gap enters the record rather than
being filled by another hand-typed file.
