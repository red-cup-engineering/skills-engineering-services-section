---
title: "Claude is a first-class agentic runtime in the PyFARS dispatch graph"
type: goal
slug: claude-as-pyfars-runtime
milestone: m5-agential-self-generation
status: open
horizon: captured
theory-basis:
  - agential-self-generation
  - normative-operational-layering
  - charter-as-closure-system
  - dispatch-readiness
  - witness-as-increment
  - substrate-purity
  - office-as-fuzzy-cell
related-goals:
  - claude-code-harness-properly-installed             # M1: configuration plumbing for this
  - dispatch-table-bootstrapped-from-substrate         # M2
  - capability-closure-from-substrate                  # M2
  - assignment-cells-written-back                      # M2
  - sessions-wrap-each-tick                            # M4
  - observation-cells-from-invocations                 # M4
  - office-records-gate-authority                      # M5
  - new-skill-records-dispatchable-next-tick           # M5
  - mcp-server-endpoint-exposes-dispatchable-workitems # M8
  - cloud-agent-admission-via-dispatch                 # M8
  - office-bound-admission-policies                    # M8
phases:
  - mcp-as-substrate-tool-surface
  - session-as-office-incumbent
  - dispatch-into-session
  - outcome-witnessed-close
  - sub-agents-as-substrate-bound-sub-sessions
tasks: []
---

# Claude is a first-class agentic runtime in the PyFARS dispatch graph

The previous goal ([`claude-code-harness-properly-installed`](claude-code-harness-properly-installed.md)) installed the configuration plumbing — agent records project to `.claude/agents/`, hook records project to `.claude/settings.json`, the MCP server is wired in `.mcp.json`, the SDK plugin commands sit under `.claude/plugins/`.
That goal landed.
It is *not* the harness.

A harness, in the standard agentic-AI sense, is the orchestration scaffolding that turns an LLM into a useful substrate-bound agent: the work loop, the tool dispatch, the context management, the authority binding, the accountability surface.
This goal names the actual integration: a workitem in the substrate dispatch queue can result in a Claude Code session running against the polity, with the workitem framed as the session's work, the right substrate context seeded into the window, the agent's tools being primarily substrate operations through MCP, the agent's authority bound to a specific office, and the session closing with a witnessed outcome that advances the workitem in substrate.

## Why this is one goal and not five

The five phases below are not independent.
They depend on each other in the substrate-algebraic sense: each one is meaningless without the others.

- An MCP-as-substrate-tool-surface without office-bound authority is a footgun (any session can rewrite anything).
- An office-bound session without a substrate-mediated tool surface has no way to *exercise* its authority.
- A dispatch loop with no outcome-witnessed close cannot advance work; sessions just end.
- Sub-agents that aren't substrate-bound break the witness chain, so the whole loop's auditability collapses to "the parent session said it did the thing."

Holding them as one goal is the discipline that says: this is the integration, this is what the harness *is*, not five projects we'll ship one at a time.

## Substrate parameters this goal assumes

These parameters are committed substrate state, not open questions.
The phases below are written against them; if any of them change, the phases change with them.

- **Regime: strict.** Per [`regime-classification-is-load-bearing`](../../../pypredcomp/docs/dev/decisions/regime-classification-is-load-bearing.md) (committed 2026-05-02).
  Finite value-domain $\mathbf{L} = \{\bot, \mathbf{t}, \mathbf{f}, \top\}$, finite live entity set, quantifier-free closure rules, $\kappa < \omega$, endpoint-only snapshots.
  The dispatch loop's settlement is finite-fuel-bounded per cascade; federation between v0.2-conformant peers ships endpoint state, not trajectories.
  Schema-enforced via `RegimeRecord` in `pypredcomp/src/substrate/regime.py`.

- **Cost quantale: $([0, \infty], +, \min)$ additive.** Per [`cost-is-lawvere-quantale`](../../../pypredcomp/docs/dev/decisions/cost-is-lawvere-quantale.md) (committed 2026-05-02).
  Reads contribute the unit (free); settlements and admissions contribute positive cost.
  The harness's own dispatch and witness emission compose along this axis.
  Reliability $([0, 1], \cdot, \max)$ and bottleneck $([0, \infty], \min, \infty)$ are named alternatives the substrate can declare per-deployment; the 561 substrate uses additive.

