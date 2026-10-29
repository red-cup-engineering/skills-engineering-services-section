---
type: concept
class: integration-projection
status: draft
depends-on: [system, polity, program, directory, projection, reification, witness]
see-also: [service, harness-program, agential-self-generation, harness-manifest]
---

# Harness

The system-frame name for *a projection from the polity's system cells to an external program's configuration*, materialized as files in the [directory](directory.md).
A harness is the system-frame morphism by which the [polity](polity.md) makes an external program one of its citizens: the external program does not see the system; the harness produces the files the external program reads, and the external program acts on those files.

A harness is one of the named morphisms by which the polity meets external software.
Where agents and offices are the polity's *internal* actors, harnesses are how the polity *shapes external actors* to operate inside the polity.

## What a harness IS

A harness is a system-resident **projection definition**:

- **A target external program** — Nix, systemd, Claude Code, an editor, a daemon.
  The external program is named by the harness; the harness exists for that one external program.
- **An input fiber** — which system cells the projection reads.
  By [identity-by-relations](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/predicated-computing/concepts/identity-by-relations.md), the harness names predicate sets (computer-system records, tool-package declarations, polity-task-shells, etc.) it consumes.
- **A file-output set** — which files the projection produces, at what paths in the [directory](directory.md).
  Paths are relative to the directory root.
