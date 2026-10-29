---
title: "Install and verify per-runtime orientation harnesses against 561"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: orientation-files-derive-from-substrate
depends-on: [rewrite-orientation-templates-as-fragment-consumers]
requires-capabilities: [pyfars-runtime, harness-installation, observation-authoring]
theory-basis: [witness-as-increment, observation-as-value-recognition]
---

# Install and verify per-runtime orientation harnesses against 561

## Description

After the harness split, fragments resolver, harvested fragments, and rewritten templates are in place, install each new orientation harness against the 561 polity and verify the outputs.
This is the end-to-end correctness check for the goal — the captain reads the rendered files and they make sense as agent-orientation surfaces.

Steps:

1. From `561/`, run:
   ```bash
   pyfars install-harness claude-code-instructions
   pyfars install-harness agentic
   pyfars install-harness repository
   pyfars install-harness replit-instructions
   ```
2. Confirm the polity-root carries `CLAUDE.md`, `AGENTS.md`, `README.md`, `.gitignore`, `replit.md`, each with the harness-generated banner naming the regeneration command.
3. Spot-check three claims:
   - **Substrate audit trail.** Pick one paragraph in the rendered `CLAUDE.md` and trace it to its source: it should appear in a fragment under `561/prose/orientations/<topic>/<slug>.md` whose `derives-from:` points to a real source record.
   - **Per-runtime specialization.** Pick a fragment with `applies-to-runtimes: ["claude-code"]` and confirm it appears in `CLAUDE.md` but NOT in `AGENTS.md`.
   - **Cross-runtime sharing.** Pick a fragment with `applies-to-runtimes: ["*"]` and confirm it appears in both `CLAUDE.md` and `AGENTS.md` (subject to template-owned section ordering).
4. Confirm the four `.pyfars/harness-manifests/<harness>.json` files exist with proper `harness-installed` witnesses on the event log.
5. Confirm `pyfars install-harness <harness> --uninstall` reverts cleanly, restoring captured prior state.
6. Author an observation record at `561/work/observations/orientation-harnesses-installed-at-<timestamp>.md` per the [`authoring-an-observation-record`](../../../governance/skills/authoring-an-observation-record.md) skill — what was installed, against what substrate, with what fragment coverage, surfacing any gaps.

The observation record's `value:` block should at minimum carry:

- `harnesses-installed: 4`
- `manifest-set: [claude-code-instructions, agentic, repository, replit-instructions]`
- `topics-covered: [reading, writing, ...]
  `
- `fragments-rendered-per-topic: {...}
  ` — count by topic
- `gaps:` — list of topics where no fragments were authored despite the template loop running

## Acceptance

- [ ] `561/CLAUDE.md`, `561/AGENTS.md`, `561/README.md`, `561/.gitignore`, `561/replit.md` exist after the install pass.
- [ ] Each carries the harness-generated banner with the correct regeneration command.
- [ ] The three spot-checks (audit trail, per-runtime specialization, cross-runtime sharing) pass.
- [ ] Manifest files exist; uninstall is clean.
- [ ] An observation record is on disk at `561/work/observations/`.
- [ ] No regression in the previously installed harnesses (`claude-code`, `claude-code-hooks`, `claude-code-mcp`, `claude-agent-sdk-plugin`) — they continue to work; their projected files remain.

## Progress cells

*(empty — task not yet started)*
