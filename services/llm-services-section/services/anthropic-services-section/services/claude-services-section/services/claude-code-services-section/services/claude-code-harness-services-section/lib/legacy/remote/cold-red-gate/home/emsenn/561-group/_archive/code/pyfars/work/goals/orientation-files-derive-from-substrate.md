---
title: "Orientation files derive from substrate"
type: goal
slug: orientation-files-derive-from-substrate
milestone: m1-operational-housekeeping
status: open
horizon: doing
theory-basis: [substrate-purity, harness-as-bidirectional-projection, projection-not-authoring]
tasks:
  - author-orientation-fragment-object-record
  - author-authoring-an-orientation-fragment-skill
  - split-repo-instructions-into-per-runtime-harnesses
  - implement-orientation-fragments-resolver
  - harvest-orientation-fragments-from-existing-substrate
  - rewrite-orientation-templates-as-fragment-consumers
  - install-and-verify-per-runtime-orientation-harnesses
---

# Orientation files derive from substrate

After this goal, the polity-root's agent-orientation files (`CLAUDE.md`, `AGENTS.md`, `README.md`, `replit.md`, `.gitignore`) are derived from substrate by per-runtime harnesses, with no hardcoded discipline prose left in the templates.
A reader auditing what an agent reads on session start can trace every paragraph to a substrate record (a skill, a decision, a norm) — the orientation file is a projection of substrate, not a wall of prose stapled to substrate.

## What changes

**Harness restructure.** The current `repo-instructions` harness — a single harness producing four root files from one templates dir — is dissolved into per-runtime harnesses, each owning the orientation surface for one consumer:

| Harness | Projection target | Consumer |
|---|---|---|
| `claude-code-instructions` (new) | `CLAUDE.md` | Claude Code |
| `agentic` (new) | `AGENTS.md` | Codex, Cursor, Aider, Cline, multi-vendor convention |
| `replit-instructions` (new) | `replit.md` | Replit Agent |
| `repository` (new) | `README.md`, `.gitignore` | GitHub renderer; humans; git itself |
| `repo-instructions` | — | **deleted** |

The split realizes the [`harness`](../../concepts/harness.md) concept's commitment that each harness is one substrate-projection point.
A harness writing for four different runtimes was a packaging convenience that obscured the projection structure; one harness per runtime makes the projection map legible.

**Derivation, not invention.** The existing `CLAUDE.md.j2` template carries hardcoded discipline prose for reading, writing, editing, committing, audit-output discipline, and what-not-to-do.
None of that prose is sourced from substrate; the template *is* the originating source, which inverts substrate-purity.
After this goal, each section's body comes from substrate orientation-fragment records that cite back to the source skill/decision/norm.
Templates own only:

- Section ordering and headings
- Layout (tables, code fences)
- The captain handoff and cross-references
- The harness-generated banner

Section content is `{% for fragment in fragments(topic="reading", runtime="claude-code") %}…{% endfor %}` rendering substrate-authored prose.

## Theory grounding

**Per [`harness`](../../concepts/harness.md)**: a harness is *bidirectional integration projection*.
The orientation harnesses are projection-only (an orientation file's "inbound channel" is the agent reading it; there's no event-back-to-substrate), but the projection-side commitment still applies: every projected file derives from substrate records, with no out-of-substrate authoring path that would let the rendered file diverge from the substrate the polity declares.

**Per [`substrate-purity`](../../governance/decisions/substrate-purity.md)**: the polity's authoring source-of-truth lives in substrate records.
A template that fabricates discipline prose creates a second authoring source (the template's literal text), violating the single-source property.
Routing every paragraph through substrate fragments collapses authoring back to one place.

**Per [`markdown-as-projection`](../../governance/decisions/markdown-as-projection.md)**: `CLAUDE.md` and `AGENTS.md` and `README.md` at the polity-root are *derived* projections, not primary authored files.
The decision already commits to this for `.claude/agents/<slug>.md`; this goal extends the same discipline to the root-level orientation files.

## Why an M1 goal

M1 — Operational Housekeeping — exists to give the autonomous loop a clean substrate foundation.
An autonomous agent reading `CLAUDE.md` on session start consumes whatever is on disk; if that file's content has no substrate audit trail, the agent's behavior is governed by un-versioned, un-cited prose.
Resolving that is structural housekeeping in the precise sense M1 is for: removing hidden authoring sources that would otherwise compound under autonomous operation.

Sister goal under M1:

- [`claude-code-harness-properly-installed`](claude-code-harness-properly-installed.md) brought the four operator-runtime sister harnesses online with proper substrate derivation.
  This goal extends the same discipline to the orientation surface — the *prose* an agent reads, not the *agents/hooks/MCP-config* it executes against.

## Acceptance

- [ ] `tools/platform/pyfars/objects/orientation-fragment.md` exists declaring the orientation-fragment object's frontmatter shape (`topic`, `applies-to-runtimes`, `derives-from`, `prose`, ordering hint).
- [ ] `tools/platform/pyfars/governance/skills/authoring-an-orientation-fragment.md` exists documenting how to author a fragment, what counts as a valid `derives-from` source, and the gerunding-recipe form for the skill itself.
- [ ] `tools/platform/pyfars/src/pyfars/harnesses/repo-instructions/` is deleted; four new harness directories (`claude-code-instructions/`, `agentic/`, `replit-instructions/`, `repository/`) exist with `_index.md` and `templates/`.
- [ ] `install_harness.py` carries a `_load_orientation_fragments(root, topic, runtime)` resolver that walks `prose/orientations/<topic>/` and returns matching fragment dicts to the Jinja context.
- [ ] `561/prose/orientations/<topic>/<slug>.md` carries fragment records harvested from the existing CLAUDE.md.j2 prose (topics include at minimum: `reading`, `writing`, `editing`, `committing`, `audit-output`, `what-not-to-do`, `running-engine`).
- [ ] Each new harness's template is thin: `{% for fragment in fragments(topic, runtime) %}…{% endfor %}` for content sections; layout/captain/banner/cross-refs are template-owned.
- [ ] `pyfars install-harness claude-code-instructions` writes `CLAUDE.md` whose paragraphs are renderings of substrate fragments — verified by a spot-check that any one paragraph cites a real substrate record by its `derives-from`.
- [ ] `pyfars install-harness agentic` writes `AGENTS.md` similarly derived.
- [ ] `pyfars install-harness repository` writes `README.md` and `.gitignore` similarly derived.
- [ ] `pyfars install-harness replit-instructions` writes `replit.md` similarly derived.
- [ ] No regression in unrelated harnesses (`claude-code`, `claude-code-hooks`, `claude-code-mcp`, `claude-agent-sdk-plugin`, `replit`, `codex`, `cline-workflows`, `nix-flake`, `openclaw`).
- [ ] An observation record under `561/work/observations/` records the install of the new orientation harnesses against 561.

## Done when

The captain runs `pyfars install --all` and the polity-root carries `CLAUDE.md`, `AGENTS.md`, `README.md`, `.gitignore`, `replit.md`, each derived from substrate fragments via per-runtime harnesses, with the harness-generated banner naming the regeneration command and no hand-edited discipline prose anywhere in the chain.
