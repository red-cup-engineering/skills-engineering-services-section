# Beyond Shannon and Turing

Mid-twentieth-century computing rests on two foundational pictures:
**Shannon's information theory** (1948) and **Turing's computability
theory** (1936). Both are formally correct. Both are also narrower
than "the theory of computation" — each answers a specific question
by making specific assumptions, and those assumptions show up as
constraints in systems built on them. MASH is built on a different
foundation. This chapter says which assumptions, how MASH rejects
them, and what that buys.

The chapter is not a polemic. Shannon and Turing describe a real
phenomenon — symbol transformation through a channel — and the
systems built on that phenomenon (file systems, compilers, network
protocols) are genuinely what they appear to be. The question is
whether *every* computing system has to be that phenomenon. MASH's
answer is no, and the algebra in [the mathematics
section](../mathematics/index.md) gives a precise alternative.

## Shannon's channel

Shannon's 1948 *A Mathematical Theory of Communication* models
**communication through a noisy channel**. The setup:

- An alphabet $\mathcal{X}$ of symbols known to both sides.
- A source distribution over $\mathcal{X}$.
- A channel that delivers each input symbol to an output symbol
  with some conditional probability (the noise model).
- A sender and a receiver that pre-agree on an encoding / decoding
  scheme.
- Entropy $H(X) = -\sum p(x) \log p(x)$ as the measure of average
  surprise per symbol.
- The channel capacity theorem: there is an encoding scheme whose
  error rate is arbitrarily small iff the source rate is below
  channel capacity.

What Shannon's theory assumes, and therefore what it *cannot model*:

1. **The alphabet is prior.** You cannot ask what the symbols
   *mean* within Shannon's framework; meaning is outside
   the theory ("the semantic aspects of communication are
   irrelevant to the engineering problem," as Shannon said
   explicitly).
2. **The encoding is shared.** Both sides have a copy of the code.
   Who gave it to them, and how, is outside the theory.
3. **The observer is outside.** Someone decides what the source is,
   what the channel is, what success looks like. That someone is
   not in the model.
4. **Noise is random.** The noise model is a probability distribution
   on errors, not a structured disagreement or a witnessed
   contradiction.

This is fine *for what it's for* — designing physical communication
systems. It is not a theory of *what it means for a system to know
something*.

## Turing's tape

Turing's 1936 paper models **computation as transformation of a
tape by a finite state machine**. The setup:

- A tape of cells, each holding a symbol from a finite alphabet.
- A machine with a finite set of internal states.
- A program: a finite transition function
  $\delta : (\text{state}, \text{symbol}) \to (\text{state},
  \text{symbol}, \text{move})$.
- The machine is deterministic and runs until it reaches a halting
  state (or forever).
- A result is read off the tape after halting.

The tape is **passive**: it cannot compute; it cannot observe;
it cannot refuse. The machine is **prior**: the transition function
is fixed before the run. The program is **a God's-eye object**:
it exists independent of the tape it will act on.

What Turing's theory assumes:

1. **A clean separation of program and data.** Programs are
   privileged; data is acted upon. (The Von Neumann architecture
   complicates this slightly — programs can be data — but the
   fundamental asymmetry remains: whoever reads the program is
   outside the running tape.)
2. **Determinism, or stochastic determinism.** Either the next step
   is fully determined or drawn from a known distribution. There
   is no fourth state beyond "ran," "halted," "running forever";
   no "ran with contradictory evidence."
3. **Semantics is added.** The symbols on the tape mean something
   only because a programmer intended them to. The tape itself has
   no semantic content.
4. **Computation is termination-oriented.** The halting problem is
   undecidable, so we care whether it halts; we don't have a
   notion of a computation that never halts but settles.

This too is fine for what it's for — reasoning about what functions
are computable and what resources a computation consumes. It is not
a theory of *how knowledge accumulates in a system distributed over
many independent agents*.

## What both frameworks assume in common

- **A subject outside the system.** Shannon's sender and receiver,
  Turing's programmer, Von Neumann's operator. The theory models
  what the *system* does; it does not model the subject who set
  the system up.
- **Clean duality of syntax and semantics.** Symbols are one thing;
  their meanings another. Symbols are passed around; meanings are
  attached and detached at the endpoints.
- **Computation as transformation.** Inputs become outputs by the
  application of functions. A Turing machine transforms one tape
  into another; a channel transforms sent into received.
- **Error as deviation from a ground truth.** Noise is deviation
  from the signal; a bug is deviation from the program's intent.
  There is a right answer; errors are measured against it.

These assumptions are what *get you* the clean theorems (the
capacity theorem, Church-Turing). They are also what *commit you* to
certain design moves. File systems presuppose a single owner. Type
systems presuppose a compile-time subject checking them. Distributed
databases recover a single truth through consensus protocols because
the underlying model has no room for settled disagreement.

## What MASH does instead

MASH replaces each of these assumptions.

### 1. No prior alphabet

Terms in MASH are strings that the substrate interns *as it sees
them*. There is no symbol set to agree on in advance. The meaning of
a term is the fiber it names — the collection of cells it appears
in. That meaning **accumulates through witnessing**.

When an agent witnesses `(alice, located-at, room:void)`, the
symbols `alice`, `located-at`, and `room:void` become terms in the
substrate, and their meanings are whatever cells witness them. A new
predicate is not declared against a schema — it is introduced by
being used, and its shape emerges from the claims that use it.
Morphism declarations (`(dog, specializes-as, mammal)`) are
themselves claims, not schema statements.

