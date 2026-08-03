---
type: concept
class: framing
depends-on: [program, harness, system, directory]
see-also: [service, service-harness-program, polity]
---

# Harness Program

A [program](program.md) of the **harness class**: a program whose protocol surface is the filesystem (writing config files) and whose downstream consumer is an external program (a [harness](harness.md)'s target).
A harness program is the program-frame counterpart of the system-frame harness — the harness *is* a projection definition; the harness program *runs* that projection.

A harness program is one of several program classes that operate against a system.
Other program classes:

- **engine** — long-running tick/dispatch loop, serves UDS
- **load-directory** — reads a directory tree into the system on startup
- **query** — short-lived cell reader (CLI verb shape)
- **bridge** — translates external protocols (HTTP, MCP, OAuth) to the engine's UDS

Each class is a different fusion of the program frame with substrate primitives.
A harness program fuses the program frame with the harness concept.

## What a harness program IS

A harness program is *the program that materializes one harness against a system*.
Its primitives:

- **A binding to one harness.** A harness program exists for one specific harness; harness programs are not generic.
  There is a `nix-flake-harness-program`, a `systemd-user-harness-program`, a `claude-code-skills-harness-program`, etc.
- **A one-shot lifecycle.** Boot → load system (cold-start, via the load-directory program) → fire the harness's closure rules → render the settled output cells via the harness's projector → write bytes to the directory → emit witnesses → exit.
  No tick loop.
- **An idempotency commitment.** Re-running the harness program against the same system produces the same output bytes; re-run is a no-op modulo timestamp witnesses.
- **A manifest as witness trail.** The witnesses emitted form the harness's system-resident manifest, queryable as ordinary system content.
  No separate manifest file.

## Lifecycle, in the four-frame phasing

1. **[Directory](directory.md) → [System](system.md)**: a load-directory call brings the system into memory from the directory's bytes (per the kernel's projector machinery).
2. **System → System**: the harness's closure rules fire, settling synthetic-document cells that describe the harness's intended output.
3. **System → Directory**: a projector renders the synthetic-document cells to bytes; the bytes are written to the directory's filesystem positions.
4. **Operation → witness**: every file write is witnessed; the witness chain is the manifest.

The harness program's exit returns control to the operator.
From this point, the external program (Nix, systemd, Claude Code, etc.) can read its newly-materialized config and act.

## Position relative to other program classes

A harness program does NOT run an engine.
It does NOT serve UDS.
It does NOT dispatch agents.
Its job is one-shot materialization.
It can run on a system whose [polity](polity.md) is not yet fully constituted — a polity's first harness materialization may happen before any of its agents are realized, before any of its dispatch rules have fired.

The bootstrap path is: load-directory + harness program first (to materialize, e.g., the polity's `flake.nix` or its `systemd-user/pyfars-engine.service`); then engine (which runs against the now-fully-materialized polity).
The harness program is the cold-start program class; the engine is the warm-running program class.

## What a harness program is NOT

- A harness program is not a [harness](harness.md).
  The harness is system-frame data (a projection definition); the harness program is program-frame execution (a process running that projection).
  A harness exists in the system whether or not any program is running; the harness program exists only during its execution.
- A harness program is not an engine.
  Engines tick; harness programs materialize.
- A harness program is not a [polity](polity.md) action.
  The polity does not run harness programs as agential operations — the operator runs them at the program frame, against a system the polity sits on top of.

## Why one harness program per harness

A harness program's `materialize` function is specific to the harness it serves: it knows which system cells to read, which projector to use, which output paths to write to.
Generic harness programs were tried in earlier PyFARS realizations and produced cruft: a generic runner with template-discovery walks, `_index.md` schema declarations for context-types, per-harness `_build_*_context` functions.
Per the math derivation, the cleanest shape is `materialize: System → Mapping[Path, bytes]` per harness — each harness is a Python function with a fixed signature; the runner is trivial.

## Naming

The program class is `harness-program`.
A specific harness program is named by the harness it serves: `nix-flake-harness-program`, `systemd-user-harness-program`, `claude-code-skills-harness-program`.
When a harness's target is a [service](service.md), the program class refines to [service-harness-program](service-harness-program.md).
