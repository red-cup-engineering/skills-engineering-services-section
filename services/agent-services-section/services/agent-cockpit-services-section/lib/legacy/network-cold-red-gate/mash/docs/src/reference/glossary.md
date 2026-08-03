# Glossary

Terms with specific meaning in MASH. In alphabetical order; each
entry links to the chapter where the term is motivated.

### actuator
A port crate that carries information *out* of the substrate, one
way. No return path. See [Port roles](../explanation/architecture/port-roles.md).

### agent
A translator: substrate events in, claims out. The
`mash_sdk_agent::Agent` trait. Runs embedded in the hub process or
as a subprocess over the socket. See
[Agents and sessions](../explanation/architecture/agents-and-sessions.md).

### assert
Wire message that witnesses a claim into the substrate. Carries SPO
only; the cascade assigns the value. See
[Claims](../explanation/concepts/claims.md).

### bilattice
A lattice carrying two orderings simultaneously — the four-element
Belnap bilattice `2⊗2` in our case. See [Values](../explanation/concepts/values.md).

### cascade
The settlement process. An assertion propagates through morphism
watchers until no cell's value changes. Terminates in at most two
steps. See [Fibers and the cascade](../explanation/concepts/fibers-and-cascade.md).

### cell
A specific `(subject, predicate, object)` triple in the substrate.
At most one cell per triple. See [Claims](../explanation/concepts/claims.md).

