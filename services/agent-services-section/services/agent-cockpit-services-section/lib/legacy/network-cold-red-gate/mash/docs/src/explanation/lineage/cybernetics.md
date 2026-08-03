# Cybernetics

Cybernetics is the study of **control and communication in the
animal and the machine** — Norbert Wiener's phrase, from the
subtitle of his 1948 book. It is the intellectual lineage most
immediately visible in MASH's code: the port taxonomy, the feedback
loops between fibers, the insistence that a system's behavior is
the loop and not any single step within it.

This chapter situates MASH in that lineage — what it takes from
cybernetics, where it goes beyond the mid-century framework, and
why a 2026 system still benefits from reading Wiener.

## Wiener's move

The cybernetic move, stated in one sentence, is **circular causality
over linear causality**. The interesting behavior of systems isn't
$A$ causing $B$; it's $A$ and $B$ in continuing feedback, with
neither prior to the other.

The canonical example is the Watt governor on a steam engine: the
governor senses the engine's speed, narrows a throttle if the
engine is too fast, opens it if too slow. Speed causes throttle
position; throttle position causes speed. Neither "is" the cause.
The system's behavior is the closed loop — its *dynamics*, not any
snapshot.

Wiener generalized the pattern. A thermostat, a biological
homeostasis, a missile guidance system, a conversation — all have
the same shape: sensor, comparator, effector, return path. The
cybernetic program was the study of this shape as a phenomenon in
its own right, independent of whether the substrate is metal,
tissue, or conversation.

## What cybernetics assumes

- **Feedback is primary.** Open-loop behavior is a degenerate case.
- **The observer is in the loop.** The engineer who tunes the
  governor is also subject to feedback from the engine's behavior.
- **Information is distinguishable from energy and matter.** You can
  shape behavior by manipulating patterns of signal, not only by
  brute-force input.
- **Systems have **variety** — a repertoire of possible states —
  and regulation requires matching variety (Ashby's Law of
  Requisite Variety, 1956).

