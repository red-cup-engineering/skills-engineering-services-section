---
title: "Harness Claude by office assignment"
type: goal
slug: harness-claude-by-office-assignment
milestone: m1-operational-housekeeping
status: open
horizon: doing
theory-basis: [normative-operational-layering, eligibility-by-office, harness-as-bidirectional-projection]
tasks:
  - extend-office-record-with-exposes-fields
  - author-claude-model-record-in-561
  - author-claude-default-office-record
  - author-or-confirm-captain-office-record
  - implement-office-resolver-in-installer
  - add-claude-code-skills-harness
  - wire-claude-code-installers-to-office-filter
  - wire-slash-command-installer-to-captain-office
  - consolidate-claude-sisters-into-one-harness
---

# Harness Claude by office assignment

After this goal, what gets projected into a Claude Code session — agents, skills, slash commands — is determined by **office assignment** in substrate, not by blanket copy.
Claude (the model) holds an office; the captain holds a different office; each office's `exposes-*:` cells declare which substrate items the office's holder gets to use.
The harness reads those cells and projects accordingly.
A change to the office record changes the projection.

## Why this is load-bearing

The current bridge between PyFARS and Claude Code is structurally one-way and undiscriminating: every agent under `governance/agents/` becomes a `.claude/agents/<slug>.md` file regardless of whether *this* Claude session should be using *that* agent.
Same for the SDK plugin's slash commands.
Skills aren't projected to Claude at all — `.claude/skills/<name>/SKILL.md` is supported by Claude Code but no PyFARS harness writes there.
The result is a Claude session that has access to the polity's full agent roster (overwhelming, undiscriminated) but none of the polity's skill records (despite skills being the third rung of the formality progression).

The captain's framing names the shape of the fix:

- **Claude (the model) holds a default office.** That office declares which agents/skills/tools/etc. a Claude session is authorized to invoke.
  The harness projects only those.
- **The captain holds a different office (their own).** Slash commands — what *the captain* invokes during a Claude session — are projected from the captain's office's `exposes-commands:` set, not Claude's.
- **Office-as-substrate-cell** is what makes "what's available" auditable.
  Today the answer is "everything"; under this goal, the answer is "what office X declares."

This bridges the polity's substrate-of-skills/agents/tools with Claude's session surface in a substrate-discriminating way — addressing the captain's stated "biggest failure to harness you is bridging your agents and skills with ours."

## Theory grounding

**Per [`eligibility-by-office`](../../objects/eligibility-by-office.md)** (or whichever office-eligibility cell exists in the dispatch closure-rule-system): an office is the substrate-side authoritative declaration of what the office-holder is authorized to do.
The harness's projection is just the runtime-side realization of that authorization at session-start time.

**Per [`harness`](../../concepts/harness.md)**: a harness is bidirectional — outbound projection AND inbound witness.
A harness that projects everything regardless of authorization is *not* substrate-pure on the outbound side: the projection diverges from the substrate's authorization graph the moment the substrate adds an unauthorized agent.
Office-filtered projection collapses that divergence.

**Per [`normative-operational-layering`](../../claims/normative-operational-layering.md)**: the polity's operational layer (agents, skills, tools) is *governed by* the normative layer (offices, duties, powers, jurisdictions).
Skipping the normative layer in projection puts the operational layer downstream of nothing — the projection is the only filter, and it's no filter at all.

## What changes

**Schema side:**

1. The office-record schema in `pyfars/objects/office-record.md` gains `exposes-skills:`, `exposes-agents:`, `exposes-commands:` fields.
  Each is a list of slugs the office's holder may invoke / has projected for them at session-start.
2. The model-record schema (under `pyfars/objects/`, or the existing `governance/assets/computing/models/` shape if substrate-side) gains a `holds-office:` field naming the model's default office.

**Substrate side (in 561):**

3. A `governance/assets/computing/models/claude.md` record exists declaring `holds-office: claude-default` (or similar).
4. A `governance/offices/claude-default.md` office record exists with curated `exposes-skills:`, `exposes-agents:`, `exposes-commands:` lists.
5. The captain's existing office record (under `governance/offices/`) is confirmed or extended to carry `exposes-commands:` for the slash-command projection.

**Code side (in pyfars):**

6. `install_harness.py` carries `_resolve_office(root, office_slug)` returning the exposed skills/agents/commands for the office.
7. `_install_claude_code` (agents) filters its agent-set by Claude's assigned office.
8. A new sister harness `claude-code-skills` projects substrate skills (filtered by Claude's office) into `.claude/skills/<slug>/SKILL.md`.
9. The slash-command installer (`claude-agent-sdk-plugin`, or a new `claude-code-commands` harness, depending on which surface is right) projects only the captain's exposed commands.
10. **Consolidation, not bundling.** The six sister harnesses (`claude-code`, `claude-code-hooks`, `claude-code-mcp`, `claude-code-instructions`, `claude-code-skills`, `claude-agent-sdk-plugin`) collapse into one `claude` harness owning every Claude-Code-projection target.
  Per the captain's call: nobody installs one without the others, so splitting them is packaging cost without operational benefit.
  The consolidation supersedes the earlier "meta-harness bundles the sisters" idea — there are no sisters to bundle after, just one harness.

## Acceptance

- [ ] Office-record schema in [`pyfars/objects/office-record.md`](../../objects/office-record.md) carries `exposes-skills:`, `exposes-agents:`, `exposes-commands:` fields.
- [ ] `561/governance/assets/computing/models/claude.md` exists declaring `holds-office: claude-default` (or the agreed-on office slug).
- [ ] `561/governance/offices/claude-default.md` exists with curated `exposes-*:` lists.
- [ ] The captain's office record carries `exposes-commands:`.
- [ ] `_resolve_office(root, office_slug)` exists in `install_harness.py` returning the exposed sets.
- [ ] `pyfars install-harness claude-code` against 561 projects only the agents the `claude-default` office authorizes, not the polity's full agent roster.
- [ ] A new `claude-code-skills` harness exists; `pyfars install-harness claude-code-skills` writes `.claude/skills/<slug>/SKILL.md` for each office-authorized substrate skill.
- [ ] Slash commands projected by `pyfars install-harness claude-agent-sdk-plugin` (or its successor) reflect the captain's office's `exposes-commands:` set.
- [ ] `pyfars install-harness claude` produces every Claude-Code projection target the six former sisters used to produce; `pyfars install-harness claude --uninstall` reverses cleanly.
  The six sister harness directories are deleted.
- [ ] An observation record under `561/work/observations/` records the office-filtered install of the claude meta-harness against 561, with explicit counts of agents-projected, skills-projected, commands-projected, plus the office citations the projector consulted.

## Done when

The captain runs `pyfars install-harness claude` against 561 and the resulting `.claude/` carries exactly the agents/skills/commands the substrate's office records authorize — no more, no less.
A change to the `claude-default` office's `exposes-skills:` list and a re-install changes the `.claude/skills/` set; a change to the captain's `exposes-commands:` and a re-install changes the slash-command set.
