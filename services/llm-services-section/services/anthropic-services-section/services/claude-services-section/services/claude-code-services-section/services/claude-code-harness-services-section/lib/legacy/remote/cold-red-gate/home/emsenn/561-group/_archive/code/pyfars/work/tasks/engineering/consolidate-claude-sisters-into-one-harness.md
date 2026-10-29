---
title: "Consolidate claude-code-* sisters into a single claude harness"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: harness-claude-by-office-assignment
depends-on: [add-claude-code-skills-harness, wire-claude-code-installers-to-office-filter, wire-slash-command-installer-to-captain-office]
requires-capabilities: [pyfars-package-structure, harness-design]
theory-basis: [harness-as-bidirectional-projection]
---

# Consolidate claude-code-* sisters into a single claude harness

## Description

The captain's framing: nobody is ever going to install one of the claude-code-* harnesses without installing the others; splitting them is a packaging artifact, not a meaningful structural distinction.
Collapse the family into one `claude` harness whose install does everything Claude-Code-related at once.

The current sister set:

- `claude-code` — agents → `.claude/agents/`
- `claude-code-hooks` — events → `.claude/hooks/_pyfars-dispatch.sh`, `hooks` block of `.claude/settings.json`
- `claude-code-mcp` — `.mcp.json`
- `claude-code-instructions` — `CLAUDE.md` at polity root
- `claude-agent-sdk-plugin` — slash commands → `.claude/plugins/pyfars-substrate/commands/`
- `claude-code-skills` — skills → `.claude/skills/<slug>/SKILL.md` (planned by sister task `add-claude-code-skills-harness`)

After this task, all six collapse into:

- **`claude`** — owns every projection target above.
  One `_index.md`, one templates set, one install function, one manifest, one office filter applied uniformly.

In `tools/platform/pyfars/src/pyfars/harnesses/`:

1. Create `claude/` with `_index.md` declaring `kind: harness`, `target-default: ".claude"`, `target-runtime: "claude-code"`.
  Body documents the full projection map and the office-filter behavior.
2. Move templates from each sister into `claude/templates/<sub>/` (e.g. `claude/templates/agents/`, `claude/templates/instructions/CLAUDE.md.j2`, etc.) — or keep them at the harness's existing per-sister directories and have the consolidated installer reference them; pick the simpler form during implementation.
3. Delete the six sister directories.

In `install_harness.py`:

4. Author `_install_claude` and `_uninstall_claude` covering everything the six sisters did, applying the office filter (per the goal's other tasks) at the right call-sites.
5. Remove the six sister entries from `_HARNESS_DEFAULT_TARGET`, `_INSTALLERS`, `_UNINSTALLERS`.
6. Add `claude` to those tables.
7. The manifest at `.pyfars/harness-manifests/claude.json` lists every projected file across the full set; uninstall reverses everything in opposite order.

In substrate (561 + pyfars):

8. `governance/harnesses/claude.md` replaces the six existing sister-config records.
9. The `governance/harnesses/<sister>.md` records (claude-code, claude-code-hooks, claude-code-mcp, claude-agent-sdk-plugin) get deleted.
10. Cross-references in concepts/harness.md, prose/explanation/the-install-pipeline.md, README.md, docs/PyFARS_Overview.md updated to name `claude` instead of the sisters.
11. Any agent records' `requires-capabilities:` or `provides-capabilities:` cells citing the sister-harness slugs are updated.

## Why one harness, not a meta-harness wrapping six

A meta-harness preserves the six sisters as installable units that the meta calls.
The captain's argument: nobody calls them individually.
Preserving them costs maintenance (six `_index.md` files, six `_HARNESS_DEFAULT_TARGET` entries, six manifests) for a use case that doesn't exist.
Collapsing to one is the simpler form; the meta-harness shape is what's left over after refactoring out the sisters.

If, in the future, a use case emerges for installing only one sister's projection (for instance, a polity that wants Claude Code's agents but not its hooks), the consolidation can be reversed — but the captain is asserting that case is hypothetical, not real, and we should not pay for it now.

## Acceptance

- [ ] `tools/platform/pyfars/src/pyfars/harnesses/claude/` exists with one `_index.md` and a templates set covering all six sister-projections.
- [ ] The six sister directories are deleted.
- [ ] `pyfars install-harness claude` against 561 produces all the projected files the six sisters used to produce, in `.claude/` and at the polity root.
- [ ] `pyfars install-harness claude --uninstall` reverses every projection cleanly.
- [ ] `.pyfars/harness-manifests/claude.json` exists and lists every projected file.
- [ ] No grep hits for the deleted sister slugs in pyfars source or in 561 substrate (except in archival changelog notes).
- [ ] An observation record under `561/work/observations/` records the consolidation install against 561, with file counts before/after to confirm parity.

## Progress cells

*(empty — task not yet started)*