- **Witness bilattice axes: `truth` and `evidence`, both bounded $[0,1]$.** Per [`pyfars/entities/witness.py`](../../src/pyfars/entities/witness.py).
  Every MCP write tool produces a `Witness` carrying these two axes; every MCP read returns cells annotated with them.
  The pair is the *grade* on substrate writes; the cost quantale grades the dispatch-loop cost separately.
  The two should not be conflated.

- **Office for the captain's interactive Claude sessions: `office:engineering`** (default), per the office's remit: "substrate infrastructure, FARS, publishing, MCP, tooling."
  The captain's strategic-decision sessions bind to `office:command` instead.
  Autonomous sessions take their office from the workitem's assignment cell.
  The CLAUDE.md fragment at `## Captain` currently reports the captain personnel record as missing — that fragment is stale; `governance/offices/_index.md` already names `personnel:emsenn` as `office:command` holder.
  A re-projection from substrate is part of the M1 housekeeping line, not this goal.

The phases below cite these parameters where they bind a specific design choice; the parameters are not redocumented in each phase.

## The five phases

### Phase 1 — MCP as substrate tool surface

The current `.mcp.json` exposes a `pyfars-substrate` MCP server, but the server today is essentially a stub.
The phase commits the server to a real substrate-operation tool surface:

- **Substrate read tools** — `read-record`, `query-by-cell`, `traverse-relation`, `walk-substrate-tree`.
  The agent's "what's in the substrate" answer is *always* an MCP call, never a `Read` of a file.
- **Substrate write tools** — `append-witness`, `author-record`, `advance-horizon`, `file-finding`, `file-observation`.
  Each tool's call site emits a witness; each tool's success is a substrate transition.
  There is no "write a markdown file" tool that bypasses substrate accounting.
- **Dispatch-graph tools** — `read-queue`, `read-assignment`, `claim-workitem`, `release-workitem`, `escalate-workitem`.
  The session's relationship to its own work is mediated through these.
- **Bilattice-aware tools.** Every read returns the cell's `(truth, evidence)` axes; every write accepts them as parameters and validates against the calling office's authority.
  A session that doesn't ask about evidence cannot accidentally treat a low-evidence cell as load-bearing.

