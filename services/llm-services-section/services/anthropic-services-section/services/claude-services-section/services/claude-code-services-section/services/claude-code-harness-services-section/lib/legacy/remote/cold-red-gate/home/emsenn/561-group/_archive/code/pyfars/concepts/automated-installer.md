---
type: concept
slug: automated-installer
status: draft
revised: 2026-05-09
authored: 2026-05-09
authored-under-cycle: 2026-05-09-session-bootstrap-as-installation
derives-from-claim: session-bootstrap-as-installation
realizes:
  - installation  # PredGov morphism — applied to non-personal-agent installers
theory-basis:
  - installation
  - delegation
  - delegation-as-authority-residuation
  - agential-self-generation
---

# Automated installer

The substrate-algebraic reading of a piece of code (a closure rule firing on a hook event, a CLI subroutine, a daemon process) acting as a non-personal-agent agency in agential operations on offices and personas.
Two distinct kinds of automated operation:

## Kind 1: automated persona-installation (autonomous polities)

The captain delegates the install-power per PredGov [`delegation`](../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/morphisms/delegation.md) to a system-resident installer subroutine, which can then fire installation increments per [`installation`](../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/morphisms/installation.md) without further captain action.
This is the pattern for *fully-autonomous polities* where personas are installed/relieved without manual captain intervention — e.g., a polity that needs to spin up persona-incumbents on demand for cloud-agent workloads.

