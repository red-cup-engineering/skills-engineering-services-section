# Agential realism

Karen Barad's *Meeting the Universe Halfway* (2007) develops
**agential realism** — a philosophy of science and a metaphysics in
which the primary ontological unit is neither objects nor subjects,
but **phenomena** enacted through **intra-action**. The *A* in MASH
is meant in this specific sense. This chapter explains what that
means, why MASH chose it as its ground, and how agential realism
shows up concretely in the code.

The chapter reads as philosophy because the concepts are
philosophical. Everything in it has operational consequences that
can be pointed at in `mash-math-proof-engine` and `mash-hub`.

## Barad's starting point

Barad begins with Niels Bohr's interpretation of quantum mechanics.
Bohr noticed that in quantum measurements, properties of the
measured thing are not pre-existing waiting to be read off: they
come into determinate form *only through the measurement
apparatus*. The position of an electron is not a fact that obtains
prior to the apparatus that would measure it; it comes into
determinacy through the specific apparatus used.

Bohr restricted this to quantum-scale phenomena. Barad generalizes:
**all knowledge is apparatus-mediated, and apparatuses enact the
boundaries between subject and object — the "agential cut" — that
allow anything to be a determinate property at all.**

This is not idealism (reality is mind-dependent). It's also not
classical realism (reality is independent of observers). It's a
*third* position: reality is enacted through specific material-
discursive practices, and the "intra-actions" through which
components come to matter are the primary phenomena. Things don't
pre-exist their relationships; they co-emerge with them.

Three moves in the theory:

1. **Intra-action, not interaction.** *Interaction* presumes two
   things existing beforehand that then meet. *Intra-action*
   denotes the primary scene in which constituents come to be
   distinct in the first place.
2. **Phenomena are the ontic unit.** A phenomenon is a specific
   intra-active configuration — the apparatus plus the "observed"
   plus the cut between them, all at once. Objects are
   abstractions from phenomena.
3. **Apparatuses are material-discursive.** Scientific instruments
   *and* social practices *and* concepts are all apparatuses that
   enact particular cuts. Discourse is not separate from
   materiality; they are the same phenomenon viewed through
   different cuts.

## Why this as MASH's ground

Three reasons.

### Reason 1: The substrate has no outside observer

A Shannon/Turing system presupposes a subject outside it who sets
up the channel, writes the program, reads the output. An agential-
realist system doesn't: every reader is part of the intra-active
scene being read.

MASH takes this seriously. There is no wire message to "read the
substrate." There is only `Subscribe(predicate)` — and subscribing
is itself an intra-action: the substrate records `(session,
projects-through, agent)` when the handshake lands, and the
subscription makes the subscribing session part of the phenomenon
it observes. The cell values the session sees are not a passive
report of a prior state; they are settlements produced in part by
the very apparatus (the subscribing agent, the cascade, the
kernel) doing the observing.

This isn't a technical curiosity. It's the design choice:
**there's no god-mode read, because there's no outside from which
to have one.**

### Reason 2: Contradiction is a phenomenon, not an error

Classical realism forces every proposition to be true or false.
Conflict between agents' reports is an error state to be resolved
by consensus, voting, or authority. This makes perfect sense if
there's one pre-existing world that reports try to describe. It
makes *no* sense if phenomena are enacted through intra-action and
different apparatuses can produce different settled determinacies.

The Belnap bilattice is the algebra that takes this seriously:

- $\bot$ (None): no intra-action has produced a determinate
  finding on this phenomenon yet.
- $t$ (True): apparatuses have produced positive evidence.
- $f$ (False): apparatuses have produced negative evidence.
- $\top$ (Both): apparatuses have produced *both*.

`Both` is not an error. It is a settled state of the phenomenon.
`knowledge_join(True, False) = Both` is the precise algebraic
realization of Barad's claim that different cuts can yield
genuinely different determinacies, and that the system's correct
response is to carry all of them.

### Reason 3: Witnessing is the ontologically primary act

In Barad's language, a measurement *enacts* a property rather than
*revealing* one. MASH's verb choice is deliberate: agents
**witness** claims. They don't "insert records," "post data," or
"update state." They witness — the same verb one uses of a
historical event's observers. To witness is to be part of the
intra-action that produces the settled cell.

And every witnessing is itself observable: `(claim, asserted-by,
agent)` is a claim the kernel witnesses about the witnessing. The
apparatus records its own apparatus-ness. This is the formal
counterpart of Barad's insistence that apparatuses are always also
phenomena of their own: nothing is *merely* an apparatus from
nowhere.

## Concrete consequences in the code

### Session subjects are claims, not identifiers

A session in MASH isn't an opaque connection ID. It's a subject
in the substrate — `s0`, `s1`, or `session:tcp:<peer>:<ns>` — that
can be witnessed against. When the telnet conduit mints a session
on a TCP connect, it witnesses `(session, is-newly-connected,
true)`; the welcome projection observes the signal, mints a
puppet, places it in a spawn room. The session is an apparatus
(the telnet connection), a subject (something in the substrate),
and a phenomenon (the set of cells involving the session subject)
all at once.

This is the apparatus/phenomenon duality in code. You cannot read
the MASH substrate without becoming a session subject in it —
because `Subscribe` routes events through the kernel's session
table, which means the hub has a `(session, subscribes-to,
predicate)` cell (or its equivalent) the moment you ask.

### Provenance is witnessed