Cites: [`mcp-server-endpoint-exposes-dispatchable-workitems`](#) (M8); [`harness:claude-code-mcp`](../../src/pyfars/harnesses/claude-code-mcp/_index.md).

### Phase 2 — Session as office-incumbent

Today a Claude Code session running in `561/` has no substrate-side identity.
It runs as "the captain" implicitly.
This phase binds each session to a substrate office.

Per the [session-as-incumbent survey](../surveys/session-as-incumbent-from-predgov-and-predcat.md), the substrate-algebraic structure of this binding is **not new machinery** — it is the existing PredGov + PredWork machinery applied to ephemeral occupants, with PredCat closing three specific gaps.
Concretely, the mapping is:

| Operational concept | Substrate-algebraic content |
|---|---|
| Claude session's identity | **Officer** $a$ (`officer.md`) — the body natural, an ephemeral substrate entity. |
| Session-record file | **Incumbency proposition** $\iota$ (`incumbent.md`) with cells `occupant: a`, `office: O`, `at-stage: τ*`. |
| The bound office | **Office** $O$ (`office-as-double-settlement.md`) — body politic, structural cells persistent. |
| `SessionStart` hook firing | **Installation morphism** $I^+(A_\mathrm{installer}, \iota, O, \tau)$ (`installation.md`); installer is the captain's delegated session-installer subroutine. |
| Session reaches "ready" | **Induction** (stage-2 of installation); joint dignitas with recognition predicate. |
| Session "having authority" | **Capability propagation** (per `office-as-double-settlement.md` §"Connection to capability fiber bundle") — office's deontic profile transfers to $\iota$ automatically when dignitas settles. |
| MCP write authority gate | **Authority-gate via residuation** (`delegation-as-authority-residuation.md`): each write is gated by $\rho_a g = a \Rightarrow g$. Out-of-scope writes produce **ultra-vires** witnesses (`jurisdiction-as-base-change.md` (d)). |
| Workitem routing | **Assignment is `to-office`, not to-session** (PredWork's `assignment.md`). Session, *qua* current incumbent, walks office's in-edges. |
| Skill / sub-agent jurisdiction | **Predicate-specialization sub-scope** $\pi: G \hookrightarrow A_O$ on the office's action-domain. Harness install reads office record and projects only the in-scope skills/agents. |
| Session ending | **Succession** (`succession.md`); incumbency relieved; office's structural cells unchanged (*dignitas non moritur*). |

Concrete moves the Phase needs:

- **Session bootstrap is an installation increment.** The `SessionStart` hook fires the substrate-algebraic installation per `installation.md`, with felicity check (appropriate authority via captain-delegation; appropriate procedure via the standard hook-handler procedure; completeness on the four installation cells) by closure rule.
  Returns `additionalContext` JSON to Claude Code via the standard hook-output mechanism, populated by reading the new incumbency's office and walking the office's open assignments.
- **Office authority gates MCP calls via residuation, not via per-tool config.** Every MCP write tool's body invokes the residuation $\rho_a g$ where $a$ is the session's incumbency-derived authority on the requested action.
  The four delegation invariants (derivativity, accountability non-transfer, boundedness, revocability) are inherited from the residuation table — the substrate-algebraic "authority check" cannot be forgotten because it *is* the call.
- **Default office is the harness-install argument.** `pyfars install-harness claude-code-* --office=engineering` writes the default-office cell that the SessionStart hook reads.
  Captain's interactive sessions default to `office:engineering` (XO); autonomous sessions take office from the workitem's assignment cell.
  Office *switching* mid-session is a delegation (sub-incumbency under the same body natural with narrower scope) or a fresh-installation, not a separate primitive.
- **Skill projection is predicate-specialization at install-time.** `pyfars install-harness claude-code-skills --office=engineering` reads the office record's `delegable-skills:` cell (the sub-scope $G \subsetneq A_O$) and projects only those skill records to `.claude/skills/`.
  Same shape for `delegable-sub-agents:`.
  The harness becomes office-shaped, not whole-substrate-shaped.
  The default-if-omitted is **empty** (no powers delegable) per the survey's resolution of the open question's Q2.

Cites: [`office-records-gate-authority`](#) (M5); [`office-bound-admission-policies`](#) (M8); PredGov [`office-as-double-settlement`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/objects/office-as-double-settlement.md), [`installation`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/morphisms/installation.md), [`delegation-as-authority-residuation`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/theorems/delegation-as-authority-residuation.md), [`jurisdiction-as-base-change`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/theorems/jurisdiction-as-base-change.md); PredWork [`assignment`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/objects/assignment.md), [`dispatch`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/morphisms/dispatch.md); PredCat [`closure-2-monad`](../../../../../theories/theories/humanities/theories/math/theories/categories/theories/predication-categories/morphisms/closure-2-monad.md).

### Phase 3 — Dispatch into session

The substrate dispatch queue exists; the heartbeat selects workitems; assignment-cells are written back to substrate.
What's missing: those assignments don't actually *boot* Claude sessions today.
This phase wires the loop:

- **Interactive mode (captain present).** When the captain runs `claude` in the polity-root, the harness's `SessionStart` hook reads the dispatch queue's top eligible workitem for the captain's office and either (a) frames it as the session's opening turn ("your queue says: <workitem>; here's the seeded context: <substrate-cells>; tool surface available: <MCP-tools>") or (b) presents a one-line "next ready: <workitem>; type ! to claim" affordance.
- **Autonomous mode (engine-driven).** When the engine has an assignment-cell with a Claude-runtime agent and no incumbent session, it spawns one via `claude -p "<framed-prompt>"` (or the SDK equivalent), passes the workitem-as-context, lets the agent work to a witnessed close (Phase 4), and harvests the result.
- **Workitem framing is a substrate operation.** The "frame this workitem as a session prompt" step is a deterministic projection from substrate to prompt-text — itself a (dry-run-able) substrate read; not a hand-tuned template.

Cites: [`dispatch-table-bootstrapped-from-substrate`](#) (M2); [`assignment-cells-written-back`](#) (M2); [`engine-runs-as-supervised-service`](#) (M3); [`cloud-agent-admission-via-dispatch`](#) (M8).

### Phase 4 — Outcome-witnessed close

A session today ends when the captain exits or the autonomous run hits its turn limit.
This phase makes session-close a *substrate* event:

- **The workitem's `done-when:` is the session's terminating condition.** The session closes when (a) the agent files a closing finding/observation that asserts the workitem's done-when; (b) the agent escalates to a higher office; (c) the agent times out (witnessed as such).
  No session ends without a closing witness against the workitem.
- **The closing witness binds the session-record to the workitem-record.** It records: which cells were authored/modified, which assignment-cell was consumed, what the closing finding asserts, the (truth, evidence) of the assertion.
- **The dispatch queue advances on close.** The next eligible workitem is ready immediately; the next session boot picks it up.
- **`Stop` hook invokes a `session-close-finding` ritual.** If the agent didn't already file a finding, the hook prompts the session for one before exiting.
  Force-killed sessions are witnessed with a `closure: aborted` cell so the substrate doesn't confuse them with successful closes.

Cites: [`sessions-wrap-each-tick`](#) (M4); [`observation-cells-from-invocations`](#) (M4); [`signed-witness-chain-for-inbound-work`](#) (M8).

### Phase 5 — Sub-agents as substrate-bound sub-sessions

The Claude Code `Agent` tool spawns sub-agents.
Today those sub-agents have no substrate identity, no office, no scoped capability — they inherit the parent session's tool surface and work invisibly to the substrate.
This phase binds them. **Theoretically, a sub-session is a recursively-dispatched workitem** — the parent's `Agent(...)
` call is the closure-2-monad iteration moving down a level, with the sub-session's outcome re-entering the parent's closure context as new substrate cells.
Anthropic's `Agent` tool is the *carrier* for this; the substrate is the principal.

Concretely, four substrate moves are required, in order.
Per the [session-as-incumbent survey](../surveys/session-as-incumbent-from-predgov-and-predcat.md), each maps to existing PredGov machinery:

1. **Parent writes a sub-assignment-cell before spawning.** The parent's `Agent(...)
  ` call is a **delegation morphism** (PredGov `delegation.md`) — the parent, *qua* incumbent of office $O$, authors a derived jural-relation $R^B$ from its office-derived powers $R^P$, with sub-grant $G \subsetneq O.\texttt{delegable-skills} \subsetneq A_O$.
  The MCP `dispatch_subagent` tool authors $R^B$ together with a sub-incumbency proposition $\iota_\mathrm{sub}$; the sub-Claude reads `read_assignment(sub-session-id)` at boot, which walks the sub-office's in-edges (symmetric to parent SessionStart).
  The "sub-assignment-cell" *is* the delegated $R^B$.

2. **`Session` gains a `parent_session_id` field.** PredGov's `incumbent.md` tuples are stage-indexed but not lineage-indexed by default.
  The lineage cell `\langle\iota_\mathrm{sub},\texttt{derived-from-incumbency},\iota_\mathrm{parent}\rangle` is added to the incumbency-proposition shape; it propagates through witness payloads so audits can reconstruct delegation chains via the `derived-from` chain that `delegation.md` already requires.

3. **Office records gain a delegable-powers model.** *Substantially answered by the survey.* The delegable scope is the proper sub-scope $G \subsetneq A_O$ of the office's action-domain, encoded by the **predicate-specialization morphism** $\pi: G \hookrightarrow A_O$ from PredCat.
  Slug-list cells `delegable-skills:` and `delegable-sub-agents:` on the office record name the in-scope substrate entities; the closure rule that admits delegation increments checks (i) $G \subsetneq A_O$ via the strict-specialization criterion of [`delegation-transport-via-beck-chevalley`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/theorems/delegation-transport-via-beck-chevalley.md) §"abdication-vs-delegation criterion", and (ii) $a \geq_k \mathbf{t}$ on the office's authority cell (per `delegation-as-authority-residuation.md` row 2).
  Default-if-omitted is **empty** (no powers delegable) — silence cannot mean "all powers delegable" without algebraic over-affirmation.
  The original [`delegable-powers-distinct-from-full-powers`](../../questions/delegable-powers-distinct-from-full-powers.md) question's Q1, Q2, Q3 are answered; Q4 (closure-rule-module location) is engineering choice.
  The Phase-2 cycle authors the closure rule explicitly.

4. **Sub-MCP boundary enforces the sub-office via the same residuation gate.** The sub-session's MCP calls invoke $\rho_{a'} g'$ where $a'$ is the sub-incumbency's authority cell and $g'$ is the candidate write — the **same residuation operator** as the parent's MCP gate, no separate code path.
  By [`delegation-transport-via-beck-chevalley`](../../../../../theories/theories/humanities/theories/sociology/theories/work/theories/predicated-work/theories/predicated-governance/theorems/delegation-transport-via-beck-chevalley.md) (a)–(c), the four delegation invariants transport row-by-row to the sub-incumbency — the substrate cannot be configured to drop them.
  Claude Code's own `tools=` allowlist is a *belt*; the residuation gate is the *suspenders*.

PredCat's **closure-2-monad lax-idempotence** (per `closure-2-monad.md`) is the formal guarantee that nested sessions converge on the same fixed point as iterated single-level closure: doubly-closed substrate equals singly-closed substrate up to the canonical 2-cell.
Sub-sessions don't fork the substrate's semantics; audit is monotone in the delegation chain.

The witness chain after these four moves is unbroken: every sub-action cites the sub-session-record, which cites the sub-assignment-cell, which cites the parent session-record, which cites the parent workitem.
An audit can trace any leaf action to the root workitem in finite hops.

**Operative empirical question:** [`anthropic-agent-tool-hook-semantics`](../../questions/anthropic-agent-tool-hook-semantics.md) — whether sub-Claude tool calls fire the parent harness's hooks, and which events flow up.
The answer constrains whether Phase 4's outcome-witnessed close can rely on hook-emitted close witnesses for sub-sessions or must go through MCP exclusively.

Cites: [`new-skill-records-dispatchable-next-tick`](#) (M5); [`agential-self-generation`](#) (theory); [`witness-as-increment`](#) (theory); [`closure-2-monad`](../../../../theories/theories/humanities/theories/math/theories/categories/theories/predication-categories/objects/closure-2-monad.md) (theory).

## Done-when

The integration is complete when:

- [ ] An autonomous engine run can pick the highest-priority dispatch-ready workitem, spawn a `claude -p` session bound to the appropriate office, and return when the workitem is closed by a witnessed finding — without operator intervention.
- [ ] The same workitem run interactively (captain in front of `claude`) produces an indistinguishable witness chain: same opening context, same office authority, same closing finding, same advance of the queue.
- [ ] Every MCP tool call in either mode is authority-checked against the session's office; unauthorized calls fail-closed and emit a `permission-denied` witness.
- [ ] `pyfars ledger tally` over a day's work produces a faithful audit of every workitem worked, every office that touched it, every (truth, evidence) cell written, every finding filed, every escalation taken.
- [ ] Sub-agents dispatched mid-session appear as their own session-records in the substrate; their witnesses cite the parent.

## Out of scope (for this goal)

- Federation across polities (M6/M6′).
- Multi-LLM orchestration — *this* goal is Claude-specific.
  Other agent runtimes (Codex, Aider, OpenClaw) get sister goals once this one's pattern is settled.
- Cost-and-energy ledger for the dispatch loop (M10).
- Cryptographic signing of the witness chain (M11).
- Sandboxed cloud-agent admission with anti-abuse policies (M8 elaboration).

The goal commits to the *integration shape*.
The detailed surfaces named in each phase decompose into tasks; those tasks accrete per phase as work is engaged, not in a thirteen-task fan-out at goal-time.

The first phase to engage is Phase 1, with leading-edge plan [`ship-mcp-write-tool-surface`](../plans/ship-mcp-write-tool-surface.md) — `append_witness` as the first MCP write tool, with the hook dispatcher routed through it so the witness path collapses to one codepath.
That is the smallest move that converts the harness from "describes the integration" to "is, in one place, the integration."

## What this goal does *not* claim

- That Claude Code is the *only* agentic runtime PyFARS will integrate with.
  It is the first; the pattern this goal establishes (MCP-as-substrate-tool-surface, session-as-office-incumbent, dispatch-into-session, outcome-witnessed-close, sub-agents-as-substrate-bound-sub-sessions) is the template for Codex, OpenClaw, and any future agent runtime.
- That the substrate's existing dispatch graph is fully ready for this.
  Several of the cited M2 goals (capability-closure, assignment-cells-written-back) are pre-requisites; their gaps surface as work in this goal's phases.
- That hooks are the integration.
  They are cheap session-lifecycle bookkeeping.
  The real interface is MCP-as-substrate-tool-surface (Phase 1).