Cybernetics sits between the Shannon/Turing picture and what MASH
needs. It takes the observer seriously in a way Shannon doesn't
(you can't model a thermostat without its measurement of what
it's regulating). But it stops short of the full agential-realist
move — Wiener still talks about regulators as components of a
system they partly observe, not as co-constitutive participants in
what the system *is*.

## The port taxonomy is cybernetic

MASH's [port roles](../architecture/port-roles.md) are named
directly from the control-engineering and cybernetic vocabularies.
The mapping:

| MASH role              | Cybernetic origin                                  |
|------------------------|----------------------------------------------------|
| `mash-port-sensor-*`   | **Receptor** — Wiener's input transducer           |
| `mash-port-actuator-*` | **Output transducer** — control engineering's one-way actuator |
| `mash-port-effector-*` | **Effector organ** — Wiener's output-with-feedback |
| `mash-port-responder-*` | Request-response (more Shannon than Wiener)       |
| `mash-port-projection-*`| Internal regulator — within-substrate feedback    |
| `mash-port-conduit-*`  | **Transmission line** — a passive carrier, not a regulator |
| `mash-port-coupler-*`  | **Impedance matcher** — DSP, physics               |

The distinction between **actuator** (one-way output) and
**effector** (output with return path) is the cybernetic one.
Engineering actuators flip bits; Wiener's effector organs act on an
environment *and then sense what happened*. MASH adopts the more
cautious, smaller word `actuator` for the one-way case so the
`effector` role explicitly denotes the cybernetic full-loop
pattern.

Where the substrate itself fits in this vocabulary: the substrate
is the **central exchange** — the organism's internal medium across
which the loops close. It doesn't have an external equivalent in
the classical cybernetic picture because cybernetics tended to
think of a regulator as one component of a flat system. MASH makes
the medium first-class.

## Ashby's law and the four-valued algebra

Ross Ashby's Law of Requisite Variety (1956) states that a
regulator can match the variety of disturbances at its input only
if the regulator itself has at least that much variety. Too few
regulator states and the system cannot respond finely enough to
remain in its good region.

The four-valued bilattice is the minimum variety necessary to
regulate a predication system:

- **Two values** (True/False) is boolean. It cannot distinguish
  "asserted true" from "nothing known"; all unknowns collapse to
  one side of the dichotomy. A regulator on a boolean-valued
  substrate will behave the same when it has received zero
  evidence and when it has received unanimous negative evidence,
  which is dangerous.
- **Three values** (True/False/Unknown) distinguishes ignorance
  from asserted falsity but cannot represent *contradictory*
  evidence. Two agents witnessing opposing claims force the
  regulator either to drop one witnessing (choosing a truth) or
  flip an error flag. Neither is a real state of the system.
- **Four values** ($\bot$, $t$, $f$, $\top$) is the smallest
  variety in which ignorance AND contradiction are *settled
  states* of the substrate, not errors. This is what the paper
  (Arieli & Avron 1996; Fitting 1991) proves is the minimum
  algebraic structure closed under the operations predication
  actually needs.

So the four-valued choice is not arbitrary. It is the Ashby-law-
compliant minimum: the smallest state space a predication
regulator can have without collapsing genuine distinctions.

## Ports as effector organs

Wiener reserved **effector organ** for the part of a system that
acts on an external environment *and whose consequences the system
perceives*. This is the MASH `effector` role, carefully. Contrast:

- **Actuator** (one-way): push a notification, send an SMS,
  broadcast a packet. If the external world cares, that care is not
  part of the substrate's loop. The world is written-to, and the
  substrate carries on.
- **Effector** (cybernetic): spawn a shell command, invoke an LLM,
  start a container. The external world's response — exit code,
  completion, timeout, output — is *sensed by the effector* and
  witnessed back into the substrate. The substrate closes the loop.

The Shell port (`mash-port-effector-shell`) is the canonical
example. It subscribes to `is-ready-to-run-on-shell`; when that
cell settles, it spawns `sh -c` against the op's `runs-command`,
and it witnesses the result back as cells in `exited-with-code`,
`wrote-stdout`, `wrote-stderr`, `completed-at`, and `exited-because`
(the predicates declared in `mash-vocab-ops`). The substrate's
next cascade sees the loop close.

A system with only actuators is open-loop. Most real systems are
mostly open-loop and dangerous for it. MASH's effector role is
the affordance for *closing* loops that are normally left open —
shell execution, LLM calls, container spawns — so the substrate can
know what it did.

## Projection as internal regulation

Cybernetics distinguishes **external** feedback (with the outside
world) from **internal** feedback (within the system's own
structure). MASH's `projection` role is internal regulation: a
projection port subscribes to fibers and maintains derived state
entirely within the substrate, never crossing the boundary.

The look projection is the example. It subscribes to `look-ready`,
`has-name`, `has-description`, `contains`; it produces
`was-said-in` and `has-body` claims the telnet conduit picks up and
writes to sockets. Nothing in the projection knows about sockets
— it's internal regulation of perception state, mediated by the
substrate's own algebra.

This is the pattern cybernetics called **homeostasis**: the
regulator maintains a variable within range, not by direct external
action, but by adjusting other internal state that eventually
settles the variable. A mature MASH application is mostly
homeostatic — most behavior is projection composition reaching
quiescence, with external ports bridging only where the world must
be touched.

## Where MASH goes beyond 1948 cybernetics

Wiener didn't have:

- **A precise algebra of inference.** Cybernetics talked about
  feedback qualitatively and about signal entropy quantitatively,
  but it didn't have a formal calculus for *how evidence
  combines*. MASH has the Lambek residuation on the Belnap
  bilattice — a precise formal apparatus for extending and
  restricting claims with a proved adjunction. See
  [the mathematics section](../mathematics/index.md).
- **First-class provenance.** Wiener modeled communication channels
  but not the *derivations* information underwent across them.
  MASH's cascade produces derivation chains as data alongside
  settled cells — every claim can be traced through the morphism
  steps that produced it.
- **Agential constitution.** Cybernetics took the observer
  seriously as *part of* the system, but Barad's later move
  (2007) goes further: the observer is *constitutive of what the
  system is*. The [agential realism chapter](agential-realism.md)
  develops this.

Conversely, cybernetics has things MASH's formalism doesn't yet
articulate:

- **Continuous-time dynamics.** The cascade is discrete-step; the
  substrate has no native notion of continuous control. Adding
  time-valued cells is a mechanical extension but not a natural
  extension of the current algebra.
- **Hierarchical control.** Ashby and Powers worked out multi-level
  controllers whose outputs become the reference signals of lower
  levels. MASH has nothing that explicit; the composition algebra
  is flat.

## What to read

- Wiener, *Cybernetics: Or Control and Communication in the Animal
  and the Machine* (1948). The founding text; specifically the
  chapters on feedback, homeostasis, and the distinction between
  receptor and effector organs.
- Ashby, *An Introduction to Cybernetics* (1956). The Law of
  Requisite Variety; a more readable presentation than Wiener's.
- Powers, *Behavior: The Control of Perception* (1973). The
  clearest statement of hierarchical control.
- Maturana & Varela, *Autopoiesis and Cognition* (1980). The
  second-order cybernetics move that anticipates Barad —
  organisms as constitutively self-producing systems.

## See also

- [Port roles](../architecture/port-roles.md) — the concrete
  realization of the cybernetic taxonomy in code.
- [Beyond Shannon and Turing](beyond-shannon-turing.md) — what the
  cybernetic move steps beyond.
- [Agential realism](agential-realism.md) — where the cybernetic
  observer becomes a constitutive participant.
