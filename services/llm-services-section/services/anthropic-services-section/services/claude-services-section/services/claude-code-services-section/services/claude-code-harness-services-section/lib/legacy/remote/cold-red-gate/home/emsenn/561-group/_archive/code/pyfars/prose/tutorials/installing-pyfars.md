---
title: "Installing PyFARS"
type: tutorial
status: open
---

# Installing PyFARS

This tutorial takes you from a fresh `git clone` of a PyFARS instance repository to a working install: `pyfars` on your `PATH`, every agent harness projected, hooks dispatching, MCP wired.
It uses the 561 superrepo as the running example.

You will run two commands.
Most of the time is Nix building dependencies the first time it sees them.

## Before you start

You need:

- **Nix** with flakes enabled.
  If `nix --version` doesn't print a version, install Nix from <https://nixos.org/download> and add `experimental-features = nix-command flakes` to `~/.config/nix/nix.conf`.
- **Git** with submodule support.
  (Standard.)
- A working Git checkout of the instance repository — for the 561 instance, that's `git clone <url>` of the superrepo.
- The repository must contain a `.pyfars/config.toml` file.
  That file is what marks a checkout as a PyFARS instance; the install scripts refuse to run anywhere it's missing.

You **do not** need:

- A pre-installed `pyfars` binary.
  You're about to build one.
- Python on the host.
  Nix supplies the Python the build needs.
- An SSH key for any private remote.
  The pyfars source-of-truth is the in-tree submodule under `tools/platform/pyfars/`; nothing is fetched from a separate remote during install.

## Step 1 — clone and enter the repository

```bash
git clone <instance-url> 561
cd 561
```

Submodules are not yet initialized at this point; that's fine.
The install command initializes them.

## Step 2 — run `make install`

```bash
make install
```

Behind the curtain this runs `nix run .#install`, which:

1. Initializes and recursively updates every Git submodule (so `tools/platform/pyfars/`, `operations/`, `theories/`, etc. all populate).
2. Builds `pyfars` from the in-tree source at `tools/platform/pyfars/`.
3. Removes any previously-installed `pyfars` from your Nix user profile and installs the freshly-built one.
  The result is `~/.nix-profile/bin/pyfars`.
4. Projects every agent harness — `claude-code`, `claude-code-hooks`, `claude-code-mcp`, `openclaw`, `cline-workflows`, `claude-agent-sdk-plugin` — from the records under `operations/engineering/` into the working tree (`.claude/`, `.openclaw/`, `.clinerules/`, `.mcp.json`).

The first run takes a few minutes (Nix is downloading and building dependencies).
Subsequent runs are fast.

You'll see something like:

```
==> repairing submodule checkout
==> installing pyfars to user profile
==> projecting agent harnesses from operations/
  - claude-code
  - claude-code-hooks
  - claude-code-mcp
  - openclaw
  - cline-workflows
  - claude-agent-sdk-plugin
==> install complete
    pyfars at /home/you/.nix-profile/bin/pyfars
```

If the last line doesn't appear, the install didn't finish — see [Recovering from a broken install](../how-to/recovering-from-a-broken-install.md).

## Step 3 — verify

In the same shell:

```bash
pyfars --help
```

You should get the verb catalog.
If `pyfars: command not found`, your shell hasn't picked up the new profile entry yet — open a new terminal or `source ~/.profile`.

Check the projections landed:

```bash
ls .claude/agents | head
ls .claude/hooks
ls .openclaw/agents | head
cat .mcp.json
```

`.claude/agents/` should hold ~40 agent files; `.claude/hooks/` should contain `_pyfars-dispatch.sh`; `.mcp.json` should declare a `pyfars-substrate` server.

Confirm the engine boots cleanly:

```bash
pyfars run --no-services --tick-interval 60 &
sleep 3
kill $!
```

If the engine starts and halts without errors, your install is healthy.
The event log under `.pyfars/event-log/` will contain `engine_boot`, `clock_tick`, and `engine_halt` witnesses.

## You now have

- `pyfars` available as a normal command.
- Every agent harness projected from the polity's records into a form Claude Code, OpenClaw, and Cline can consume.
- An MCP server (`pyfars-substrate`) wired into Claude Code's project settings.
- A working hook receiver wired into Claude Code session-start, tool-use-success, tool-use-failure, and pre-tool governance scans, via the engine's hook-receiver endpoint per `governance/specifications/wiring-protocols.md` §4.5.

The projected files are **gitignored on purpose**.
Editing `.claude/agents/architect.md` directly will be lost the next time `make install` runs — the source-of-truth is `operations/engineering/agents/architect.md`.
Edit there, then re-run `make install`.

## What to do next

- To see the full Make target surface: `make -p | grep '^[a-z].*:' | head`.
  The interesting ones are `install`, `clean`, `reinstall`, `bootstrap`, `check`.
- To start a Claude Code session through a free cloud endpoint: `make claude endpoint cerebras` (other choices: `groq`, `nim`, `mistral`, `list`).
- To remove everything `make install` did: `make clean`.
  See [Recovering from a broken install](../how-to/recovering-from-a-broken-install.md) for the longer version.
- To understand why the pipeline is shaped this way, read [The install pipeline](../explanation/the-install-pipeline.md).
