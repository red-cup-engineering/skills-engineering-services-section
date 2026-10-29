# Remote-collected Claude-harness prior art

Pulled 2026-07-29 by read-only reconnaissance over every SSH alias in
`~/.ssh/config` (`red-cedar-gate`, `red-cedar-gate.emsenn.net`, `emsenn`, `ops`,
`ops.561.group`, `koios`, `koios.news`, `cold-red-gate`, `emsenn.net`). All of
them resolve to one physical host, `45.76.19.133`, canonical hostname
`cold-red-gate`. Nothing on that host was modified, moved, or deleted; this
directory holds copies only, under `cold-red-gate/` preserving each file's
original absolute path on that machine.

## cold-red-gate/home/emsenn/561-group/_archive/code/pyfars/

The strongest match: a Python "materializer" package. A `claude-code` harness
type-definition
(`src/pyfars/apps/materializer_templates/claude-code/`) projects substrate
records (agents, hooks, MCP config) through Jinja2 templates into
`.claude/agents/`, `.claude/settings.json`, and `.mcp.json`, tracked by
manifest-based install/uninstall
(`.pyfars/harness-manifests/<slug>.json`) with captured prior state for exact
reversal, plus witness emission on install. Core executor:
`harness_materializer.py` / `_harness_sources.py` / `sdk/entities/harness.py`.
Governance skill: `governance/skills/installing-a-harness/SKILL.md`. Its own
work-tracker records show it evolved from four separate "sister" harnesses
(claude-code, claude-code-hooks, claude-code-mcp, claude-agent-sdk-plugin)
into one consolidated harness — the same consolidation shape this collection
effort is repeating one level up, across settlements rather than within one.

An identical live (non-archived) checkout of the same content also exists at
`/home/emsenn/561/theories/.../pyfars` on the same host; only the archived
copy was pulled, since the content is the same.

## cold-red-gate/home/emsenn/561/doing/governing/characters/rom-keldar/governance/skills/

An older, differently-named but conceptually parallel system, predating the
"harness" vocabulary: `authoring-claude-md` and `composing-a-claude-settings-file`
are the same instrument names the local `.claude` backup's
`generating-the-claude-harness` skill (see `../generating-the-claude-harness/`)
names — this is upstream of that one. Also carries `rendering-a-claude`
(Jinja-renders CLAUDE.md from a "character" store into a "theory" root) and
`installing-a-character`. Uses "character"/"theory" vocabulary rather than
"agent"/"harness" but is clearly an ancestor of the same concept.

A byte-identical duplicate of this same skill set also exists at
`/home/emsenn/561-group/lib/561-group/working/governing/founding/library/rom-keldar/governance/skills/`
on the same host; not pulled separately.

## Not collected

`@emsenn/llm-claude-harness`
(`/home/emsenn/561-group/services/llm-claude-harness` on the same host) was
inspected and is genuinely named like a match, but is an MCP-hub server for
wiring `.mcp.json` — transport wiring, not agent/skill/settings projection.
Left in place; not prior art for this section's charter.
