"""Generic harness materializer — execute one harness's emit rules.

A *harness* (:class:`pyfars.sdk.entities.Harness`) declares in its
``_index.md`` what substrate sources its rules iterate, which Jinja2
templates render the output, where the rendered bytes go, and how
multi-document outputs compose. This module is the executor: load the
harness record, walk its emit rules against the polity's system, render
each template, write the bytes, write a manifest.

The substrate IS the dispatch table — adding a new harness is authoring
``pyfars/apps/materializer_templates/<name>/_index.md`` + templates,
not adding Python here.

The matching CLI verb is ``pyfars materialize <slug>`` (see
:mod:`pyfars.apps.cli.materialize`).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from importlib import resources
from pathlib import Path
from typing import Any, ClassVar, Mapping

import yaml
from jinja2 import ChainableUndefined
from jinja2.exceptions import TemplateError

from pyfars.sdk.entities.harness import Harness, HarnessEmit
from pyfars.programs.materializer import (
    MaterializerEmission, MaterializerProgram, MaterializerResult,
    materializer_jinja_env,
)
from pyfars.programs._harness_sources import resolve_context, resolve_source


_TEMPLATE_PKG = "pyfars.apps.materializer_templates"


class HarnessLoadError(Exception):
    """Raised when a harness slug doesn't resolve to a packaged record."""


def list_harnesses() -> list[str]:
    """Every harness name shipped under ``pyfars.apps.materializer_templates``."""
    root = resources.files(_TEMPLATE_PKG)
    out: list[str] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if child.name.startswith("_") or child.name.startswith("."):
            continue
        if not (child / "_index.md").is_file():
            continue
        out.append(child.name)
    return sorted(out)


def load_harness(name: str) -> Harness:
    """Load a harness record from its packaged ``_index.md`` frontmatter."""
    pkg = resources.files(_TEMPLATE_PKG) / name
    index = pkg / "_index.md"
    if not index.is_file():
        raise HarnessLoadError(
            f"no harness {name!r} under {_TEMPLATE_PKG} "
            f"(available: {list_harnesses()})"
        )
    text = index.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise HarnessLoadError(
            f"harness {name!r} _index.md lacks YAML frontmatter"
        )
    end = text.find("\n---", 4)
    if end == -1:
        raise HarnessLoadError(
            f"harness {name!r} _index.md frontmatter is unterminated"
        )
    fm = yaml.safe_load(text[4:end]) or {}
    if not isinstance(fm, dict):
        raise HarnessLoadError(
            f"harness {name!r} frontmatter must be a YAML mapping"
        )
    fm.setdefault("slug", f"harness:{name}")
    return Harness(**fm)


def _format_target(
    pattern: str, *, prefix: str, record: dict[str, Any] | None = None,
) -> str:
    fields: dict[str, Any] = {"prefix": prefix}
    if record is not None:
        fields.update(record)
    return pattern.format(**fields)


def _resolve_out_path(
    formatted: str, *, target: Path, root: Path,
) -> Path:
    if formatted.startswith("/"):
        return root / formatted.lstrip("/")
    return target / formatted


def _merge_json(
    existing: Any, rendered: Any, merge_keys: list[str],
) -> Any:
    if not isinstance(existing, dict) or not isinstance(rendered, dict):
        return rendered
    if not merge_keys:
        return rendered
    out = dict(existing)
    for k in merge_keys:
        if k in rendered:
            out[k] = rendered[k]
        elif k in out:
            del out[k]
    return out


def _records_context_key(source: str | None) -> str:
    """Plural Jinja variable name for an aggregate rule's source list.

    ``"agent-records"`` → ``"records"`` (already plural).
    ``"skills"`` → ``"skills"``. ``None`` → ``"records"``.
    """
    if source is None:
        return "records"
    return source.replace("-", "_")


