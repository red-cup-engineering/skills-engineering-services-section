---
title: "The install pipeline"
type: explanation
status: open
---

# The install pipeline

This document explains how `make install` produces a working PyFARS instance, and why the pipeline is shaped that way.
It is not a how-to; it answers *why this and not something else*.

## The shape

```
make install
   ↓
nix run .#install
   ↓  (flake app: pyfars-install)
   1. git submodule update --init --recursive
   2. nix profile remove pyfars  (idempotent)
   3. nix profile add  .#pyfars   (built from in-tree source)
   4. for each agent harness:  pyfars install <name>
```

`make` is a thin shim.
Every Make target either runs `nix run .#<app>` or rejects with "nix not found".
It exists so a human types `make install` instead of `nix run .#install` — nothing more.

The actual work is split across two Nix-built shell applications:

- **`pyfars-install`** — what you run on a development machine to set up or refresh the working tree.
  Does not start services.
- **`pyfars-bootstrap`** — calls `pyfars-install` first, then runs the host's service strategy (systemd-user units, manual, etc.).
  Used on hosts that need a heartbeat or MCP daemon running in the background.

A separate **`pyfars-clean`** app removes everything the install creates.

## Why Nix carries the work

The instance install needs to do four things deterministically across very different host environments (a captain's laptop, a tiny VPS, a CI runner, a fresh contributor's machine):

1. **Build a specific Python package** from a specific source tree, with a fixed dependency graph.
2. **Place it on `PATH`** without polluting the system Python or requiring a `pip install`.
3. **Read the polity's records** (under `operations/engineering/`) and project them into framework-specific harness outputs.
4. **Wire long-running services** into systemd (or whatever the host's init is) when appropriate.

Make can do (4) and bits of (3).
It cannot do (1) or (2) without a venv-management dance that breaks on a different distro every other week.
Nix makes (1) and (2) trivial: declare an input, declare a derivation, install it.
The same derivation works on the captain's Ubuntu laptop and on a fresh NixOS VPS.

So Nix owns build-and-place-on-PATH; PyFARS owns project-records-into-harness-outputs; systemd-user owns run-as-daemon.
Each layer does one thing.
Make is the user-facing entry point.

## Why the pyfars input points at the in-tree submodule

`flake.nix` declares its `pyfars` flake input as `git+file:./tools/platform/pyfars`.
That path is a Git submodule of the instance repository.
The build always uses **this** checkout as the source of truth.

The alternative — pointing at a remote `github.com/<org>/pyfars` — was tried and abandoned.
It introduces a category of bug that's nearly invisible:

- A captain edits `tools/platform/pyfars/src/pyfars/runtime/dispatch_graph.py`.
- They run `make install` to test.
  `make install` calls Nix.
- Nix sees a flake input pointing at the remote, fetches *that*, and builds.
  The local edit is silently ignored.
- The captain runs the test command.
  The behavior matches the un-edited remote — they conclude the edit didn't take, edit something else, run again, and the cycle repeats.

By making the input the in-tree submodule, every build picks up local edits immediately, and there is no drift between "the source you can read" and "the source the install used".

The cost: anyone consuming this flake from outside the instance repo (e.g., a downstream NixOS host) must override the input or maintain their own checkout.
That's intentional — co-development of pyfars with the instance is the supported workflow during this phase.
Once pyfars stabilizes, the flake input will switch to a pinned remote.

## Why projected harness outputs are gitignored

The agent records under `operations/engineering/agents/` are the source of truth.
The files under `.claude/agents/`, `.openclaw/agents/`, `.clinerules/workflows/`, `.mcp.json`, etc. are **projections** of those records — derived files that exist so a third-party tool (Claude Code, OpenClaw, Cline) can consume the polity's agent definitions in its own format.

When the projections were tracked, three failure modes appeared:

1. **Timestamp churn.** Every projected file embeds a "projected at <timestamp>" comment.
  Re-running install rewrote 40 files, the only diff being the timestamp.
  `git status` lied about meaningful change.
2. **Hand-edits drifted in.** A contributor edits `.claude/agents/architect.md` to fix a typo.
  The next install regeneration silently overwrites them.
  The fix is lost; the source record is never updated.
3. **Projection skew across machines.** Different captains run install at different times against slightly different binaries; their checkouts produce slightly different projections; the diffs spam pull requests.

Gitignoring the projections solves all three.
The user is forced through `make install` to materialize them, which means they are always fresh, always derived from the source records, and never confused with hand-written content.
The trade is "one extra command on a fresh checkout", which is exactly the price the install pipeline is designed to charge.

## Why the harness list is explicit

`pyfars-install` runs `pyfars install <name>` for a specific list of harnesses, not `--all`.
The list:

```
claude-code
claude-code-hooks
claude-code-mcp
openclaw
cline-workflows
claude-agent-sdk-plugin
```

Two harnesses (`nix-flake` and `repo-instructions`) are deliberately excluded.
They project tracked source files — `flake.nix`, `CLAUDE.md`, `AGENTS.md`, `README.md` — from polity records.
Running them on every install would silently overwrite hand-tuned content in those files.
They stay manual: an operator runs `pyfars install-harness nix-flake` only when they explicitly want to refresh the projection.

A third pair (`replit`, `replit-config`) is excluded because it only matters in a Replit container and would write inert files everywhere else.
Hosts that need it should call it directly.

The list is currently inlined in `flake.nix`.
A future change will move it to `.pyfars/config.toml` so each substrate can declare which harnesses are active without editing the flake.

## Why install and bootstrap are separate

`pyfars-install` ends after harness projection.
It does not start services.

`pyfars-bootstrap` calls `pyfars-install`, then reads the registered computer-system record (matched by hostname) to decide what to do next.
On a host with `service-manager: systemd-user`, it writes `~/.config/systemd/user/pyfars-{heartbeat,mcp}.service` and starts them.
On a host with `manual`, it prints the commands and does nothing.

Two reasons for the split:

- **Local development should not start daemons.** A contributor running `make install` on their laptop wants a working CLI.
  They do not want a `pyfars run` engine running in the background, eating cycles and writing event-log entries the first time they open a terminal.
  Default to "no daemons"; opt in via `make bootstrap`.
- **Service management is a separate authority.** Bootstrap writes user-systemd files, which is host-touching.
  Install only writes inside the repo and to the user's Nix profile.
  Splitting the verbs lets the captain reason about each authority separately.

## Where the source-of-truth lines fall

Track these mentally and most install-pipeline questions answer themselves:

| Layer | Source of truth |
|---|---|
| Python source | `tools/platform/pyfars/src/` |
| Records (agents, hooks, skills, runbooks) | `operations/engineering/` (and analogues under `command/`, `science/`) |
| Harness projection logic | `tools/platform/pyfars/src/pyfars/cli/install_harness.py` and `tools/platform/pyfars/src/pyfars/harnesses/<name>/` |
| Runtime engine | `tools/platform/pyfars/src/pyfars/runtime/` (lifecycle, dispatch_graph, eligibility_rules, closure_runner, agent_compiler, services, event_log, ledger, federation, …) |
| Instance configuration | `.pyfars/config.toml` |
| Computer-system policy | `operations/command/group/computer-systems/<slug>.md` |
| Flake apps and Nix wiring | `<instance-root>/flake.nix` |
| Make dispatch | `<instance-root>/Makefile` |
| Projected harness outputs | **Generated. Never edit. Gitignored.** |

Edit the source-of-truth, then `make install`.
If the projection looks wrong, the bug is in the source record or in the harness logic — not in the projected file.
