"""Source + context registries for :class:`HarnessMaterializerProgram`.

A harness ``_index.md`` declares emit rules of the form
``source: <name>`` (which records the rule iterates) and
``context: [<name>, ...]`` (which dicts the rule injects into template
scope). This module supplies the dispatch tables: a name → callable
mapping for sources, and one for context providers.

The registries are open — :func:`register_source` /
:func:`register_context_provider` let downstream packages add discovery
or context functions without editing this file.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from pyfars.kernel.store import System
from pyfars.sdk.entities._load import gather_fm
from pyfars.kernel import query


SourceFn = Callable[..., list[dict[str, Any]]]
ContextProviderFn = Callable[..., dict[str, Any]]


def _records_of_type(*types: str) -> SourceFn:
    """Source function: every record whose ``type`` cell is in ``types``.

    Returns one frontmatter dict per record, with the cell-store
    subject filled in as ``slug`` and the projected-from-path cell
    resolved against ``system.root`` as ``source_path`` (a Path).
    Templates can index it with ``.relative_to(root)`` etc.
    """
    def _discover(system: System, **_kwargs: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for subject in sorted(
            query.subjects_of_type(system.store, types), key=str,
        ):
            fm = gather_fm(system.store, str(subject))
            if fm is None:
                continue
            for (s, p, o) in query.cells_at(system.store, str(subject)):
                if p == "projected-from-path":
                    fm["source_path"] = system.root / str(o)
                    break
            out.append(fm)
        return out
    return _discover


def _records_of_type_filtered(
    *types: str, filter_predicate: str,
) -> SourceFn:
    """Source function: records of ``types`` whose ``filter_predicate``
    cell matches the keyword argument of the same name.

    Used for the ``hooks`` source — ``source-args.runtime: claude-code``
    selects only hooks whose ``runtime`` cell is ``claude-code``.
    """
    def _discover(system: System, **kwargs: Any) -> list[dict[str, Any]]:
        target = kwargs.get(filter_predicate)
        base = _records_of_type(*types)(system)
        if target is None:
            return base
        return [r for r in base if r.get(filter_predicate) == target]
    return _discover


def _walk_verbs(system: System, **_kwargs: Any) -> list[dict[str, Any]]:
    """The set of verbs the ``pyfars`` CLI exposes.

    Used by the claude-code harness to project a plugin manifest +
    one slash-command markdown per verb. Static today (``run`` /
    ``query``); will be discovered from the CLI's verb registry once
    that registry exists.
    """
    return [
        {"verb": "run", "slug": "run",
         "description": "Boot the polity engine against a directory."},
        {"verb": "query", "slug": "query",
         "description": "Query a running engine over UDS."},
    ]


_SOURCE_REGISTRY: dict[str, SourceFn] = {
    "agent-records": _records_of_type("agent"),
    "skills": _records_of_type("skill"),
    "skill-packs": _records_of_type("skill", "skill-pack"),
    "runbooks": _records_of_type("runbook"),
    "hooks": _records_of_type_filtered("hook", filter_predicate="runtime"),
    "walk_verbs": _walk_verbs,
    "discover_service_specs": _records_of_type("service-spec"),
}


def register_source(name: str, fn: SourceFn) -> None:
    """Register a discovery function so harnesses can reference it by name."""
    _SOURCE_REGISTRY[name] = fn


def resolve_source(name: str | None, system: System, **kwargs: Any) -> list[dict[str, Any]]:
    """Look up ``name`` in the source registry and call it.

    Returns ``[]`` for ``name=None`` (aggregate rules that don't iterate
    a source). Raises :class:`KeyError` for unknown names — the error
    surfaces upstream as a materialization failure.
    """
    if name is None:
        return []
    fn = _SOURCE_REGISTRY.get(name)
    if fn is None:
        raise KeyError(
            f"unknown harness source {name!r}; registered: "
            f"{sorted(_SOURCE_REGISTRY)}"
        )
    return fn(system, **kwargs)


def known_sources() -> list[str]:
    return sorted(_SOURCE_REGISTRY)


# ---------------------------------------------------------------------------
# Context provider registry
# ---------------------------------------------------------------------------


def _polity_fm(system: System) -> dict[str, Any]:
    """The polity-root's frontmatter (subject ``polity``)."""
    return gather_fm(system.store, "polity") or {}