This is not "schema-less" in the NoSQL sense. The algebra is
extremely structured — the bilattice and the five morphisms are
fixed in Rust, proved exhaustive by the paper. What's absent is the
*a priori* agreement about symbol set.

### 2. The witness is inside the system

Shannon's sender and receiver, Turing's programmer, all live outside
the model. MASH's witness lives *inside* the substrate. When an
agent asserts a claim, the substrate records `(claim, asserted-by,
agent)` alongside the claim itself. Provenance is first-class: a
cell's value and its derivation chain are both readable through the
same interface (wire messages subscribe to one predicate at a time;
the derivation records travel with each settlement event).

This is not just a convenience. It's a commitment: **there is no
reader outside the substrate who sees the ground truth.** Every
read is a subscription, every subscription is a claim the session
made, and every session itself is a subject in the substrate.

### 3. No clean syntax/semantics split

A predicate's *meaning* in MASH is operationally its fiber — the
collection of `(subject, object, value)` triples currently asserted
on it. Meaning changes when the fiber changes. There is no
interpreter that takes the syntax and hands back the semantics;
the algebra's settlement IS the semantics, running.

This has a specific formal content: the fiber functor
$\mathcal{F} : \mathcal{C}^{\mathrm{op}} \to \mathbf{BiLat}$ (paper,
Theorem 2) is the functor from predicates-as-syntax to their
bilattice-valued fiber algebras. Syntax and semantics are the two
sides of a functor, not two levels of the same system.

### 4. Computation as settlement, not transformation

The cascade doesn't transform inputs into outputs. It takes a
witnessed claim and propagates consequences under a residuation
(`fuse` ⊣ `restrict`) until the wavefront has nothing left to
derive. `knowledge_join` makes every step monotonic under
$\leq_k$; the orbit bound (Proposition 8) caps depth. The stopping
rule is not "reached a halting state" but "reached quiescence."

The computational content is the cascade's fixed point. There is no
separate notion of "the answer" that you check against a reference.
The substrate's current state *is* the answer, for whatever
question is being pressed on it at the moment.

### 5. Contradiction is a settled state

Shannon's errors and Turing's bugs are deviations from a ground
truth. MASH has no ground truth. If two agents witness opposing
claims on the same cell, `knowledge_join(True, False) = Both`, and
the cell *carries* the disagreement. It doesn't fail; it doesn't
raise an exception; it doesn't force consensus. `Both` is a first-
class value in the four-element bilattice with the same status as
`True` or `False`, and the algebra is well-defined on it.

This is the move that makes MASH a CRDT without work. Conflict
resolution is in the algebra; there's nothing left to design.

## What this buys

- **Native concurrency.** `knowledge_join` is commutative,
  associative, idempotent. Any number of agents can write any
  number of claims in any order; the substrate converges. No locks,
  no consensus, no vector clocks. The paper's theorem establishing
  this is the idempotence of the join; `mash-math-bilattice`'s
  `knowledge_join_is_crdt` test checks it exhaustively.
- **Provenance is structural, not an afterthought.** Logs, audit
  trails, and explanation chains come out of the cascade as data —
  they don't need separate machinery.
- **Integration without translation layers.** Anything that can be
  described as SPO triples over the four-valued algebra fits
  directly — sensors, agents, databases, humans. There is no
  "impedance mismatch" because the substrate doesn't presuppose a
  data model to mismatch *against*.
- **Disagreement survives.** A system that has to produce consensus
  to function cannot represent political, temporal, or epistemic
  conflict. MASH can, and that conflict is addressable by the same
  operations as agreement.

## What this costs

- **No guarantee of outcome without running.** You cannot type-check
  a program and know what it will compute. The cascade has to
  actually run; its result is its behavior.
- **Unfamiliar debugging.** The answer to "why is this cell `False`?"
  is "follow the derivation chain." There is no stack trace of
  function calls because there are no function calls.
- **Opacity to outside reasoning.** Proofs of correctness have to
  be in-substrate (witnessed claims about witnessed claims) or
  about the algebra itself (propositions about the bilattice).
  There is no external logic by which to prove system-level
  properties; the substrate is the logic.
- **Loss of some conveniences.** There is no "call a function and
  get a return value"; there is "witness a claim and subscribe to
  the consequences." Programmers used to synchronous calls find
  this awkward at first.

## When each framework is appropriate

- **Use Shannon/Turing thinking** when there's one subject outside a
  deterministic or stochastic transformer and you need to measure
  its behavior (compilers, codecs, file-level integrity, the
  physical layer of networks).
- **Use MASH-style thinking** when multiple agents contribute
  evidence about a shared reality, when contradiction is part of
  the phenomenon rather than an error, when provenance is
  load-bearing, when concurrent independence is desirable (sensor
  networks, multi-tenant worlds, long-lived collaborative systems,
  MUDs).

The two pictures are not in contradiction; they are answering
different questions. MASH takes the second question seriously enough
to build its foundations from scratch rather than paper over
Shannon/Turing gaps with middleware.

## See also

- [Cybernetics](cybernetics.md) — Wiener's circular-causality
  framework as an intermediate step between Shannon/Turing and
  MASH.
- [Agential realism](agential-realism.md) — Barad's generalization
  of the observer's constitutive role.
- [The mathematics](../mathematics/index.md) — the precise algebra that
  realizes "computation as settlement."
