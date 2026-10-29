---
title: "Author the harness-manifest object record"
type: task
area: engineering
status: open
horizon: captured
milestone: m1-operational-housekeeping
goal: claude-code-harness-properly-installed
depends-on: []
requires-capabilities: [substrate-authoring, frontmatter-design]
theory-basis: [substrate-purity, witness-as-increment]
---

# Author the harness-manifest object record

## Description

The [`harness`](../../../concepts/harness.md) concept page already references "harness-manifest" — "Polity-side, the [harness-manifest](../objects/harness-manifest.md) records which harnesses are *installed* in this polity-root and what their per-instance configuration is" — but no `objects/harness-manifest.md` file exists.
The reference is dangling.

Author `tools/platform/pyfars/objects/harness-manifest.md` declaring the object record's frontmatter shape.
Schema (cross-checked against the four sister harnesses' actual emit shape — see e.g. `src/pyfars/harnesses/claude-code-hooks/_index.md`):

```yaml
---
type: object
slug: harness-manifest
status: draft
realizes: [harness-as-installed-projection]
depends-on: [harness, projection]
---
```

Body sections (mirroring sibling object records like `objects/skill-record.md`):

1. **What it carries.** harness-slug, install-timestamp, projector-version, target-default, projected-files (each with: relative path, content-hash, source-substrate-record-path), captured-prior-state (the bytes of any non-empty target file the install overwrote, for exact uninstall-restore), uninstall-discipline (containment-checked path resolution refusing `..
  ` traversal — already implemented across the four harnesses).
2. **Where it lives on disk.** `<polity-root>/.pyfars/harness-manifests/<harness-slug>.json`.
  JSON, not markdown — the manifest is read by the installer/uninstaller, not by humans browsing the corpus.
3. **Relation to substrate.** The manifest is a *projection*-of-installed-state, not a substrate cell on its own.
  The substrate cell that records the install lives on the JSONL event log (the `harness-installed` witness).
  The manifest exists for the installer; the witness exists for the substrate.
4. **What the manifest is NOT.** It is not a substrate-authoring source.
  Hand-editing the manifest will not change what the installer produces on next install; the harness type-definition (`src/pyfars/harnesses/<name>/`) and the substrate records are the source.
  Hand-editing the manifest only confuses `--uninstall`.

## Acceptance

- [ ] `tools/platform/pyfars/objects/harness-manifest.md` exists with the frontmatter shape above and the four body sections.
- [ ] The `concepts/harness.md` cross-reference resolves (no longer dangling).
- [ ] At least one of the four claude-* harness `_index.md` files is updated to cite `objects/harness-manifest.md` for its manifest description.
- [ ] No regression in the existing harness install behaviour — this is documentation; behaviour is unchanged.

## Progress cells

*(empty — task not yet started)*
