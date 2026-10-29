"""Tests for the generic harness materializer."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from pyfars.programs.harness_materializer import (
    HarnessLoadError,
    HarnessMaterializerProgram,
    list_harnesses,
    load_harness,
)


def _polity(tmp_path: Path, *agents: tuple[str, str]) -> Path:
    """Build a minimal polity rooted at ``tmp_path``: ``_index.md`` plus
    one agent record per ``(slug, title)`` pair."""
    (tmp_path / "_index.md").write_text(
        "---\nkind: polity\ntype: polity\nslug: polity\n"
        "title: \"Test polity\"\n---\n", encoding="utf-8",
    )
    if agents:
        agents_dir = tmp_path / "records" / "engineering" / "agents"
        agents_dir.mkdir(parents=True, exist_ok=True)
        for slug, title in agents:
            (agents_dir / f"{slug}.md").write_text(
                f"---\nkind: agent\ntype: agent\nslug: {slug}\n"
                f"title: \"{title}\"\n---\n\n# {title}\n",
                encoding="utf-8",
            )
    return tmp_path


def _tool_package(tmp_path: Path, slug: str = "pyfars") -> Path:
    (tmp_path / f"{slug}.md").write_text(
        "---\n"
        "type: tool\n"
        f"slug: {slug}\n"
        "nix-package:\n"
        f"  input-name: {slug}\n"
        f"  flake-url: \"git+ssh://git@github.com/emsenn/{slug}\"\n"
        "  follows-inputs: [nixpkgs, flake-utils]\n"
        f"  package-name: {slug}\n"
        "---\n",
        encoding="utf-8",
    )
    return tmp_path


def test_list_harnesses_includes_named_runtimes():
    names = list_harnesses()
    for n in ("agentic", "claude-code", "openclaw", "codex", "repository"):
        assert n in names


def test_load_harness_parses_emits():
    h = load_harness("agentic")
    assert h.slug == "harness:agentic"
    assert h.target_runtime == "agentic"
    assert len(h.emits) == 1
    assert h.emits[0].template == "AGENTS.md.j2"
    assert h.emits[0].mode == "aggregate"
    assert "orientation" in h.emits[0].context


def test_load_harness_unknown_raises():
    with pytest.raises(HarnessLoadError):
        load_harness("does-not-exist")


def test_materialize_agentic_writes_agents_md(tmp_path: Path):
    _polity(tmp_path)
    prog = HarnessMaterializerProgram(
        root=tmp_path, harness_slug="agentic",
    )
    import asyncio
    result = asyncio.run(prog.run())
    agents_md = tmp_path / "AGENTS.md"
    assert agents_md.is_file()
    assert agents_md.stat().st_size > 0
    manifest = tmp_path / ".pyfars" / "harness-manifests" / "agentic.json"
    assert manifest.is_file()
    m = json.loads(manifest.read_text())
    assert m["harness"] == "agentic"
    assert any(e["out_path"] == "AGENTS.md" for e in m["files"])
    assert result.materializer_slug == "harness:agentic"


def test_materialize_openclaw_emits_per_agent(tmp_path: Path):
    _polity(tmp_path, ("alpha", "Alpha agent"), ("beta", "Beta agent"))
    prog = HarnessMaterializerProgram(
        root=tmp_path, harness_slug="openclaw",
    )
    import asyncio
    asyncio.run(prog.run())
    alpha = tmp_path / ".openclaw" / "agents" / "alpha.md"
    beta = tmp_path / ".openclaw" / "agents" / "beta.md"
    assert alpha.is_file() and beta.is_file()
    assert "Alpha agent" in alpha.read_text()
    manifest = tmp_path / ".pyfars" / "harness-manifests" / "openclaw.json"
    assert manifest.is_file()


def test_materialize_repository_writes_readme_and_gitignore(tmp_path: Path):
    _polity(tmp_path)
    prog = HarnessMaterializerProgram(
        root=tmp_path, harness_slug="repository",
    )
    import asyncio
    asyncio.run(prog.run())
    assert (tmp_path / "README.md").is_file()
    assert (tmp_path / ".gitignore").is_file()


def test_materialize_nix_flake_uses_registered_context(tmp_path: Path):
    _polity(tmp_path)
    _tool_package(tmp_path)
    prog = HarnessMaterializerProgram(
        root=tmp_path, harness_slug="nix-flake",
    )
    import asyncio
    asyncio.run(prog.run())
    flake = tmp_path / "flake.nix"
    assert flake.is_file()
    text = flake.read_text()
    assert "pyfars materialize nix-flake" in text
    assert "pyfars = {" in text
    assert "url = \"git+ssh://git@github.com/emsenn/pyfars\"" in text
    manifest = tmp_path / ".pyfars" / "harness-manifests" / "nix-flake.json"
    assert manifest.is_file()


def test_materialize_unknown_harness_raises(tmp_path: Path):
    _polity(tmp_path)
    with pytest.raises(HarnessLoadError):
        HarnessMaterializerProgram(
            root=tmp_path, harness_slug="bogus-harness",
        )
