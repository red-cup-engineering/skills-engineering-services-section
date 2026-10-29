---
title: "Nix harness"
type: specification
status: draft
authors: [emsenn, claude-opus-4-7]
date: 2026-05-09
supersedes: []
---

# Nix harness

> **Status: draft (RFC).** Names what a Nix harness IS in PyFARS — and crucially, what it is not.
> The current `pyfars/harnesses/nix-flake/` is a deploy framework masquerading as a harness; it bundles cell projection (legitimate harness work) with operator orchestration, profile management, and host-specific path baking (none of which belong in a harness).
> This spec settles the boundary, anchored in the existing [`harness`](../../concepts/harness.md) concept and the [predicated-nix](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/_index.md) sub-theory.

## 1. Problem

Every PyFARS session that touches deployment spirals into archaeology — *which version of pyfars is actually running? did my edit land? where does the binary live? why does `make install` deploy to production?* The friction is structural, not operator-discipline: the current `nix-flake` harness emits a polity flake whose `apps.{install-prod, install-dev, rollback, install, clean}` reimplement, badly, what `nix run`, `nix develop`, the systemd unit's `--pin`'d ExecStart, and `nix-collect-garbage` already do natively.
The reimplementation conflates dev iteration with prod promotion, depends on a `nix profile` layer that earns nothing, and bakes host-specific paths (`$HOME/.local/state/nix/profiles/561-prod`) into the projection as if they were substrate truth.

Consequence: agents arriving at a polity have to reverse-engineer the deploy from scratch, every session.
Hours per session.
The fix is not more documentation — it's removing the layer that needs documenting.

## 2. The harness-as-projection principle (from the concept)

Per [`concepts/harness.md`](../../concepts/harness.md), a harness for runtime $R$ commits to two directions:

- **Outbound projection** — substrate state → $R$-shaped artifacts
- **Inbound transition** — $R$-shaped events → substrate witnesses

Crucially: *"a harness is the exact place where PyFARS's substrate-purity meets the world's mess.
The substrate stays pure; the harness translates substrate into world-conventions and world-events into substrate witnesses."*

A harness is **structure projection**, not procedure.
The runtime's procedures (its build commands, its run commands, its rollback commands) belong to the runtime.
The harness exposes the substrate's content in a shape the runtime can consume.
Operator orchestration that composes runtime procedures is a separate concern — the operator's, or another harness's.

The current `nix-flake` harness violates this by projecting both structure (`packages`, `devShells`, tool `inputs`) AND a wrapped reimplementation of the runtime's own procedures (`apps.install-prod` does what `nix build` + a unit-rewrite does; `apps.rollback` does what re-pinning the unit does; `apps.clean` does what `nix-collect-garbage` does).
The reimplementation requires the profile layer to function.
Stripping the procedures retires the profile layer.

## 3. Predicated-nix grounding

