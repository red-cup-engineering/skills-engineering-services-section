# Predicate shapes

Every claim is a triple `(subject, predicate, object)`. The cascade
fires pointwise: a composition `A ⊙ B → C` derives a cell at
`(s, C, o)` only when both source fibers have cells at *the same*
`(s, o)` coordinate. Which means the choice of object for a given
predicate is **load-bearing** — it determines which other predicates
can compose with it.

Three shapes recur. Each predicate must commit to one and stay
consistent. Mixing shapes within a fiber (sometimes timestamp,
sometimes subject) breaks pointwise composition silently.

## State flag (diagonal)

A unary proposition *about* the subject. "This task is open." "This
op is completed." "This port is ready."

**Shape:** `(s, P, s) = T` — object is the subject itself.

The diagonal map `Δ: E → E×E, s ↦ (s, s)` is the canonical embedding
of `E` into the `E×E` index space the cascade indexes over. State
flags live on the diagonal because they have no second coordinate to
name — the proposition is unary, and the subject is its own witness.

Every state flag in the workspace agrees on this convention so they
can compose pointwise. `is-open ⊙ has-all-deps-satisfied →
is-task-routable` fires at `(task, _, task)` because both sources
land on the diagonal.

If you want to record *when* the state changed, witness a separate
event-record cell (see below) — don't smuggle the timestamp into the
state flag's object slot.

**Examples:** `is-open`, `is-task-ready`, `is-task-completed`,
`is-pending`, `is-running`, `is-completed`, `is-failed`,
`is-ready-to-run`, `is-ready-to-run-on-{kind}`, `is-worker-available`,
`is-ready`, `is-stopped`, `is-closed`, `is-settled`,
`has-all-deps-satisfied`, `has-all-approvals-satisfied`,
`dispatch-admissible`, every `dispatch-status` cell.

## Relational

The predicate names a specific relation between the subject and a
specific other thing. The object is *which other thing* — that's the
predicate's whole content.

**Shape:** `(s, P, o) = T` where `o` is a meaningful other entity.

Relational predicates participate in compositions only with other
relational predicates that share their object axis (e.g. dispatch's
`considers-task` + `is-worker-available` both keyed by the candidate
identity, paired by the matchmaking-port).

**Examples:** `depends-on`, `has-operation`, `has-assigned-worker`,
`requires-capability`, `has-capability`, `requires-approval`,
`has-approval`, `considers-task`, `considers-worker`, `is-a`,
`specializes-as`, `inverts-as`, `held-by`, `has-role`.

## Event record

A thing happened at a time. The timestamp is the witness — what makes
the cell true is the moment the event occurred.

**Shape:** `(s, P, <iso-8601>) = T` where the object is a timestamp.

Event records exist alongside state flags, not in place of them. The
state flag says "this state holds"; the event record says "this state
was entered at this time". They're different fibers because they
witness different things.

The event log already records the wire-arrival timestamp on every
assertion (`EventRecord.at`); use an event-record cell only when the
*subject's own* timestamp matters separately from arrival — e.g. an
op's completion time as reported by the worker, which can differ
from when the hub received the assertion.

**Examples:** `completed-at`, `books-closed-at`, `started-at`,
`stopped-at`, `ready-at`.

## Why this matters

The fiber-functor construction (paper §3) defines each predicate's
fiber as a function `(s, o) ↦ Value`. Pointwise composition lifts
operations from `Value` to fibers by applying them coordinate-by-
coordinate over the `(s, o)` index space. For two fibers to compose,
they must share that index space.

State flags are mathematically unary — `s ↦ Value`, no `o`
coordinate. The diagonal embedding `Δ` is the natural inclusion
into `E×E`. Sentinel objects ("true", "_") would extend `E` with
elements that aren't members of `E`, breaking the homogeneity of
the Chu space.

Witnessing a state flag with a timestamp object is a category
error: it forces the predicate into the event-record shape, which
has a different mathematical signature, and prevents it from
composing with other state flags.

## When choosing the shape for a new predicate

Ask:

1. Is the object content the *predicate*'s content, or just metadata
   about *when* the cell settled?
   - Content → relational.
   - Just metadata → state flag (use diagonal) plus an event-record
     cell if you need the time.
2. Does the predicate participate in a `⊙` / `⇒` composition with
   another predicate?
   - Yes → both sides MUST agree on the (s, o) shape. State flags
     compose with state flags on the diagonal; relational with
     relational on a shared `o`.
3. Can the proposition be asked of the subject without naming
   anything else? "Is this task open?" yes — state flag. "What does
   this task depend on?" requires naming a dep — relational.

When in doubt: state flags go diagonal.