- **A transform** — the function from input cells to output bytes.
  The transform decomposes into two PyFARS primitives:
  - A **closure rule** that reads the input fiber and settles synthetic-document cells describing the intended output.
  - A **projector `create` direction** that renders the synthetic-document cells to bytes (per the projector contract's counit law).

## The harness as a morphism

A harness is a **projection functor** from the polity's system to the external program's configuration space.
The functor takes the polity's system cells (in their rich predicate category) and produces the external program's configuration (in the external's typically thin predicate category — per [thin-value-domain](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/concepts/thin-value-domain.md), most external programs have impoverished predicate categories compared to PyFARS).

The projection loses structure (the rich predicate category collapses to labels in the external's space).
What survives the projection is what the external program can use.

## Two directions: outbound and inbound

A harness for external program $R$ commits to two directions:

- **Outbound projection** — system cells → $R$-shaped artifacts.
  The `claude-code` harness projects PyFARS skill records into `.claude/agents/*.md`.
  The `codex` harness projects them into `.agents/skills/`.
  The orientation harnesses (`claude-code-instructions`, `agentic`, `repository`, `replit-instructions`) project polity facts and orientation fragments into `CLAUDE.md`, `AGENTS.md`, `README.md` + `.gitignore`, `replit.md` respectively.
  The `nix-flake` harness projects computer-system records into `flake.nix`.
  This is the morphism the projection functor above realizes.
- **Inbound transition** — $R$-shaped events → system witnesses.
  When a Claude Code session executes a hook, the resulting event is recorded as a system witness via `hook-dispatch`.
  When a Codex session updates an artifact, the change is reported back as a witness.
  The inbound direction is where world-events re-enter the polity's audit chain.

The two directions form a round-trip.
A harness is bidirectional whenever its target supports inbound.
Some harnesses (e.g., `nix-flake`) are projection-only — Nix doesn't talk back, so the harness produces files but does not receive events.
Even projection-only harnesses, though, *witness their own emissions* — the witnesses are inbound to the system from the harness program, even when nothing inbound arrives from the external program itself.

## What a harness is NOT

- A harness is not a [program](program.md).
  Programs are processes; the [harness-program](harness-program.md) program class runs harnesses, but the harness itself is a system entity.
- A harness is not a [polity](polity.md) thing.
  The polity DECLARES which harnesses it uses (via `has-harness` cells), but the harness specification is system-resident; any polity that declares the harness invokes it.
- A harness is not the external program.
  The external program (Nix, systemd) is outside PyFARS entirely; the harness is the system-frame projection that produces the external program's config (and translates its events back).

## How a polity declares its harnesses

A polity declares its harness usage via system cells.
The cell shape is `(polity, has-harness, <reified-harness-config>)` where the reified-harness-config is a message ID asserting `(harness:X, variable, value)` for each parameter the polity supplies.
Per [reification](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/predicated-computing/concepts/reification.md), the polity's `has-harness` cell points at a content-addressed message that *carries* the parameterization.

The harness's transform reads both the harness-config message and any additional system cells the harness's input-fiber declaration names (computer-systems, tool-packages, devshells, etc.).

## Harness as the boundary between PyFARS and the outside

PyFARS is a polity substrate, but it doesn't run alone.
It runs alongside Claude Code (an agent runtime), Codex (an agent runtime), Replit (a workspace runtime), nginx (a web transport), systemd (a service manager), Hugo (a static-site generator), and so on.
Each is an external program with its own conventions.
Harnesses are the framework PyFARS uses to interoperate — without forcing PyFARS to absorb each external's conventions, and without forcing each external to know PyFARS's system model.

A harness is the exact place where PyFARS's system-purity meets the world's mess.
The system stays pure; the harness translates system into world-conventions and world-events into system witnesses.
When the harness is well-defined, the system-purity claim still holds for the polity as a whole because every world-event becomes a system witness through the harness; no out-of-system state leaks.

## Position in the four frames

A harness lives at the **[system](system.md) → [directory](directory.md)** boundary in the forward direction (and **directory → system** via witness on the inbound).
Its outbound input is system cells; its outbound output is directory bytes.
Its execution is by a [program](program.md) (the [harness-program](harness-program.md)).
Its declaration is by the [polity](polity.md).
So a harness touches three frames:

```
polity declares → system holds → program runs → directory receives → external program reads
                                                                  ↓
polity learns  ← system records ← program receives ← directory event   (inbound)
```

## Manifest as witness chain

Per the PyFARS commitment that *every operation is a system operation*, a harness's execution produces witnesses for every file written.
Those witnesses are the harness's manifest: querying "what did this harness install" is a system query over the witness chain.
The [harness-manifest](../objects/harness-manifest.md) object exists as a system-resident record of what was emitted; its content is recovered from witnesses, not maintained as an out-of-system file.

Drift detection follows: compare the witnessed sha256 of a materialized file against the on-disk sha256.
Divergence emits a `(file, has-drifted, true)` cell; closure rules can act on drift cells (e.g. mark the polity as needing re-materialization).

## Harnesses PyFARS currently ships

PyFARS-the-package currently ships harness templates for: `agentic`, `claude-agent-sdk-plugin`, `claude-code`, `claude-code-hooks`, `claude-code-instructions`, `claude-code-mcp`, `cline-workflows`, `codex`, `nix-flake`, `openclaw`, `replit`, `replit-config`, `replit-instructions`, `repository`, `systemd-user`.
The list is open and grows.
Each harness is one system-projection point.

Templates live under `src/pyfars/apps/harness_templates/<name>/` in the package source — they are the *type definition* of each harness, with `_index.md` declaring its inputs and target paths, and `templates/` carrying the projector-create artifacts the harness uses.
Each polity that declares a harness gets its own materialization, parameterized by its own `has-harness` config cell.

## Open issues

- **Harness composition.** Multiple harnesses installed simultaneously — does PyFARS guarantee they don't conflict?
  What happens when two harnesses claim the same target file?
  Open structural question.
- **Inbound event lifecycle.** When an external program sends an event back, the discipline for converting it to a system witness is harness-specific; a uniform inbound-event discipline (a "reverse-projector" contract) is not yet specified.
- **Per-harness Python signature.** The implementation contract `materialize: System → Mapping[Path, bytes]` per harness is the math-derived shape (see [harness-program](harness-program.md)).
  Earlier realizations used template-discovery walks + `_index.md` schemas + per-harness `_build_*_context` functions; that pattern is deprecated.
  The new shape is one Python function per harness, no DSL.