Per [predicated-nix's orienting narrative](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/narratives/nix-mapped-onto-the-substrate.md), Nix is *"a Scott-continuous closure-rule system over a thin partial-order value-domain at the system-realization scope, with strong hash-discipline and wavefront-locality."* Four structural commitments load-bear here:

- **`nix build .#X` IS settling the closure-rule system at cell `X`** ([`scott-continuous-closure-rule-system`](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/concepts/scott-continuous-closure-rule-system.md)).
  Lazy, dependency-ordered, confluent (same-recipe → same-output-path → same-bytes), reaches quiescence after build.
- **Identity-by-outgoing-relations matches at the byte level** ([`derivation-as-cell-shape`](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/concepts/derivation-as-cell-shape.md)).
  A store path's hash is a function of the `.drv`'s outgoing relations.
  The substrate's hash discipline is Nix's hash discipline.
- **Nix's value-domain is thin** ([`thin-value-domain`](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/concepts/thin-value-domain.md)) — `{⊥, recipe-known, realized}`.
  The substrate's bilattice machinery does not transfer; in particular, Nix has no $\mathbf{f}$ or $\top$, so contradiction-surfacing happens via build failure, not value-domain top.
- **Nix is partially self-representing** ([`partial-self-representation`](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/concepts/partial-self-representation.md)) — engine binary lives in the store; closure rules live in the C++ evaluator, NOT as substrate cells.
  We can project cells INTO Nix; we cannot project Nix's evaluation rules INTO substrate.

The concrete consequence for a Nix harness: **the harness's job is to make the polity's substrate cells settleable in Nix's closure-rule system, and to witness Nix's settling events back into the polity's event log.** Outbound = "this substrate cell becomes a flake output"; inbound = "this nix event becomes a substrate witness."

The narrative also names a structural gap: *"Nix has byte-verifiability of current store contents, but not of the trajectory that produced them."* Closing that gap is the inbound side's purpose.
The substrate's append-only event log carries the trajectory Nix itself cannot.

## 4. The Nix harness contract

A Nix harness installation projects exactly four kinds of substrate cells into the polity flake's outputs, and emits exactly four kinds of substrate witnesses on Nix events.
Nothing else.

### 4.1 Outbound — what gets projected

| Substrate cell | Flake output |
|---|---|
| `kind: nix-input` (currently expressed via `nix-package:` frontmatter on tool `_index.md`) | `inputs.<name>` — flake input from the cell's `flake-url` |
| `kind: nix-package` | `packages.<system>.<name>` — a buildable cell |
| `kind: nix-app` | `apps.<system>.<name>` — a runnable verb |
| `kind: nix-devshell` | `devShells.<system>.<name>` — a development environment |

The harness reads these cells from the polity substrate, validates them against the schemas in §4.3, and renders them into the flake.
That is the entirety of the outbound contract.

`packages` and `apps` are the cells operators settle via `nix build .#X` and `nix run .#X --` respectively.
`devShells` are the cells operators enter via `nix develop .#X`.
None requires an "install" step — Nix settles on demand.

For repeated interactive use (an operator iterating against pyfars at a shell), `nix shell .#pyfars` enters a shell with the binary on `$PATH` and amortizes the evaluation over many invocations; `nix run` per-invocation re-evaluates each time.
Operators choose; the harness doesn't impose.

### 4.2 Inbound — what gets witnessed

| Nix event | Substrate witness |
|---|---|
| Successful `nix build .#X` | `make_witness(operator="nix_realize", target=f"nix-cell/{X}", kind="observation", channel="nix", details={cell, store_path, narHash, derivation})` |
| Failed `nix build .#X` | `make_diagnosis_witness(target=f"nix-cell/{X}", failed_operator="nix_realize", cause=<stderr>, related={cell})` — re-uses the substrate's existing diagnosis-recording shape so failure-handling closure rules see Nix failures the same way they see other failures |
| `nix-collect-garbage` of any path | `make_witness(operator="nix_retract", target=f"nix-store/{store_path}", kind="observation", channel="nix", details={store_path, reason})` |
| `nix flake update <input>` (input revision change) | `make_witness(operator="nix_input_bump", target=f"nix-input/{input_name}", kind="observation", channel="nix", details={input, from_rev, to_rev})` |

The harness ships small wrappers (as `pyfars` subcommands — keeps the single-binary-on-PATH discipline) that invoke the corresponding `nix` operations and append witnesses via `EventLog.append` — the single call site preserved per [`witness-emission-is-surface-invariant`](../../claims/witness-emission-is-surface-invariant.md).
Operator-orchestration verbs MUST call these wrappers rather than raw `nix` so the polity's event log carries the settling trajectory Nix itself does not retain.

Implementation notes for the wrappers:

- **`nix flake update`** does not emit input-change events.
  The wrapper reads `flake.lock` before and after the invocation, diffs the `nodes.<input>.locked.rev` for each touched input, and emits one `nix_input_bump` witness per actual change.
- **`nix build`** with `--print-build-logs --json` returns the resolved store paths in the JSON output.
  The wrapper parses them and emits one `nix_realize` witness per output path.
- **`nix-collect-garbage`** with `-d` does not emit per-path events.
  The wrapper snapshots `/nix/store` listing before the invocation, diffs after, and emits one `nix_retract` witness per removed path.

The current `nix-flake` harness is documented as *"projection-only"* in [`concepts/harness.md`](../../concepts/harness.md) on the grounds that *"Nix doesn't talk back."* The predicated-nix analysis refutes this — Nix produces events at every settling step; the substrate is just not currently listening.
This spec re-classes the Nix harness as **bidirectional**.

### 4.3 Cell schemas for the four output kinds

```yaml
# kind: nix-input — declares a flake input. Lives at <tool>/_index.md
# alongside the tool's own substrate (current convention is the
# `nix-package:` frontmatter block; this spec re-anchors it as a
# top-level kind).
kind: nix-input
input-name: <kebab-slug>          # the name in `inputs.<name>` of the flake
flake-url: <nix-flake-url>        # e.g., "git+ssh://git@github.com/emsenn/pyfars"
follows-inputs: [nixpkgs, ...]    # optional; standard "inputs.X.follows" wiring
```

```yaml
# kind: nix-package — declares a buildable cell.
kind: nix-package
name: <kebab-slug>                # the name in `packages.<system>.<name>`
build-type: uv2nix-workspace      # "uv2nix-workspace" | "nixpkgs-passthrough" | "flake-passthrough"
# For uv2nix-workspace: the workspace lives at the polity-relative
# path; the wheel of the named workspace member is the package output.
workspace-path: <polity-relative-path>     # e.g., "tools/platform/pyfars"
workspace-member: <pep-name>               # the [project].name in pyproject.toml
# For nixpkgs-passthrough / flake-passthrough: simpler forms tracked
# as variants; this spec covers uv2nix-workspace as the canonical case.
```

```yaml
# kind: nix-app — declares a runnable verb.
kind: nix-app
name: <kebab-slug>                # the name in `apps.<system>.<name>`
program-package: <nix-package-slug>   # the nix-package whose binary is invoked
program-binary: <bin-name>            # the file under <package>/bin/ to invoke
description: "<short prose>"          # surfaces in `nix run .#<name> --help`
```

```yaml
# kind: nix-devshell — declares a development shell.
kind: nix-devshell
name: <kebab-slug>                # the name in `devShells.<system>.<name>`; "default" is conventional
includes-packages: [<nix-package-slug>, ...]   # packages available in the shell
extra-packages: [<nixpkgs-attr>, ...]          # nixpkgs derivations not in our packages set (e.g., "git", "jq")
shell-hook: |                                  # optional; runs on shell entry
  echo "entering 561 dev shell"
```

A `kind: nix-package` cell may reference a `kind: nix-input` for its source (e.g., a passthrough package whose source comes from a flake input).
The harness validates these references and refuses to render with an unresolved one — same discipline as the rest of the substrate's reference checking.

## 5. What this harness does NOT do

These five things are explicitly out of scope and MUST be retired from `nix-flake`'s current implementation:

1. **No `apps.install-prod` / `apps.install-dev` / `apps.rollback` / `apps.install` / `apps.clean`.** These are operator-orchestration procedures, not flake structure.
  They live in **the polity Makefile** — bash, ~30 lines, auditable, calls into the wrappers from §4.2.
  The Makefile is THE place for orchestration; this spec does not authorize a separate operator-orchestration harness.

2. **No profile-path constants.** No `devProfilePath`, no `prodProfilePath`, no `nix profile add/remove/rollback` calls.
  `nix profile` is for "make a binary appear on a user's $PATH"; the polity has no need to manage its own profiles.
  The systemd unit's `--pin`'d ExecStart binds a service to a settled store path directly; gc-roots (per §6) keep that path alive.
  No profile in the chain.

3. **No host-specific path baking.** No `$HOME/.local/state/nix/profiles/...
  `, no `/home/<user>/...
  ` strings in the projected flake.
  The projection should evaluate on any host the polity declares a `computer-system` record for; host-specific paths come from the substrate cell of the host being deployed to, not from the harness's templates.

4. **No "install pyfars" verb.** Pyfars is a Python app.
  There is no install step.
  `nix run .#pyfars` resolves dependencies, builds (or reads cache), executes.
  The systemd unit's `--pin`'d ExecStart is the one persistent reference; it lives in the `systemd-user` harness's projection, not here.

5. **No deploy log file.** The Nix harness's inbound witnesses (§4.2) ARE the deploy log — append-only, queryable via the substrate's existing event-log read tools (`pyfars witness ...
  `, etc.).
  Operator-side "what was the last deploy" is `pyfars witness --operator nix_realize --target <pyfars-package-cell> --tail 1`.
  No new file format, no separate log path.

## 6. Composition with other harnesses

### 6.1 With `systemd-user` (the engine deploy)

- Operator runs `make deploy-engine`.
- Makefile invokes `pyfars nix-build <cell-slug>` (the wrapper around `nix build`).
  Settles, emits `nix_realize` witness, returns the captured store path.
- The wrapper ALSO writes the gc-root automatically (see §6.3) — operators don't manage gc-roots by hand.
- Makefile invokes `pyfars install-harness systemd-user --pin <store-path>` per [`engine-service-spec`](engine-service-spec.md).
  Unit's `ExecStart` now points at the captured path.
- Makefile reloads systemd and restarts the service.
- The previous deploy's gc-root is rotated (kept for rollback per §6.3).
- "What's deployed" and "when" are queryable as substrate witnesses; no separate log.

Rollback: `make rollback-engine` reads the previous `nix_realize` witness for the same cell, regenerates the unit with that store path's `--pin`, restarts.

### 6.2 With `claude-code-hooks` (and any harness with shims)

Shims that today bake an absolute pyfars path at install time become:

```bash
exec nix run "$CLAUDE_PROJECT_DIR#pyfars" -- hook-dispatch "$1"
```

`nix` is the operator's assumed dependency (the only thing `make install` itself bootstraps).
`nix run` resolves the polity's flake from inside the polity directory; the right pyfars runs.
No path baking; re-installs of pyfars don't require shim regeneration.

This retires the "absolute path baked at install time so this shim works under <runtime>'s constrained shell" workaround class.
The `pyfars install-harness claude-code-hooks` installer (and any sibling shim-emitter) emits the `nix run` form.

### 6.3 GC-root discipline

Settling a cell into a deploy-pinned store path requires a gc-root, otherwise `nix-collect-garbage` (which the polity may invoke periodically as cleanup) retracts the path and the systemd unit fails to start.

- **Path:** `/nix/var/nix/gcroots/per-user/$USER/<polity-slug>-<cell-slug>-<generation>` → captured store path.
  `<generation>` is a monotonic counter starting at 1 per (polity, cell) pair.
- **Created:** by `pyfars nix-build` automatically when the build is part of a deploy context (Makefile passes a `--for-deploy <polity-slug>` flag the wrapper interprets).
  Interactive `nix-build` outside deploy context creates no gc-root.
- **Rotated:** the wrapper keeps the most recent **5** generations per (polity, cell) for rollback.
  Generations beyond the keep-window are unlinked (which, on next `nix-collect-garbage`, releases the underlying store paths).
- **Removed:** `pyfars nix-uninstall <polity-slug>` removes all gc-roots for that polity.
  Used during teardown; not used in normal operation.

Rotating gc-roots produces `nix_retract` witnesses for the released paths exactly as ordinary GC does; the substrate sees rotation and GC as the same kind of event.

## 7. Migration from the current `nix-flake` harness

**In-place strip, slug stays `nix-flake`.** Reasons: (a) the harness IS still flake-emitting; the slug isn't wrong, just narrow; (b) every polity using the harness keeps its existing config record; (c) the bidirectional behavior is an evolution of the same harness, and a slug change would falsely imply two distinct harnesses.
The strip touches:

- `pyfars/harnesses/nix-flake/templates/flake.nix.j2` — remove every `apps.install-*`, `apps.rollback`, `apps.install`, `apps.clean`, `apps.show-paths`, `apps.install-user-units`.
  Remove `devProfilePath`, `prodProfilePath`, the `restartProdServicesSnippet`, the `initSubmodulesSnippet` if it's only used by stripped apps.
  The remaining template projects only `inputs`, `packages.<system>`, `apps.<system>`, `devShells.<system>` — driven by substrate cells per §4.3.
- `pyfars/harnesses/nix-flake/_index.md` — rewrite to describe the new bidirectional contract, cite this spec.
- `pyfars/cli/install_harness.py` — the `_install_nix_flake` and `_uninstall_nix_flake` functions: their work shrinks (less template context to assemble); add the cell-walking that picks up `kind: nix-package` etc. from substrate.
- `pyfars/cli/install_harness.py` — the `_install_claude_code_hooks` function: emit `nix run` form shims, not `/nix/store/<hash>/bin/pyfars`.
  Same pattern for any other shim-emitting harness installer.
- New `pyfars` subcommands: `pyfars nix-build`, `pyfars nix-run`, `pyfars nix-collect-garbage`, `pyfars nix-flake-update` — the wrappers from §4.2.
  Implementation lives at `pyfars/cli/nix_wrappers.py` (one new module).

The polity-side asset record at `governance/assets/computing/nix-flake.md` (in 561, and in any other polity using this harness) gets rewritten: it currently declares `prod-profile`, `dev-profile`, and `nix profile rollback` as substrate truth, all of which become substrate-untruth post-strip.
The new record declares which cells the polity exposes in its flake (which packages, which apps, which devshells) — and that's it.

## 8. Acceptance

A Nix harness installation is "well-formed" when:

- The projected `flake.nix` contains only the four output kinds (§4.1) plus standard flake plumbing (`description`, `outputs`, etc.).
- The flake has no `apps.install-*`, no `apps.rollback`, no `apps.clean`, no profile-path constants, no host-specific paths in rendered output.
- The harness ships the four inbound-witnessing `pyfars` subcommands (`nix-build`, `nix-flake-update`, `nix-collect-garbage`, plus `nix-run` for completeness), each routing through `EventLog.append`.
- Re-running `pyfars install-harness nix-flake` does not change the flake unless a substrate cell of one of the four kinds was added, removed, or modified.
- A static check across the polity's operator-facing scripts (`Makefile`, `bin/`, `scripts/`) finds no raw `nix build`, `nix-collect-garbage`, or `nix flake update` invocations — every operator nix call routes through the wrappers.
  Spelled as a one-line grep in the polity's CI or `make check`:
  ```
  ! grep -rEn 'nix (build|flake update)|nix-collect-garbage' Makefile bin/ 2>/dev/null | grep -v '#'
  ```

## 9. What this specification does not yet decide

The harness contract is buildable on what's settled above.
Three things stay open as honest gaps that don't block shipping:

- **The four open predicated-nix questions** ([four-regime-classification-of-nix](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/questions/four-regime-classification-of-nix.md), [jung-rivieccio-and-nix-hash-discipline](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/questions/jung-rivieccio-and-nix-hash-discipline.md), [binary-caches-as-substrate-federation](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/questions/binary-caches-as-substrate-federation.md), [closure-2-monad-and-nix](../../../../theories/theories/engineering/theories/tech/theories/computing/theories/deployment-systems/theories/nix/theories/predicated-nix/questions/closure-2-monad-and-nix.md)).
  If grounded, would sharpen specific properties of the harness — `closure-2-monad-and-nix` in particular would tell us whether the inbound witnesses guarantee replay-determinism in the substrate's lax-idempotent sense, which would let us promote some §4.2 wrapper behaviors from "best-effort" to "guaranteed."
- **Cell-schema variants for `kind: nix-package` beyond `uv2nix-workspace`.** §4.3 names `nixpkgs-passthrough` and `flake-passthrough` as build-types but doesn't write their schemas.
  The harness implementation should reject these with a "not yet supported" diagnostic; adding them is mechanical when a cell needs them.
- **Cross-host inbound witness routing.** When `nix build` runs in CI (or on a different host than the engine), the witness needs to land in the polity's event log eventually.
  Today's assumption: operator runs from inside the polity directory, witness appends locally.
  Cross-host case waits on the polity's federation-aware witnessing story (per [`wiring-protocols`](wiring-protocols.md) §4.6) and is out of scope here.
