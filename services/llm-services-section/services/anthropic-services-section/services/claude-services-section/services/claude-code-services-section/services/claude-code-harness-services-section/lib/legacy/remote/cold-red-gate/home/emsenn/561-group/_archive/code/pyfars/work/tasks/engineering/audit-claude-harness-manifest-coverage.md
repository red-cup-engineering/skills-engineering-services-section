---
title: "Audit claude-harness manifest coverage of every projected file"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: claude-code-harness-properly-installed
depends-on: [install-four-claude-sister-harnesses]
requires-capabilities: [substrate-audit, file-inventory]
theory-basis: [substrate-purity]
---

# Audit claude-harness manifest coverage of every projected file

## Description

The harness-manifest's load-bearing property is *containment*: every file the harness wrote is in the manifest, every file in the manifest is on disk, and `--uninstall` removes exactly that set with no orphans and no over-deletion.
After Phase C, we audit this property concretely.

For each of the four claude-* harnesses installed:

1. Read its manifest at `.pyfars/harness-manifests/<harness>.json` and collect the list of projected files.
2. Walk the harness's target directory (`.claude/` for the first three, `.claude/plugins/pyfars-substrate/` for the SDK plugin, and `/.mcp.json` at root for MCP).
3. Compute the symmetric difference.
  The manifest set should equal the on-disk set:
   - Files on disk not in manifest → orphans (a previous install left them, or a hand-edit slipped in).
     Surface and decide: hand-delete or re-list.
   - Files in manifest not on disk → corruption (something was deleted out-of-band).
     Surface and decide: re-install, or remove from manifest.
4. Run `pyfars install-harness --uninstall <harness>` against a *throwaway* polity (or a checkout sibling) to confirm the manifest's prior-state-capture restores `.claude/settings.json` exactly when the harness is uninstalled while another harness still has settings in it (this is the load-bearing case the `claude-code-hooks` harness specifically advertises supporting).

## Acceptance

- [ ] For each of the four harnesses, the manifest set == the on-disk set under the harness's target.
- [ ] `--uninstall` of any single harness leaves the other three's projections intact.
- [ ] `--uninstall` of all four leaves `.claude/`, `.mcp.json`, and `.pyfars/harness-manifests/` either empty or absent (mirroring the pre-install state).
- [ ] Any orphan file found is either listed in the appropriate manifest (re-install) or removed (cleanup), with a one-line rationale recorded under "Progress cells".

## Progress cells

*(empty — task not yet started)*
