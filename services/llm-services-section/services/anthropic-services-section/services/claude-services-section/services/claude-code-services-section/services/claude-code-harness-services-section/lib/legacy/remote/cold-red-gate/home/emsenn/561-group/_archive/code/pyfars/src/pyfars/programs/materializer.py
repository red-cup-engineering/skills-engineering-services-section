"""Materializer program classes — one-shot system→directory materialization.

A *materializer* program reads system cells, applies the materializer's
closure rule to produce a rendering context, and writes the rendered
bytes to disk. The math:

    materialize = render ∘ settle ∘ query

where ``query`` reads the materializer's input fiber from the system,
``settle`` applies the materializer's closure rule to produce a
synthetic rendering context, and ``render`` is the projector's
create-direction — typically a Jinja template plus the settled context.

  - :class:`MaterializerProgram` runs one materializer. Lifecycle:
    validate → boot → materialize → write bytes → emit witnesses → halt.
    Idempotent modulo timestamp witnesses.

  - :class:`ServiceMaterializerProgram` refines for materializers whose
    target is a supervised service. Adds an optional supervisor handoff
    step after byte-writing.

Each concrete materializer program subclasses one of these and supplies
``materialize: System → Mapping[Path, bytes]``.

Distinct from :class:`HarnessProgram` — which is the agentic-loop
runtime, not file projection.
"""
from __future__ import annotations

import abc
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Iterable, Mapping

from jinja2 import Environment, PackageLoader, StrictUndefined

from pyfars.kernel.store import System
from pyfars.programs.base import Program, ProgramResult, _now_iso


@dataclass
class MaterializerEmission:
    """One file's worth of materialization output."""
    path: Path
    payload: bytes


@dataclass
class MaterializerResult(ProgramResult):
    """Outcome of one materializer-program run."""
    materializer_slug: str = ""
    written: list[MaterializerEmission] = field(default_factory=list)
    handoff_invocations: list[str] = field(default_factory=list)


class MaterializerProgram(Program, abc.ABC):
    """One-shot program that materializes one materializer against a system.

    Subclasses declare their bound materializer via ``materializer_slug``
    and the substrate scopes they need via ``scopes``, then implement
    ``materialize``. The base supplies the run-loop: validate → boot →
    materialize → write → witness → halt.

    ``scopes`` is a list of substrate-relative directory paths
    (e.g. ``["governance/offices"]``). Only those scopes are loaded —
    O(cells in scope), not O(corpus). When ``scopes`` is empty the full
    root is walked (bootstrap / migration use only).
    """

    #: The materializer this program binds to. Subclass-level constant.
    materializer_slug: ClassVar[str] = ""

    #: Substrate scopes this materializer reads. Directory paths relative
    #: to root. Resolved via env var → .envrc → ~/.envrc → default.
    scopes: ClassVar[list[str]] = []

    def boot(self) -> None:
        from pyfars.kernel.store import System
        from pyfars.kernel.event_log import EventLog
        self._system = System.from_scopes(self.root, self.scopes)
        self._log = EventLog(root=self.root)

    @abc.abstractmethod
    def materialize(self, system: System) -> Mapping[Path, bytes]:
        """Compute the bytes this materializer emits against ``system``."""

    def _resolve_path(self, path: Path) -> Path:
        path = Path(path)
        if path.is_absolute():
            return path
        return self.root / path

    def _write(self, em: MaterializerEmission) -> None:
        target = self._resolve_path(em.path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(em.payload)

    async def run(self) -> MaterializerResult:
        started_at = _now_iso()
        self.validate()
        self.boot()
        self.emit(operator="materializer_program_boot",
                  details={"materializer_slug": self.materializer_slug,
                           "root": str(self.root),
                           "started_at": started_at})
        materialized = dict(self.materialize(self.system))
        emissions = [MaterializerEmission(path=Path(p), payload=b)
                     for p, b in materialized.items()]
        for em in emissions:
            self._write(em)
            self.emit(operator="materializer_emit",
                      details={"materializer_slug": self.materializer_slug,
                               "path": str(self._resolve_path(em.path)),
                               "size_bytes": len(em.payload)})
        self.halt()
        halted_at = _now_iso()
        self.emit(operator="materializer_program_halt",
                  details={"materializer_slug": self.materializer_slug,
                           "started_at": started_at,
                           "halted_at": halted_at,
                           "files_written": len(emissions)})
        return MaterializerResult(
            started_at=started_at,
            halted_at=halted_at,
            materializer_slug=self.materializer_slug,
            written=emissions,
        )


def materializer_jinja_env(materializer_name: str) -> Environment:
    """Build a Jinja environment over one packaged materializer's templates.

    Jinja realizes the projector's create-direction: the template is a
    literal-with-holes representation; the rendering context fills the
    holes; rendering produces the bytes the materializer writes.
    """
    return Environment(
        loader=PackageLoader("pyfars.apps.materializer_templates",
                             f"{materializer_name}/templates"),
        autoescape=False,
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )


@dataclass
class HandoffCommand:
    """A supervisor invocation to perform after byte-writing.

    Service-materializer programs use these to notify the supervisor of
    new declarations (e.g. ``systemctl --user daemon-reload``).
    """
    argv: list[str]
    description: str = ""

    async def execute(self) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *self.argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        return (
            proc.returncode or 0,
            stdout.decode("utf-8", errors="replace"),
            stderr.decode("utf-8", errors="replace"),
        )


class ServiceMaterializerProgram(MaterializerProgram, abc.ABC):
    """Materializer program whose target is a supervised service."""

    def handoff(
        self, written: list[MaterializerEmission],
    ) -> Iterable[HandoffCommand]:
        """Yield supervisor commands to invoke after write. Default: none."""
        return ()

    async def run(self) -> MaterializerResult:
        result = await super().run()
        for cmd in self.handoff(result.written):
            rc, out, err = await cmd.execute()
            self.emit(operator="service_materializer_handoff",
                      details={"materializer_slug": self.materializer_slug,
                               "argv": cmd.argv,
                               "description": cmd.description,
                               "exit_code": rc,
                               "stdout_tail": out[-2048:],
                               "stderr_tail": err[-2048:]},
                      kind="observation")
            result.handoff_invocations.append(" ".join(cmd.argv))
        return result


__all__ = [
    "HandoffCommand",
    "MaterializerEmission",
    "MaterializerProgram",
    "MaterializerResult",
    "ServiceMaterializerProgram",
    "materializer_jinja_env",
]
