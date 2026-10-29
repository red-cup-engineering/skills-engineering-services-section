---
title: "Author observation record of the 561 claude-harness install"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: claude-code-harness-properly-installed
depends-on: [emit-harness-installed-witnesses]
requires-capabilities: [observation-authoring]
theory-basis: [observations-loop, substrate-purity]
---

# Author observation record of the 561 claude-harness install

## Description

Per the [`authoring-an-observation-record`](../../../governance/skills/authoring-an-observation-record.md) skill: an observation is a read-only record of substrate state, not a substrate transition (those are witnesses).
The witness ledger captures *that* the install happened; an observation record explains *what was installed, why, and against what*.
The audit reading the polity later wants both.

Author one observation record under `561/records/` (in the appropriate observations sub-tree — verify the records-directory schema in `561/.pyfars/config.toml` first; per the config the `records/engineering/records/` tree is the active root).
The observation should record:

1. **Subject** — the 561 polity-root, dated.
2. **What was installed** — the four claude-* harnesses by slug; the FARS spec version / `pyfars` package version at install time; the substrate agent record set count and hook record set count read from at install.
3. **Against what substrate** — the substrate-record-set hash (the content-hash tree of `records/engineering/agents/` and `records/engineering/hooks/` at install time) so a future audit can confirm the install matched a known substrate state.
4. **Captured prior state** — pointer to the four manifests' `prior-state` fields.
  The observation does not duplicate the bytes; it points to the manifests.
5. **Open questions surfaced** — at minimum the engine-UDS hook-endpoint migration ([`file-followon-engine-uds-hook-endpoint-migration`](file-followon-engine-uds-hook-endpoint-migration.md)).
  Any other surprises noticed during the install go here.

## Acceptance

- [ ] One observation record exists under the polity-root's records directory naming the install.
- [ ] All five sections above are populated.
- [ ] The observation cross-references the `harness-installed` witnesses by their event-log timestamps.
- [ ] No substrate state is asserted *new* in the observation — it records what is, it doesn't change anything (per [`witness`](../../../concepts/witness.md)'s observation-vs-witness-vs-finding distinction).

## Progress cells

*(empty — task not yet started)*