### claim
The atom of the substrate: a subject-predicate-object triple
carrying a [value](#value). See [Claims](../explanation/concepts/claims.md).

### Chu space
The category-theoretic object the substrate is: a predicate-indexed
`Chu(2, 0)` space. `2⊗2 ≅ Chu(2, 0)` by Jakl (2025). The `fuse` and
`restrict` operations are the Chu tensor and linear implication at
the algebra level.

### composition
The morphism that takes two fibers and produces a third via
pointwise knowledge-meet, paired by subject. Commutative. See
[Morphisms](../explanation/concepts/morphisms.md).

### conduit
A port crate that moves bytes across a boundary with no domain
semantics. Telnet, stdio, websocket. See
[Port roles](../explanation/architecture/port-roles.md).

### coupler
A port crate that holds two-way state between the substrate and an
outside system. Reserved role; no instances in the tree yet. See
[Port roles](../explanation/architecture/port-roles.md).

### effector
A port crate that carries information *out* of the substrate with a
return path. Spawns the effect; witnesses the result back. See
[Port roles](../explanation/architecture/port-roles.md).

### fiber
Every cell currently asserted on a single predicate. In the paper:
the fiber algebra `A_p` of the predicate `p`. See
[Fibers and the cascade](../explanation/concepts/fibers-and-cascade.md).

### fuse
The Lambek product `⊙`, left adjoint of restrict. The *extending*
operation. Fn: `mash_math_bilattice::fuse`.

### hub
The single-process owner of the substrate, socket, and persistence
root. See [The hub](../explanation/architecture/hub.md).

### implication
The morphism that takes an antecedent and consequent fiber and
produces a third via `restrict`, paired by subject. Asymmetric.
See [Morphisms](../explanation/concepts/morphisms.md).

### inversion
The morphism that swaps subject and object and negates the value.
See [Morphisms](../explanation/concepts/morphisms.md).

### knowledge ordering (`≤_k`)
The ordering with `None` at the bottom, `Both` at the top, and
`True`/`False` as incomparable middles. Used for evidence
accumulation. See [Values](../explanation/concepts/values.md).

### knowledge_join
The CRDT merge on `2⊗2`. Commutative, associative, idempotent; how
the substrate combines concurrent witnessings.

### morphism
A rule that derives new claims from existing ones. Five kinds,
fixed in Rust: specialization, inversion, composition, fusion,
implication. Users declare *instances*, not new kinds. See
[Morphisms](../explanation/concepts/morphisms.md).

### owner-agent
An agent whose purpose is to mount baseline claims into the
substrate at boot (vocabulary, scene instance data). Runs embedded;
`translate` is usually the empty default. See
[Agents and sessions](../explanation/architecture/agents-and-sessions.md).

### pointwise (same-(s, o))
The binary morphisms (composition, fusion, implication) fire at a
shared $(s, o)$ coordinate: the two premise cells must sit at the
same subject *and* the same object, and the derived cell lands at
that same coordinate. The object rides through unchanged; there is
no structured pair-O carrier. Evidence that naturally lives at
different objects is paired in a subscribe-and-cache port instead.
See [Morphisms](../explanation/concepts/morphisms.md).

### port
A crate that moves information across a boundary. Seven roles —
sensor, actuator, responder, effector, projection, conduit,
coupler. See [Port roles](../explanation/architecture/port-roles.md).

### post-closure
Raising any remaining in-scope `None` cells to `Both` after the
cascade quiesces. Fn: `mash_math_bilattice::post_close`.

### predicate
The middle element of a triple. Interned as a term like everything
else. Indexes a [fiber](#fiber).

### predication
The act of applying a predicate to a subject-object pair to produce
a valued claim. The paper calls the algebraic structure of this act
a *predication modal geometry* and proves it is a Chu space.

### projection
A port crate that stays inside the substrate: subscribes to fibers,
derives state, witnesses derived claims. Most MUD logic lives here.
See [Port roles](../explanation/architecture/port-roles.md).

### residuation
An adjunction of the form `fuse(a, p) ≤ q  iff  p ≤ restrict(a, q)`.
The mathematical structure of predicate-argument combination. The
paper instantiates it on `2⊗2`; `mash-math-bilattice` verifies it
exhaustively.

### responder
A port crate with a request-response outside boundary. HTTP, MCP,
GraphQL. See [Port roles](../explanation/architecture/port-roles.md).

### restrict
The Lambek implication `⇒`, right adjoint of fuse. The *restricting*
operation. Fn: `mash_math_bilattice::restrict`.

### scene
A crate of instance data over some vocabulary: rooms, characters,
starting world state. Under `mash-scene-*`. See
[Write a scene](../how-to/write-a-scene.md).

### sensor
A port crate that carries information *into* the substrate. Webhook,
log shipper, poller. See [Port roles](../explanation/architecture/port-roles.md).

### session
A single connection to the hub. Identified by a kernel
`SessionId` and represented in the substrate by a session subject
(e.g. `s0`, `session:tcp:<peer>:<ns>`). See
[Agents and sessions](../explanation/architecture/agents-and-sessions.md).

### SPO
Subject-predicate-object — the identifying triple of a cell. Also
called a *triple*.

### specialization
The morphism that lifts every cell from a source fiber into a target
fiber unchanged. See [Morphisms](../explanation/concepts/morphisms.md).

### substrate
The shared reality the hub owns: the interned term table, the
fibers, the morphism registry, the watchers. Programmatically
`mash_math_proof_engine::Semiotics`.

### term
An interned string. Every subject, predicate, and object is a term
with a stable `TermId` for the lifetime of the substrate.

### trigger predicate
One of eleven reserved predicate names (`specializes-as`,
`inverts-as`, six composition/fusion/implication role names,
three target names) whose assertion installs a morphism instance.
See [Morphisms](../explanation/concepts/morphisms.md).

### truth ordering (`≤_t`)
The ordering with `False` at the bottom, `True` at the top, and
`None`/`Both` as incomparable middles. Used for implication and
residuation. See [Values](../explanation/concepts/values.md).

### value
One of `None`, `True`, `False`, `Both` — the Belnap four. See
[Values](../explanation/concepts/values.md).

### vocabulary (vocab)
A crate that owns a coherent slice of the predicate space by
declaring baseline claims for it at boot. Under `mash-vocab-*`.

### witness
The verb for asserting a claim. An agent *witnesses* a triple; the
substrate carries the evidence. Verb choice is deliberate — cells
accumulate witnessings, and the substrate never forgets them (it
joins them). See [Claims](../explanation/concepts/claims.md).

### witness (noun)
The object-position term of a claim — what the claim is *about*.
In `(alice, located-at, room:void)`, `room:void` is the witness of
Alice's location.

### witness (handle)
`mash_sdk_client::Witness` — the cheap-clone handle an agent holds
to emit assertions. Usually passed into tasks that effect external
work and report back.

### wire
The JSON-lines socket protocol. Types in
`mash_math_inference::wire`.
