---
name: claude md
description: Specifies §1 abstract.
title: "CLAUDE.md"
status: draft
version: "2026.05.14.claude-md"
date: 2026-05-14
authors: [emsenn, rom-keldar]
references:
  emsenn2026-05-14b:
    class: directive
    authors: ["Sennhauser, Morgan"]
    year: 2026
    title: "Order to bootstrap Rom Keldar with surface file specifications"
    institution: "561 polity"
    note: "Verbal directive issued 2026-05-14"
  theory-claude-md:
    class: theory-term
    title: "claude-md"
    note: "theories/.../artificial-intelligence/claude-md.md — best practices synthesis"
  surface-files-spec:
    class: specification
    title: "Surface Files"
    note: "doing/governing/characters/rom-keldar/governance/rules/specifications/surface-files.md"
---

# CLAUDE.md

## §1 Abstract

This document specifies the format and content of `CLAUDE.md` files within the 561 substrate. `CLAUDE.md` is a Claude Code-specific instructions file: it is the entry point for a session, telling Claude what to do *before* it does anything else. It is not a knowledge base, not a character description, and not a task list. It is process instructions.

## §2 Conformance

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

## §3 Purpose and scope

`CLAUDE.md` answers one question: *what should Claude do at the start of this session that it would get wrong without explicit instruction?*

It is Claude Code-specific. The tool-agnostic equivalent is `AGENTS.md`; if a theory needs both, `CLAUDE.md` SHOULD reference `AGENTS.md` rather than duplicate it.

`CLAUDE.md` is the entry point into the character system. When a character is installed, `CLAUDE.md` bridges Claude Code's automatic loading behavior to the character's surface files. Without `CLAUDE.md`, surface files are installed but not read.

## §4 Length

A `CLAUDE.md` at the theory root MUST NOT exceed 300 lines. It SHOULD be under 100 lines. Instructions that apply only within a subdirectory SHOULD be placed in a `CLAUDE.md` within that subdirectory rather than in the root file.

The theory's `claude-md.md` term establishes 60 lines as common best practice; this spec permits up to 100 for polity-level context given the character system's complexity.

## §5 Required content

A `CLAUDE.md` at the 561 polity root MUST contain:

1. **Session start procedure** — An explicit ordered list of files to read at session start, in priority order. At minimum: SOUL.md, IDENTITY.md, HEARTBEAT.md, MEMORY.md.

2. **Memory policy** — An explicit statement of where memory reads and writes go: the character filestore via the MCP server, not `~/.claude/projects/.../memory/`.

3. **Architecture pointer** — The location of normative specifications (`doing/governing/characters/rom-keldar/governance/rules/specifications/`) and how to use them.

## §6 Recommended content

A `CLAUDE.md` SHOULD contain:

1. **MCP server instruction** — If the character MCP server is configured, an instruction to use its tools for substrate operations.

2. **Key constraints** — 2–5 one-line rules covering what Claude gets wrong most often. These MUST NOT duplicate SOUL.md; they are reminders, not definitions. If a constraint requires explanation, it belongs in SOUL.md.

3. **What this file is not** — A brief note that behavioral constraints, memory, and tools are in the surface files, not here. This prevents CLAUDE.md from growing into a substitute for the surface file system.

## §7 Forbidden content

A `CLAUDE.md` MUST NOT contain:

1. **Domain knowledge** — Project context, key paths, spec listings. These belong in MEMORY.md.
2. **Behavioral constraints** — What the character must and must not do. These belong in SOUL.md.
3. **Task lists** — Current focus items. These belong in HEARTBEAT.md.
4. **Tool inventories** — Available skills and tools. These belong in TOOLS.md.
5. **User profiles** — Who the principal is. These belongs in USER.md.
6. **Linter rules or style guides** — These belong in subdirectory `CLAUDE.md` files or skill records.
7. **Transient state** — Anything that changes session-to-session. CLAUDE.md is read-only and should not require updates more than once per significant substrate restructure.

The test: if removing a line from `CLAUDE.md` and putting it in the appropriate surface file would produce the same behavior, remove it.

## §8 Relationship to surface files

`CLAUDE.md` and the surface files form a two-layer system:

- `CLAUDE.md` is the ignition sequence: short, procedural, tells Claude what to load.
- Surface files are the payload: identity, constraints, context, tools, memory.

`CLAUDE.md` MUST NOT grow to compensate for missing or thin surface files. If something needs to be said, it belongs in the right surface file. `CLAUDE.md` tells Claude to read them.

## §9 Subdirectory CLAUDE.md files

A subdirectory within the polity MAY have its own `CLAUDE.md` for local conventions. Such files MUST NOT re-state polity-root rules; they SHOULD only add directory-specific context (naming conventions for that subtree, local style rules, relevant skill pointers).

## §10 Acceptance criteria

A `CLAUDE.md` is conformant if:

1. It is 300 lines or fewer.
2. It contains an explicit session-start file-reading list.
3. It contains an explicit memory policy.
4. It contains no domain knowledge, behavioral constraints, task lists, or tool inventories.
5. It contains an architecture pointer to the specifications directory.

## §11 What this specification does not decide

- The exact wording or structure of `CLAUDE.md` content beyond the required blocks.
- Whether `CLAUDE.md` is symlinked from `AGENTS.md` or maintained separately.
- How subdirectory `CLAUDE.md` files interact with the root file (Claude Code resolves these by nearest-ancestor lookup).