The five morphism kinds are **homomorphisms between fiber
algebras**, but more than that — they produce *derivation records*
that travel with settled claims. Every `Message::Event` the hub
broadcasts includes a `derivation: Vec<DerivationRecord>` naming
the morphism kind applied and the premise claims combined. The
apparatus that produced the settlement (which morphism, from which
premises) is not hidden; it's part of the phenomenon.

The `mash-vocab-core` crate declares `derived-via`, `derived-from`,
`asserted-by`, `at-time` as canonical predicates so the substrate
itself can reason about its own inference history. An agent that
wants to audit derivation subscribes to `derived-from` and reads
the chain as ordinary claims.

### Port roles are apparatuses

Each of the seven port roles (sensor, actuator, responder,
effector, projection, conduit, coupler) names a specific kind of
apparatus and therefore a specific kind of boundary-making between
substrate and not-substrate. The role isn't a bureaucratic tag —
it's a commitment to what *kind of cut* this port enacts.

- A **sensor** enacts a substrate/outside cut where outside pushes
  determinacy in.
- An **effector** enacts the *same* cut but commits to sensing the
  aftermath.
- An **actuator** enacts the cut one-way — the outside world
  becomes determinate, but the substrate doesn't learn what
  happened.
- A **conduit** is a different apparatus entirely: a neutral
  channel, deliberately thin, that *carries* intra-actions without
  being one itself.

Calling a port the wrong role is not a naming error. It's a
category error about what the port *is*, and it will produce code
that leaks responsibility in ways the taxonomy check catches.

### No schema enforcement

Agential realism refuses the classical-realist move where the
world has a prior structure ("types") the system must faithfully
represent. MASH follows suit: there's no schema for claims. Any
string is a term; any term can be a subject, predicate, or object;
meaning emerges from the claims mentioning the term.

This isn't anarchy. The algebra is tight — `fuse` ⊣ `restrict` is
an exact adjunction, the five morphisms are exhaustive, the
cascade terminates in bounded steps. The structure is in the
algebra, not in pre-declared schemas. That's an agential-realist
commitment: structure emerges from the intra-active machinery, not
from prior categorization.

## What agential realism is not

- **Not relativism.** The algebra is completely fixed. `fuse(t, t)`
  equals `t`, always, and the cascade's behavior on the four
  elements is exhaustively determined. The point isn't that
  everything is up for grabs; it's that the ontic primitives are
  intra-actions (claims) rather than objects (records).
- **Not anti-science.** Bohr was a physicist. Barad is a physicist
  by training. The move is a response to what quantum
  measurements *forced* on the philosophy of science, not a
  rejection of empirical method. MASH's cascade is as deterministic
  (given inputs) as any Turing machine; the algebra just doesn't
  presuppose a subject outside the cascade.
- **Not anti-realist.** Phenomena are real. They just aren't
  composed of objects-with-properties; they're composed of
  intra-active scenes with settled determinacies. The substrate
  is entirely factual; the facts are not about objects in the
  classical sense.

## What this makes hard

- **Explaining to newcomers.** The first question from someone
  familiar with databases is "where's the schema?" The honest
  answer ("there isn't one; the shape emerges from morphism
  declarations and fiber histories") sounds evasive until the
  algebra is understood.
- **Borrowing idioms from elsewhere.** Object-oriented patterns
  presuppose objects with identities. CRUD presupposes resources
  with primary keys. REST presupposes resources with URIs. None of
  these translate cleanly; they can be approximated, but the
  approximation leaks.
- **Debugging with a trace.** Stack traces assume a call stack —
  a linear chain of function applications. MASH has a derivation
  chain, which is a DAG of morphism applications. Reading it is a
  different skill.

## What this makes easy

- **Heterogeneous agents.** Humans, LLMs, shell commands, sensors,
  and UI clients all witness claims the same way. There is no
  translation layer because the substrate's level of description
  is below "agent type."
- **Representing genuine disagreement.** Two users can produce
  conflicting cells on the same triple; the substrate carries
  both as `Both`; downstream ports decide what to do (fail-closed
  policies treat `Both` as "not held"; audit ports surface it;
  resolution ports produce new cells proposing reconciliations).
- **Long-running systems.** A system whose state is its cascade
  history doesn't accumulate "legacy schema"; it accumulates more
  witnessings, and old cells can be overwhelmed by new evidence
  through `knowledge_join` without migration.

## What to read

- Barad, *Meeting the Universe Halfway: Quantum Physics and the
  Entanglement of Matter and Meaning* (2007). The primary source.
  Chapter 4 ("Agential Realism") is the core; chapters on the
  Bohr-Heisenberg debates give the physical grounding.
- Bohr, *Atomic Physics and Human Knowledge* (1958). The
  philosophical-physics corpus Barad builds on.
- Haraway, "Situated Knowledges" (1988). The precursor essay
  Barad cites — the "view from nowhere" has consequences.
- Suchman, *Human-Machine Reconfigurations* (2007). Agential
  realism applied to human-computer interaction; especially
  relevant to MUD-style and conversational-agent applications of
  MASH.

## See also

- [Beyond Shannon and Turing](beyond-shannon-turing.md) — what
  MASH rejects about the classical computing picture.
- [Cybernetics](cybernetics.md) — the intermediate framework
  between classical computing and agential realism.
- [The mathematics](../mathematics/index.md) — the precise algebra in which
  intra-active settlement is realized.
