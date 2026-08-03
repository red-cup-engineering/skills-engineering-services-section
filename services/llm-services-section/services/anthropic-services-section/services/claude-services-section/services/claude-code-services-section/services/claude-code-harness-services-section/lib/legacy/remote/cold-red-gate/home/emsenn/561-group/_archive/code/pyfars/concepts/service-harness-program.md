---
type: concept
class: framing
depends-on: [harness-program, service, harness, program]
see-also: [system, directory, polity]
---

# Service Harness Program

A refinement of the [harness-program](harness-program.md) program class for harnesses whose target external program is a [service](service.md).
Where a plain harness program produces config files and exits, a service-harness program additionally produces lifecycle declarations the supervisor reads — and may, depending on the harness, invoke supervisor commands during materialization.

A service-harness program is what runs when a polity declares a harness for an external program that is supervised: nix-daemon, systemd-managed services (including pyfars's own engine when run as a service), Docker containers, the Claude Code daemon, etc.

## What a service-harness program IS

A service-harness program is *the program that materializes one service-harness against a system*.
Beyond the [harness-program](harness-program.md) primitives, a service-harness program:

- **Materializes lifecycle declarations.** Beyond config files, it emits supervisor metadata: systemd unit files, container manifests, OCI labels, init-system entries.
  These declare to the supervisor *how to manage the service*.
- **Materializes supervision policy.** Restart-on-failure, dependency ordering (this service depends on that one), graceful-shutdown windows, log routing.
  The polity's policy cells become supervisor-readable form.
- **Materializes health-check declarations.** The supervisor's notion of "is this service okay" needs hooks the harness defines: liveness probes, readiness probes, periodic health-check command lines.
- **May perform supervisor handoff.** Some service harnesses, after materializing files, invoke the supervisor to load the new declarations (`systemctl --user daemon-reload`, `nix-store --realise`, `docker compose up`).
  This handoff is itself a system operation: the invocation emits a witness; the supervisor's response (success/failure/timeout) is read back and recorded.

## Lifecycle, in the four-frame phasing

A service-harness program extends the harness-program lifecycle:

1. **[Directory](directory.md) → [System](system.md)**: load the system from the directory.
2. **System → System**: harness's closure rules settle output cells (config + lifecycle + policy + health-check).
3. **System → Directory**: projector writes bytes (config files, unit files, manifests).
4. **Directory → Supervisor**: optionally, invoke the supervisor to load the new declarations.
5. **Supervisor response → System**: record the supervisor's response as system-resident witnesses (success / failure / state of the service after handoff).
6. **Operation → witness**: every file write and every supervisor invocation is witnessed.

Step 4 is what distinguishes service-harness from plain harness.
A plain harness program produces files and exits; a service-harness program may need to *tell* the supervisor those files exist before the service is actually under management.

## What a service-harness program is NOT

- A service-harness program is not an alternative to [harness-program](harness-program.md).
  It IS a harness-program, refined for service targets.
  Code that handles harness programs generically should still work for service-harness programs; service-harness-specific logic only fires for service-harness instances.
- A service-harness program is not an engine.
  The engine is itself something a service-harness might install (the systemd-user-harness installs a unit that supervises the engine), but the service-harness program and the engine are different program classes.
- A service-harness program is not a [polity](polity.md) action.
  As with all program-class instances, an operator runs it; the polity declares its existence via system cells.

## Examples relevant to pyfars

- **`nix-flake-harness-program`** — materializes the polity's `flake.nix` (config), and the polity's nix-package declarations (lifecycle metadata for nix-daemon to manage).
  Builds nothing itself; defers to nix-daemon for realization.
- **`systemd-user-harness-program`** — materializes the polity's `~/.config/systemd/user/pyfars-engine.service` unit file, then optionally `systemctl --user daemon-reload` and `systemctl --user restart pyfars-engine.service` to hand off.
- **`claude-code-mcp-harness-program`** — materializes the polity's `.mcp.json` declaring how Claude Code's MCP client connects to the polity's MCP server (which is itself a service supervised by something).

## Naming

The program class is `service-harness-program`.
A specific instance is named by the service-harness it serves: `nix-flake-service-harness-program`, `systemd-user-service-harness-program`.
In code and prose where context is unambiguous, the `service-` prefix may be elided in favor of the simpler `<harness-slug>-harness-program` name; the refinement still applies.