class HarnessMaterializerProgram(MaterializerProgram):
    """One-shot program that materializes one harness against a system.

    Set :attr:`harness_slug` either via subclass-level constant or via
    constructor. The base ``MaterializerProgram.run`` drives the
    lifecycle (validate → boot → materialize → write → witness → halt);
    this class supplies the harness-record-driven ``materialize``.
    """

    harness_slug: ClassVar[str] = ""

    def __init__(
        self,
        root: Path,
        *,
        harness_slug: str | None = None,
        prefix: str = "pyfars-",
    ) -> None:
        super().__init__(root)
        slug = harness_slug or self.harness_slug
        if not slug:
            raise ValueError(
                "HarnessMaterializerProgram requires harness_slug"
            )
        self.harness = load_harness(slug)
        self.materializer_slug = f"harness:{self.harness.name}"
        self.prefix = prefix
        self._executable_paths: set[Path] = set()

    def materialize(self, system) -> Mapping[Path, bytes]:
        harness = self.harness
        env = materializer_jinja_env(harness.name)
        env.undefined = ChainableUndefined
        env.keep_trailing_newline = True

        target = self.root / harness.target_default
        generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

        emissions: dict[Path, bytes] = {}
        manifest_entries: list[dict[str, Any]] = []

        for emit in harness.emits:
            self._materialize_emit(
                emit=emit,
                env=env,
                system=system,
                target=target,
                generated_at=generated_at,
                emissions=emissions,
                manifest_entries=manifest_entries,
            )

        manifest_path = self.root / harness.effective_manifest_path
        manifest = {
            "harness": harness.name,
            "installed-at": generated_at,
            "target": str(target.relative_to(self.root))
                      if target.is_relative_to(self.root) else str(target),
            "files": manifest_entries,
        }
        emissions[manifest_path] = (
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
        ).encode("utf-8")
        return emissions

    def _materialize_emit(
        self,
        *,
        emit: HarnessEmit,
        env,
        system,
        target: Path,
        generated_at: str,
        emissions: dict[Path, bytes],
        manifest_entries: list[dict[str, Any]],
    ) -> None:
        sources = resolve_source(emit.source, system, **emit.source_args)
        ctx_extra = resolve_context(
            emit.context, system, self.root, harness_name=self.harness.name,
        )

        base_ctx: dict[str, Any] = dict(ctx_extra)
        base_ctx["harness"] = self.harness
        base_ctx["root"] = self.root
        base_ctx["prefix"] = self.prefix
        base_ctx.setdefault("generated_at", generated_at)

        if emit.mode == "per-record":
            for record in sources:
                ctx: dict[str, Any] = dict(record)
                ctx.update(base_ctx)
                ctx["record"] = record
                rendered = self._render(env, emit.template, ctx)
                formatted = _format_target(
                    emit.target_pattern, prefix=self.prefix, record=record,
                )
                out_path = _resolve_out_path(
                    formatted, target=target, root=self.root,
                )
                payload = rendered.encode("utf-8")
                emissions[out_path] = payload
                if emit.executable:
                    self._executable_paths.add(out_path)
                manifest_entries.append({
                    "out_path": self._rel(out_path),
                    "template": emit.template,
                    "bytes": len(payload),
                })
        elif emit.mode == "aggregate":
            ctx = dict(base_ctx)
            ctx[_records_context_key(emit.source)] = sources
            rendered = self._render(env, emit.template, ctx)
            formatted = _format_target(emit.target_pattern, prefix=self.prefix)
            out_path = _resolve_out_path(
                formatted, target=target, root=self.root,
            )
            payload = rendered.encode("utf-8")
            emissions[out_path] = payload
            if emit.executable:
                self._executable_paths.add(out_path)
            manifest_entries.append({
                "out_path": self._rel(out_path),
                "template": emit.template,
                "bytes": len(payload),
            })
        elif emit.mode == "merge-json":
            ctx = dict(base_ctx)
            ctx[_records_context_key(emit.source)] = sources
            rendered = self._render(env, emit.template, ctx)
            try:
                rendered_json = json.loads(rendered)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"merge-json template {emit.template} did not produce "
                    f"valid JSON: {exc}"
                ) from exc
            formatted = _format_target(emit.target_pattern, prefix=self.prefix)
            out_path = _resolve_out_path(
                formatted, target=target, root=self.root,
            )
            existing: Any = {}
            if out_path.is_file():
                try:
                    existing = json.loads(out_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    existing = {}
            merged = _merge_json(existing, rendered_json, emit.merge_keys)
            merged_text = json.dumps(merged, indent=2, ensure_ascii=False) + "\n"
            payload = merged_text.encode("utf-8")
            emissions[out_path] = payload
            manifest_entries.append({
                "out_path": self._rel(out_path),
                "template": emit.template,
                "bytes": len(payload),
            })
        else:
            raise RuntimeError(
                f"unknown emit mode {emit.mode!r} on harness {self.harness.name}"
            )

    def _render(self, env, template_name: str, ctx: dict[str, Any]) -> str:
        try:
            return env.get_template(template_name).render(**ctx)
        except TemplateError as exc:
            raise RuntimeError(
                f"failed to render {template_name}: {exc}"
            ) from exc

    def _rel(self, path: Path) -> str:
        return (
            str(path.relative_to(self.root))
            if path.is_relative_to(self.root) else str(path)
        )

    def _write(self, em: MaterializerEmission) -> None:
        target = self._resolve_path(em.path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(em.payload)
        if target in self._executable_paths:
            target.chmod(0o755)


__all__ = [
    "HarnessLoadError",
    "HarnessMaterializerProgram",
    "list_harnesses",
    "load_harness",
]