In 561 today, **this kind is not in use**: persona-installations are performed manually by the captain (per `calder-underhill.md`'s `installed-by: personnel:emsenn` cell, dated 2026-04-05).
The kind is named here because it is a foreseeable extension and because spec [`session-bootstrap-installation`](../governance/specifications/session-bootstrap-installation.md) reserves the cell shape for it.

## Kind 2: automated watch-takeover (per-session)

The SessionStart hook handler fires a *watch-takeover witness* against an existing persona-incumbent — engaging the persona for the body-natural's session per [`session-as-ephemeral-incumbent`](session-as-ephemeral-incumbent.md).
This is **not an installation** — it does not assert a new investiture; it engages an existing one.
The hook handler does not need install-power; it needs *takeover-power*, which the persona implicitly grants to any session whose runtime configuration matches the persona's expected body-natural shape.

In 561 today, this is the operational kind: each Claude session that opens against the polity fires a watch-takeover via the SessionStart hook, asserting `wears-persona: persona:calder-underhill` on the new session-record.

## Why these are not just "the same operation in two flavors"

The two kinds operate at different layers and require different authorities:

| Kind | Operates at | Required authority | Frequency | Output cells |
|---|---|---|---|---|
| Persona-installation | Layer 1 (persona-holds-office) | install-power on the office | Rare (per personnel change) | recognition + induction predicates settle on persona-incumbency proposition |
| Watch-takeover | Layer 2 (session-wears-persona) | takeover-power (granted by persona) | Per session | wears-persona cell on session-record |

Conflating them would mean: every session-bootstrap re-installs the persona into the office, which is both substrate-algebraically wrong (the prior installation is unchanged) and audit-noisy (the audit trail would show daily re-investitures of unchanging incumbents).

## Felicity for an automated watch-takeover (Kind 2, the operational case)

For a watch-takeover witness $W^t(A_\mathrm{handler}, s, \texttt{persona:<slug>}, \tau)$ where $A_\mathrm{handler}$ is the SessionStart hook handler entity:

1. **Persona is incumbent.** The closure rule checks $\langle \texttt{persona:<slug>}, \texttt{holds-office}, O\rangle = \mathbf{t}$ for some office $O$ that is the session's intended bound office (read from harness config).
  Failure → no takeover; failure-witness with `cause: persona-not-incumbent`.

2. **Body-natural shape matches.** The persona's record carries an expected body-natural specification (e.g., for `calder-underhill`: a Claude Code session).
  The handler verifies the running session's `model` and `transport` are compatible.
  Failure → witness with `cause: body-natural-shape-mismatch`.

3. **No conflicting takeover.** The persona must not already be worn by a different active session (single-watch invariant).
  If a prior session's `stage-range-bound.close` has not settled, the takeover blocks unless the prior session is force-relieved.
  (For interactive captain-driven sessions this is rarely a concern; for autonomous cloud-agent sessions the engine must handle relief.)

If felicitous, the handler authors the session-record with `wears-persona:` at $\mathbf{t}$ and emits the watch-takeover witness.
The persona's holds-office cell is unchanged.

## Distinguishing in audit

The audit trail can distinguish manual-captain vs automated installations (Kind 1) by reading `installation.installed-by` on the witness — `personnel:emsenn` vs an `agent:installer-*` slug.
For Kind 2 (watch-takeover), every entry is by-construction automated; the operator slug names which handler instance (e.g., `session_watch_takeover` for the hook handler).

## Composition with revocation / persona-relief

If the captain relieves the persona via PredGov's succession morphism, the persona's `holds-office` cell is retracted; subsequent watch-takeovers fail Kind 2's felicity check (persona-not-incumbent).
Existing in-flight sessions wearing the persona at the moment of relief continue to operate (settling-monotonicity of their wears-persona cell), but their next call to verify authority returns the post-relief state — effectively revoking their authority at the boundary of the next MCP call.

## The captain's standing delegation

In the 561 polity at bootstrap, `personnel:emsenn` (the captain) holds $R^P_\mathrm{install}$ — the standing power to install Claude sessions into a default office — conferred by the polity charter as the base case of the authority recursion (per `installation.md` §"Composition with charter and authority chains").
The captain delegates to a system-resident automated-installer entity, e.g., `agent:claude-session-installer`, with bounded scope:

```yaml
# Captain's standing delegation cells, asserted at polity bootstrap.
- ⟨R^B_install, kind, power⟩ = t
- ⟨R^B_install, active-holder, agent:claude-session-installer⟩ = t
- ⟨R^B_install, scope-action, "install-claude-session-into-office:pyfars-executive-officer"⟩ = t
- ⟨R^B_install, derived-from, R^P_install⟩ = t
- ⟨R^B_install, accountability-resides-in, personnel:emsenn⟩ = t
```

Per [`delegation-as-authority-residuation`](../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/theorems/delegation-as-authority-residuation.md): - The grant is **bounded**: the installer can only install into `office:pyfars-executive-officer`, not arbitrary offices. - **Accountability stays with the captain**: any ultra-vires installation by the installer is attributable to the captain in the audit trail. - The grant is **revocable**: the captain can withdraw the standing delegation at any time. - The four delegation invariants are inherited from the residuation-table rows.

## Felicity for an automated installer

For an installation increment $I^+(A_\mathrm{installer}, \iota, O, \tau)$ where $A_\mathrm{installer}$ is an automated-installer entity:

1. **Appropriate authority.** The closure rule checks $\langle R^B_\mathrm{install}, \texttt{active-holder}, A_\mathrm{installer}\rangle = \mathbf{t}$ AND $\langle R^B_\mathrm{install}, \texttt{scope-action}, \texttt{install-into-}O\rangle = \mathbf{t}$ (or the office-slug appears in the scope's action-set per the predicate-specialization).
  Failure → failure-witness, not installation.

2. **Appropriate procedure.** The system's `installation-form-of` cell for $O$ is settled at $\mathbf{t}$ on `claude-code-session-start-hook` (the hook handler's procedure-id).
  For an office that does not register this procedure, attempted automated installation produces a procedure-failure-witness.

3. **Completeness.** The four installation cells are populated by the hook handler from the hook event payload (session-id from CLAUDE_SESSION_ID env var or generated; office-slug from harness install config; bootstrap stage from the system's stage counter; the installer entity-id is the automated-installer's system slug).

The infelicity diagnosis paths are the same as for personal-agent installers — the closure-rule firing is uniform.

## Distinguishing in audit

The audit trail can distinguish personal-agent vs automated-installer-issued installations by reading the installer cell on the witness: $\langle u_\tau, \texttt{installed-by}, A\rangle$.
If $A$ has cell $\langle A, \texttt{is-automated-installer}, \mathbf{t}\rangle$, the installation was automated.
The accountability cell on $R^B_\mathrm{install}$ chains the responsibility back to the captain regardless.

## Composition with the captain's revocation power

If the captain revokes $R^B_\mathrm{install}$ via a $\top$-asserting increment per [`delegation-as-authority-residuation`](../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/theorems/delegation-as-authority-residuation.md) row 4, the next attempted automated installation fails the felicity check (authority gate) and produces a failure-witness.
Existing sessions installed under the prior delegation persist (settling-monotonicity); new sessions are blocked.

## Why this is not a new substrate primitive

The `automated-installer` concept names a *pattern of installer entity* — one whose `is-automated-installer` cell is at $\mathbf{t}$ and whose install-power chain terminates in a captain-delegation.
All the system machinery (felicity check, accountability propagation, revocation behavior) is the existing PredGov machinery, applied uniformly.
The cycle authors this concept so that the harness install command, the SessionStart hook handler, and audit queries can refer to "the automated installer" as a system-readable role rather than each re-deriving it from `delegation.md`.