_PREDICATED_COMPUTING_REL = (
    "theories/theories/engineering/theories/tech/theories/computing/"
    "theories/predicated-computing"
)
_PREDICATION_CATEGORIES_REL = (
    "theories/theories/humanities/theories/math/theories/categories/"
    "theories/predication-categories/_index.md"
)
_FLATFILE_THEORY_REL = (
    f"{_PREDICATED_COMPUTING_REL}/theories/agential-orchestration-platform/"
    "theories/flatfile-agentic-resource-system"
)

# Maps harness slug → orientation runtime tag used for fragment filtering.
_ORIENTATION_RUNTIMES = {
    "agentic": "agentic",
    "claude-code": "claude-code",
    "repository": "repository",
    "replit-instructions": "replit",
}


def _walk_pc_subtheories(root: Path) -> list[dict[str, Any]]:
    """List of predicated-computing sub-theories with ``slug``/``title``/``path``.

    Walks ``<root>/<predicated-computing>/theories/*`` and pulls each
    ``_index.md`` frontmatter ``title``. Returns an empty list when the
    directory is absent — orientation templates degrade gracefully.
    """
    pc_root = root / _PREDICATED_COMPUTING_REL
    pc_theories = pc_root / "theories"
    if not pc_theories.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in sorted(pc_theories.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        idx = child / "_index.md"
        title = child.name
        if idx.is_file():
            try:
                from pyfars.kernel.projector.markdown_frontmatter import _split
                fm, _ = _split(idx.read_text(encoding="utf-8"))
                if fm:
                    title = fm.get("title") or title
            except Exception:
                pass
        out.append({
            "slug": child.name,
            "title": title,
            "path": f"{_PREDICATED_COMPUTING_REL}/theories/{child.name}",
        })
    return out


def _walk_top_theories(root: Path) -> list[dict[str, Any]]:
    theories_root = root / "theories" / "theories"
    if not theories_root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in sorted(theories_root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        idx = child / "_index.md"
        title = child.name
        if idx.is_file():
            try:
                from pyfars.kernel.projector.markdown_frontmatter import _split
                fm, _ = _split(idx.read_text(encoding="utf-8"))
                if fm:
                    title = fm.get("title") or title
            except Exception:
                pass
        out.append({
            "slug": child.name,
            "title": title,
            "path": f"theories/theories/{child.name}",
        })
    return out


def _load_fragments(root: Path, runtime: str):
    """Build a topic → fragment-list lookup over ``<root>/prose/orientations``."""
    orientations_root = root / "prose" / "orientations"
    cache: dict[str, list[dict[str, Any]]] = {}

    def _read(p: Path) -> dict[str, Any] | None:
        try:
            from pyfars.kernel.projector.markdown_frontmatter import _split
            fm, body = _split(p.read_text(encoding="utf-8"))
        except Exception:
            return None
        fm = fm or {}
        if fm.get("type") != "orientation-fragment":
            return None
        applies = fm.get("applies-to-runtimes") or []
        if isinstance(applies, str):
            applies = [applies]
        if applies and not ("*" in applies or runtime in applies):
            return None
        ordering = fm.get("ordering", 100)
        try:
            ordering = int(ordering)
        except (TypeError, ValueError):
            ordering = 100
        return {
            "slug": fm.get("slug") or p.stem,
            "topic": fm.get("topic"),
            "prose": (body or "").strip(),
            "ordering": ordering,
        }

    def fragments(topic: str) -> list[dict[str, Any]]:
        if topic in cache:
            return cache[topic]
        topic_dir = orientations_root / topic
        if not topic_dir.is_dir():
            cache[topic] = []
            return []
        out: list[dict[str, Any]] = []
        for p in sorted(topic_dir.glob("*.md")):
            if p.name == "_index.md" or p.name.startswith("."):
                continue
            f = _read(p)
            if f is not None:
                out.append(f)
        out.sort(key=lambda f: (f["ordering"], f["slug"]))
        cache[topic] = out
        return out

    return fragments


def _orientation_context(
    system: System, root: Path, *, harness_name: str = "",
) -> dict[str, Any]:
    """Polity / captain / ship / theory roll-up for orientation templates.

    Supplies the union of variables the packaged orientation templates
    (``CLAUDE.md.j2``, ``AGENTS.md.j2``, ``README.md.j2``, ``gitignore.j2``,
    ``replit.md.j2``) reference. Each value degrades gracefully —
    missing polity records resolve to ``None`` so the templates'
    ``{% if %}`` guards render placeholder text rather than crashing.
    """
    polity = _polity_fm(system)
    polity.setdefault("slug", "polity")
    polity.setdefault("title", str(root.name))
    runtime = _ORIENTATION_RUNTIMES.get(harness_name, harness_name)
    return {
        "polity": polity,
        "captain": None,
        "ship": None,
        "polity_layout": None,
        "is_polity_root": False,
        "charter_path": polity.get("charter"),
        "top_theories": _walk_top_theories(root),
        "predicated_computing_subtheories": _walk_pc_subtheories(root),
        "computer_systems": [],
        "agent_count": len(_records_of_type("agent")(system)),
        "skill_count": len(_records_of_type("skill")(system)),
        "agents_root_path": "governance/agents",
        "skills_root_path": "governance/skills",
        "operations_root_path": "operations",
        "command_root_path": "operations/command",
        "engineering_root_path": "operations/engineering",
        "theory_root_path": "theories",
        "top_theories_root_path": "theories/theories",
        "triage_root_path": "operations/engineering/triage",
        "predicated_computing_path": f"{_PREDICATED_COMPUTING_REL}/_index.md",
        "predicated_computing_root_path": _PREDICATED_COMPUTING_REL,
        "predication_categories_path": _PREDICATION_CATEGORIES_REL,
        "flatfile_theory_path": _FLATFILE_THEORY_REL,
        "generation_command": f"pyfars materialize {harness_name}"
                               if harness_name else "pyfars materialize",
        "fragments": _load_fragments(root, runtime or harness_name),
    }


def _mcp_binding_context(
    system: System, root: Path, **_kwargs: Any,
) -> dict[str, Any]:
    """Context for the claude-code ``mcp.json`` emit rule.

    Returns a single ``mcp_command`` mapping that the template renders
    into the ``mcpServers`` block. Empty when no MCP asset is declared.
    """
    return {"mcp_command": None}


def _nix_flake_context(
    system: System, root: Path, **_kwargs: Any,
) -> dict[str, Any]:
    """Context for the ``nix-flake`` harness.

    Keep the harness-facing context provider thin: the Nix materializer
    owns the substrate-to-Nix context rules, while the generic harness
    materializer owns template rendering, manifests, and writes.
    """
    from pyfars.programs.nix_flake_materializer import (
        NixFlakeMaterializerProgram,
    )

    return NixFlakeMaterializerProgram(root)._build_context(system)


_CONTEXT_REGISTRY: dict[str, ContextProviderFn] = {
    "orientation": _orientation_context,
    "mcp-binding": _mcp_binding_context,
    "nix-flake": _nix_flake_context,
}


def register_context_provider(name: str, fn: ContextProviderFn) -> None:
    _CONTEXT_REGISTRY[name] = fn


def resolve_context(
    names: list[str], system: System, root: Path, *, harness_name: str,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for n in names:
        fn = _CONTEXT_REGISTRY.get(n)
        if fn is None:
            raise KeyError(
                f"unknown harness context provider {n!r}; registered: "
                f"{sorted(_CONTEXT_REGISTRY)}"
            )
        out.update(fn(system, root, harness_name=harness_name))
    return out


def known_contexts() -> list[str]:
    return sorted(_CONTEXT_REGISTRY)


__all__ = [
    "ContextProviderFn",
    "SourceFn",
    "known_contexts",
    "known_sources",
    "register_context_provider",
    "register_source",
    "resolve_context",
    "resolve_source",
]
