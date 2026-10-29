---
type: object
slug: harness-manifest
status: draft
realizes: [harness-as-installed-projection]
depends-on: [harness, projection, content-hash, jsonl-event-log]
---

# Harness manifest

The polity-side record of a single installed [harness](../concepts/harness.md): what files this harness installation projected into this polity, against which substrate sources, and what bytes were captured prior to overwrite so that `--uninstall` can restore the polity exactly.
One manifest per installed harness; the manifest is the installer/uninstaller's authority, not the system's.

## What it carries

Per-installation cells:

- **`harness-slug`** — the harness type's slug (e.g. `claude-code`, `claude-code-hooks`, `claude-code-mcp`, `claude-agent-sdk-plugin`).
  Identifies which harness-type definition under `src/pyfars/harnesses/<slug>/` produced this projection.
- **`install-timestamp`** — ISO-8601 UTC timestamp of the install.
  Pairs with the `harness-installed` witness on the JSONL event log.
- **`projector-version`** — the `pyfars` package version at install time.
  Lets a future audit reason about projection-shape drift between installer-versions.
- **`target-default`** — the harness type's declared default target directory (e.g. `.claude` for `claude-code`, `.mcp.json` for `claude-code-mcp`).
  The realized target may differ if the install was given a non-default `--target`; both are recorded.
- **`projected-files`** — list, one entry per file the install wrote.
  Each entry carries:
  - `path` — relative to polity-root.
  - `content-hash` — [content-hash](content-hash.md) of the bytes written.
  - `source-substrate-record-path` — relative path to the system record from which the file was projected (e.g. `records/engineering/agents/<slug>.md`).
    Empty for files projected from the harness type's templates only (no per-record source).
- **`captured-prior-state`** — list, one entry per non-empty target file the install overwrote.
  Each entry carries:
  - `path` — relative to polity-root.
  - `content-bytes` — the full prior bytes (base64-encoded for the JSON manifest), or a pointer to a sidecar file containing the bytes.
  - `content-hash` — content-hash of the captured bytes.
    Empty means the install wrote only previously-empty paths; `--uninstall` need only delete.
- **`uninstall-discipline`** — record of the path-resolution rules the installer applied.
  The current realization refuses `..
  ` traversal and any path resolving outside the declared target; this is captured per-install so that a manifest-driven uninstall can reject any later attempt to restore files outside the target boundary the installer accepted.

## Where it lives on disk

```
<polity-root>/.pyfars/harness-manifests/<harness-slug>.json
```

JSON, not markdown.
The manifest is read by the installer/uninstaller, not by humans browsing the corpus.
The path is fixed: one manifest per harness slug per polity.
Re-installing replaces the manifest; uninstalling deletes it (after restoring the captured prior state).

## Relation to the system

The manifest is a *projection-of-installed-state*, not a system cell on its own.
Two layers separate:

- **Substrate layer.** The system cell that *records* the install lives on the JSONL event log as a `harness-installed` witness with `harness-slug`, `install-timestamp`, `projected-files-count`, and a content-hash of the manifest itself.
  The witness is canonical; the manifest is derivative.
- **Installer layer.** The manifest exists for `pyfars install-harness` and `pyfars install-harness --uninstall`.
  The installer needs every projected path, every captured prior byte, and the uninstall discipline to do its job; the substrate doesn't.

The witness names *that* an install happened; the manifest names *exactly what* it projected.
The two together let an audit answer both kinds of question.

## What the manifest is NOT

It is not a substrate-authoring source.
Hand-editing the manifest will not change what the installer produces on the next install:

- The harness *type-definition* (`src/pyfars/harnesses/<slug>/`) and the *system records* it reads (e.g. `records/engineering/agents/`, `records/engineering/hooks/`) are the source of truth for the projection.
- The manifest is a *result* of running the projector against those sources at install time.
- Hand-editing the manifest only confuses `--uninstall` — at worst, an editor who removes a `projected-files` entry causes a future uninstall to leave a real file behind; an editor who corrupts a `captured-prior-state` entry causes a future uninstall to write wrong bytes back.

The manifest is also not a system cell.
It does not appear in the predication graph; it is not closed-over by closure rules; it is not picked up by the substrate scan.
It lives outside `records/` for that reason.

## Discussion

The manifest is the load-bearing artifact behind two of the five harness commitments named in [`harness`](../concepts/harness.md):

- **Manifest-tracked install.** Every projected file is named in the manifest; nothing is written outside the manifest's record.
  This is what makes a harness install *invertible*.
- **Captured prior state.** The bytes the install overwrote are kept so that `--uninstall` can restore exactly.
  Without this, uninstall is destructive — it deletes the harness's projections but cannot bring back what was there before.

The choice to keep the manifest as JSON-under-`.pyfars/` rather than as a system cell follows [substrate-purity](../governance/decisions/substrate-purity.md): substrate is a pure abstract medium, and the manifest is a runtime-installer concern.
The witness is the system's record of the install; the manifest is the runtime's record.
The two stay separate.
