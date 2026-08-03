"""Materializer-template sets that ship with PyFARS.

Each subdirectory is one set:

    materializer_templates/<name>/_index.md
                                  metadata (frontmatter names target,
                                  runtime, etc.; body documents the
                                  materializer)
    materializer_templates/<name>/templates/*.j2
                                  Jinja2 templates rendered against
                                  system-derived context

The *templates* live here (in the package, not the system) because they
describe the materializer's runtime contract — what files it writes and
how — which is intrinsic to pyfars, not to any one polity. The *content*
the templates render against (polity title, captain, theory list, member
list) comes from system-frame entities at install time.

Discovery: :func:`available_materializers` enumerates every set in this
package; :func:`materializer_index` reads the ``_index.md`` metadata.
:func:`materializer_template_loader` returns a Jinja2 loader suitable
for rendering templates from the package — works whether pyfars is
installed as a wheel, run from source, or packaged via Nix.
"""
from __future__ import annotations

from importlib import resources
from importlib.resources.abc import Traversable

from pyfars.kernel.projector.parse.frontmatter import parse as parse_fm


_PACKAGE = "pyfars.apps.materializer_templates"
_ACCEPTED_KINDS: frozenset[str] = frozenset({
    "harness", "materializer", "materializer-template",
})


def _resource_root() -> Traversable:
    return resources.files(_PACKAGE)


def available_materializers() -> list[dict]:
    """Enumerate every materializer-template set shipped in this package."""
    out: list[dict] = []
    root = _resource_root()
    for child in sorted(root.iterdir(), key=lambda c: c.name):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        idx = child / "_index.md"
        if not idx.is_file():
            continue
        try:
            fm, _body = parse_fm(idx.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not fm or fm.get("type") not in _ACCEPTED_KINDS:
            continue
        out.append({
            "name": child.name,
            "title": fm.get("title", child.name),
            "target-default": fm.get("target-default"),
            "target-runtime": fm.get("target-runtime"),
            "_index": f"<package:{_PACKAGE}/{child.name}/_index.md>",
        })
    return out


def materializer_index(name: str) -> dict | None:
    """Return the parsed frontmatter for a materializer's _index.md."""
    idx = _resource_root() / name / "_index.md"
    if not idx.is_file():
        return None
    try:
        fm, _body = parse_fm(idx.read_text(encoding="utf-8"))
    except Exception:
        return None
    return fm


def materializer_template_loader(name: str):
    """Return a Jinja2 loader for the named materializer's templates."""
    from jinja2 import PackageLoader
    return PackageLoader(_PACKAGE, f"{name}/templates")


__all__ = [
    "available_materializers",
    "materializer_index",
    "materializer_template_loader",
]
