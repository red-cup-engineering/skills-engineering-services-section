---
name: claude harness install at 2026 05 09T0517
observes: polity:561-group
observed-at: "2026-05-09T05:17:42+00:00"
method: harness-manifest-read
value:
  harnesses-installed: 4
  manifest-set:
    - claude-code
    - claude-code-hooks
    - claude-code-mcp
    - claude-agent-sdk-plugin
  agents-projected: 35
  hooks-projected: 6
  mcp-config: http://127.0.0.1:8001/mcp
  plugin-commands: 5
baseline: ⊥
scale: nominal
status: settled
---

A read of the substrate's polity-installed-harness state immediately after the [`claude-code-harness-properly-installed`](../../tools/platform/pyfars/work/goals/claude-code-harness-properly-installed.md) goal's Phase-0 install landed end-to-end. Per [`authoring-an-observation-record`](../../tools/platform/pyfars/work/governance/skills/authoring-an-observation-record.md), this is a hand-authored observation — not emitted by a tracking morphism — capturing what was installed, against what substrate, by whom, with what gaps surfaced. It does not assert any new substrate state; it points to what is already on disk.

## What was installed

Four sister harnesses, all under `pyfars` package at commit [`a464d89`](https://github.com/emsenn/pyfars) (`2026.05.09+lantern`), against substrate at 561 commit `24e742ce`:

| Harness | Manifest | Installed-at | Projected |
|---|---|---|---|
| `claude-code` | [`claude-code.json`](../../.pyfars/harness-manifests/claude-code.json) | 2026-05-09T05:17:42Z | 35 agents from `work/governance/agents/` → `.claude/agents/` |
| `claude-code-hooks` | [`claude-code-hooks.json`](../../.pyfars/harness-manifests/claude-code-hooks.json) | 2026-05-09T05:17:42Z | 6 hook events into `.claude/settings.json` + the single dispatcher shim at `.claude/hooks/_pyfars-dispatch.sh` |
| `claude-code-mcp` | [`claude-code-mcp.json`](../../.pyfars/harness-manifests/claude-code-mcp.json) | 2026-05-09T05:17:43Z | `.mcp.json` with HTTP transport `{"type":"http","url":"http://127.0.0.1:8001/mcp"}` plus the `enabledMcpjsonServers` block in `.claude/settings.json` |
| `claude-agent-sdk-plugin` | [`claude-agent-sdk-plugin.json`](../../.pyfars/harness-manifests/claude-agent-sdk-plugin.json) | 2026-05-09T04:28:21Z | 5 PyFARS verbs as slash-command plugin files under `.claude/plugins/pyfars-substrate/commands/` |

The `claude-agent-sdk-plugin` install timestamp is the earlier, pre-version-fix install; its projection is unaffected by the `2026.5.9.lantern → 2026.05.09+lantern` PEP-440 fix and was never re-installed.

## Against what substrate

Substrate-source set hashed at install time:

- **35 agent records** under `work/governance/agents/*.md` (per the post-RFC §5.1 layout — [`authoring-a-substrate-agent-record`](../../tools/platform/pyfars/work/governance/skills/authoring-a-substrate-agent-record.md)).
- **6 hook records** under `records/engineering/hooks/*.md` (`claude-session-start`, `claude-user-prompt-submit`, `claude-pre-tool-use`, `claude-post-tool-use`, `claude-post-tool-use-failure`, `claude-session-stop`) carrying the bilattice axes the dispatcher reads at hook-fire time.
- **1 MCP website-asset** at [`work/governance/assets/computing/web/pyfars-mcp/pyfars-mcp.md`](../../work/governance/assets/computing/web/pyfars-mcp/pyfars-mcp.md) declaring `kind: website, service-kind: mcp, default-host: 127.0.0.1, default-port: 8001` — the `claude-code-mcp` harness reads this at install time to project the HTTP `.mcp.json`.

Substrate-record content-hashes: not yet computed at install time. The harness-manifest object record names captured-prior-state by content-hash, but the substrate-source-set hash is not yet a manifest field. Future work; not blocking.

## Captured prior state

Each manifest's `prior-state` field (where present) records bytes-on-disk before the install overwrote: empty for first installs, populated for the `claude-code-mcp` re-install since `.mcp.json` already had the prior stdio-transport entry. The full bytes are kept inline in the manifest for invertibility per [`harness-manifest`](../../tools/platform/pyfars/objects/harness-manifest.md).

## Open questions surfaced during install

Three engineering gaps surfaced through the install pipeline. All are filed and tracked:

1. **Engine-UDS hook-endpoint migration.** The current [`pyfars hook-dispatch`](../../tools/platform/pyfars/src/pyfars/cli/hook_dispatch.py) writes the polity image directly. The target shape (HTTP POST to engine UDS) is filed at [`migrate-hook-dispatch-to-engine-uds-post`](../../tools/platform/pyfars/doing/working/hacking/doing/working/planning/library/task/library/engineering/migrate-hook-dispatch-to-engine-uds-post.md) under [`engine-runs-as-supervised-service`](../../tools/platform/pyfars/work/goals/engine-runs-as-supervised-service.md) (M3).

2. **Dangling skill references in agent records.** Multiple `work/governance/agents/*.md` records list `skills:` slugs that don't resolve to `work/governance/skills/<slug>.md` files — e.g. `assess-page`, `evaluate-slop`, `audit-content-folders`. The harness install ignores them; the dispatch eligibility-by-skills closure rule will surface them as `⊥` cells. Pre-existing substrate-hygiene work, out of scope for the harness goal.

3. **Cline-workflows install path.** The `cline-workflows` harness expects runbook records at `records/engineering/runbooks/` with `kind: runbook` frontmatter. 561 has no such records; the harness fails to install. Bailed the `make install` loop mid-stride, which is why `claude-agent-sdk-plugin` had to be re-installed manually. Either `make install` should tolerate per-harness failure (continue the loop, summarize at the end) or 561 should author runbook records to satisfy the harness contract — open structural choice, not yet filed.

## Cross-references

- Lifecycle witnesses for the four installs: see [`pyfars/cli/install_harness.py:_emit_lifecycle_witness`](../../tools/platform/pyfars/src/pyfars/cli/install_harness.py); landing on-disk under [`records/engineering/records/events/2026-05-09.jsonl`](../../records/engineering/records/events/2026-05-09.jsonl) with `operator: harness_installed`, `channel: install`, `origin: pyfars-install-harness`.
- Round-trip hook witnesses confirming the inbound channel works: same event log, `origin: claude-code-hooks`, with `operator: tool_use_intended` (PreToolUse, evidence=0.5) and `tool_use_succeeded` (PostToolUse, default truth=1.0 evidence=1.0).
- Substrate-purity discipline preserved: every projected file is derived from a substrate record, the manifest is the runtime-installer's authority not a substrate-authoring source, hand-edits to `.claude/` will be overwritten on next install. See [`markdown-as-projection`](../../tools/platform/pyfars/work/governance/decisions/markdown-as-projection.md), [`substrate-purity`](../../tools/platform/pyfars/work/governance/decisions/substrate-purity.md).
