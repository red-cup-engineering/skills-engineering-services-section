"""Harness records — system→external-runtime projection definitions.

A *harness record* declares, in its ``_index.md`` frontmatter, what
system cells a polity-authored materializer queries, which templates
it renders, where the rendered files go, and how the manifest is
recorded — so materialization is a generic operation against the
declaration, not a per-runtime Python pair.

The matching program-frame class is
:class:`pyfars.programs.materializer.MaterializerProgram` (and its
``ServiceMaterializerProgram`` subclass when supervisor handoff is
needed). The materializer reads the harness record's emit rules and
acts against the declaration — the system IS the dispatch table.

Template sets live under
``pyfars/apps/materializer_templates/<name>/templates/<file>.j2``.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


EmitMode = Literal["per-record", "aggregate", "merge-json"]
"""How a harness emit rule composes its output.

- ``per-record`` — iterate source records, render the template once
  per record, write one output file per record.
- ``aggregate`` — render the template once with all source records in
  scope (plus context providers); write a single output file.
- ``merge-json`` — like ``aggregate`` but the rendered output is
  parsed as JSON and merged into the existing target file under the
  declared keys, preserving any keys outside our scope (used for
  ``settings.json``-style files where the user owns most of the
  document).
"""


class HarnessEmit(BaseModel):
    """One emit rule on a harness — what to render and where to write."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    source: str | None = None
    """Source kind. The name of an entity discovery function in the
    against context providers only (no per-record iteration)."""

    source_args: dict[str, Any] = Field(
        default_factory=dict, alias="source-args",
    )
    """Keyword arguments passed to the source discovery function. Path
    arguments are interpreted as relative to the directory root."""

    template: str
    """Template filename relative to ``<harness>/templates/``. Rendered
    with Jinja2 (StrictUndefined)."""

    target_pattern: str = Field(alias="target-pattern")
    """Output path relative to the install target. A format string with
    substitutions drawn from the source record (per-record mode) or
    fixed (aggregate mode). A leading ``/`` makes the path relative
    to the directory root instead of the install target — used for
    artifacts (helper scripts, manifests) that don't belong inside the
    runtime-specific projection directory. Examples:

      - ``"AGENTS.md"`` (aggregate, target-relative)
      - ``"{prefix}{pack}-{slug}/SKILL.md"`` (per-record from skill
        packs; ``prefix`` from installer arg, ``pack``/``slug`` from
        the record's fields)
      - ``"/.pyfars/cline-witness.sh"`` (aggregate, root-relative)
    """

    mode: EmitMode = "per-record"

    executable: bool = False
    """When True, chmod the rendered output 0755 after write. For
    helper scripts the harness emits."""

    context: list[str] = Field(default_factory=list)
    """Additional context providers injected into template scope.
    Currently supported: ``"orientation"`` (polity/captain/ship/
    theory roll-up), ``"polity-counts"`` (skill / agent / verb totals).
    """

    merge_keys: list[str] = Field(
        default_factory=list, alias="merge-keys",
    )
    """For ``merge-json`` mode: the top-level JSON keys this emit rule
    owns. Existing keys outside this list are preserved on merge;
    keys inside are replaced with the rendered content."""


class Harness(BaseModel):
    """One harness record — system→external-runtime projection."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    slug: str
    title: str = ""
    description: str = ""
    status: str = "active"

    target_default: str = Field(default=".", alias="target-default")
    """Default target directory relative to directory root."""

    target_runtime: str | None = Field(default=None, alias="target-runtime")
    """Runtime tag identifying the consumer ecosystem (e.g.
    ``"claude-code"``, ``"replit-agent"``)."""

    runtime: str | None = None
    """Alias for :attr:`target_runtime` accepted in some harness
    records. :attr:`effective_runtime` resolves the canonical value."""

    manifest: str | None = None
    """Manifest output path relative to directory root. Defaults to
    ``.pyfars/harness-manifests/<name>.json`` via
    :attr:`effective_manifest_path`."""

    emits: list[HarnessEmit] = Field(default_factory=list)
    """Emit rules — the projection's actual content. A harness with no
    emit rules is a structural placeholder (declaration only)."""

    body: str = ""

    @property
    def name(self) -> str:
        """The bare harness name (e.g. ``"codex"`` from ``"harness:codex"``)."""
        if self.slug.startswith("harness:"):
            return self.slug[len("harness:"):]
        return self.slug

    @property
    def effective_runtime(self) -> str | None:
        return self.target_runtime or self.runtime

    @property
    def effective_manifest_path(self) -> str:
        if self.manifest:
            return self.manifest
        return f".pyfars/harness-manifests/{self.name}.json"


__all__ = [
    "EmitMode",
    "Harness",
    "HarnessEmit",
]
