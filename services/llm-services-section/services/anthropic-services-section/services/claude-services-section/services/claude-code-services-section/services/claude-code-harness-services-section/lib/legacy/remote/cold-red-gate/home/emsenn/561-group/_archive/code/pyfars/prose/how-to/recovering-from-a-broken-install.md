---
title: "Recovering from a broken install"
type: how-to
status: open
---

# Recovering from a broken install

If `pyfars` is misbehaving — wrong binary on `PATH`, hooks failing, projected harness files stale, MCP server not responding — the recovery path is `make clean && make install`.
This guide explains what each step does and what to look at when one of them refuses to finish.

## The single-command recovery

```bash
make clean && make install
```

Run this from the repository root.
`clean` is idempotent and never errors on missing state; `install` rebuilds everything from the in-tree source.
After it completes you have a known-good install.

If that works, stop reading.

## Symptom-driven diagnosis

When recovery doesn't work cleanly, identify the failing step:

### `pyfars: command not found` after install

The install script reports `pyfars at /home/you/.nix-profile/bin/pyfars`, but a fresh shell can't find it.

```bash
ls -l ~/.nix-profile/bin/pyfars
echo "$PATH" | tr ':' '\n' | grep -i nix
```

If the binary exists but isn't on `PATH`, your shell rc file isn't sourcing the Nix profile.
Open a new login shell, or `. ~/.nix-profile/etc/profile.d/nix.sh` in the current shell.

### Hook dispatcher exits non-zero

The hook dispatcher is the engine's hook-receiver endpoint, installed by the `claude-code-hooks` harness.
If hooks fail, run:

```bash
pyfars install claude-code-hooks
```

If the install reports `hook record not found: <some path>`, the hook records under `operations/engineering/hooks/` aren't where the harness expects them.
This usually means the running `pyfars` binary is older than the operations layout — re-run `make install` to refresh it.
If the path the error mentions doesn't exist on disk at all, the operations submodule isn't initialized: `git submodule update --init --recursive`.

### Projected harness files are stale

Symptom: `.claude/agents/<some-agent>.md` shows old content, but the source record at `operations/engineering/agents/<some-agent>.md` was edited.

The harness projections only update when `pyfars install <name>` runs.
Re-run install:

```bash
make install
```

If only one harness needs refreshing, run the targeted command directly:

```bash
pyfars install claude-code
```

### `.mcp.json` is missing

`make install` should have written it.
If it didn't:

```bash
pyfars install claude-code-mcp
```

If that fails with a path error, your `.pyfars/config.toml` is missing or unreadable.
Ensure the file exists at the repo root.

### Nix says the input is dirty

Warnings like `Git tree '/home/you/561/tools/platform/pyfars' is dirty` or `not writing lock file ... because it has an unlocked input` are informational.
They're emitted because the in-tree pyfars submodule has uncommitted changes.
The build still succeeds.
To silence them, commit or stash work in `tools/platform/pyfars/`.

### Nix says `git+file:./tools/platform/pyfars` is deprecated

This is a known warning from Nix.
The relative-path `git+file:` URL form is being phased out per [nixos/nix#12281](https://github.com/NixOS/nix/issues/12281).
It still works on every supported Nix release; the install pipeline will be updated before the deprecation lands.

### `nix profile remove pyfars` says "no matches"

`make clean` swallows this error — it's expected when nothing is installed yet.
If you see it elsewhere, it just means there's no pyfars in your user profile to remove.

### A previous install left services running

If you bootstrapped on a host with `service-manager: systemd-user` and now want a clean state:

```bash
systemctl --user stop pyfars-run.service
systemctl --user disable pyfars-run.service
make clean
```

The systemd unit files themselves live in `~/.config/systemd/user/`; `make clean` does not touch them.
Remove them by hand if you want a fresh slate:

```bash
rm ~/.config/systemd/user/pyfars-run.service
systemctl --user daemon-reload
```

### The heartbeat lock file is held

`make install` clears `.pyfars/heartbeat.lock`.
If an engine process is actively running, it will have an flock on the file even after the file is deleted, and you may see `another instance is running` on the next start.
Find and stop it:

```bash
pgrep -af "pyfars run"
# kill the matching PID
```

## What `make clean` actually removes

- `pyfars` from your Nix user profile (`nix profile remove pyfars`).
- Every projected harness output: `.claude/agents/`, `.claude/hooks/`, `.claude/settings.json`, `.claude/plugins/pyfars-substrate/`, `.openclaw/agents/`, `.clinerules/workflows/`, `.mcp.json`, `.pyfars/cline-witness.sh`, `.pyfars/harness-manifests/`.
- `.pyfars/heartbeat.lock`.

## What `make clean` does **not** remove

- `.claude/settings.local.json` (per-user Claude Code state — not a harness output).
- `.pyfars/config.toml` (your instance configuration).
- `.pyfars/event-log/`, `.pyfars/drafts/`, `.pyfars/oauth/`, `.pyfars/profile/` (instance state and historical witness data).
- Anything under `operations/`, `theories/`, `tools/`, `records/` (source-of-truth content).
- The Nix store.
  Built derivations stay cached; reinstall is fast.

## When to escalate

If `make clean && make install` finishes successfully but the system still misbehaves, the problem is upstream of the install pipeline — usually in the records that drive harness projection or in the binary itself.
Check:

- `git -C operations status` — uncommitted record changes can confuse harness walkers.
- The substrate validation suite (`closure/rule/compose_rules.run` + `closure/lint/compose_lint.run` over the touched files) — surfaces frontmatter and reference inconsistencies in the corpus.
- The dispatcher's view: boot the engine with `pyfars run --no-services` and inspect the per-tick `rule_fired` and `agent_invoked` witnesses in `.pyfars/event-log/`.

If the pipeline itself is broken — not a record problem — open an issue in `tools/platform/pyfars/work/` and pin it to the failing run's output.
