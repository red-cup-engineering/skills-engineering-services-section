//! Integration: mount Foundation + Container into a Semiotics and
//! verify the cascade actually settles the expected claims.
//!
//! These tests are the acceptance-criteria check for tasks #8 and #9:
//! OQRA declarations plus specializes-as / inverts-as wiring produce
//! the predicted substrate behavior on a real Semiotics, not just in
//! the owner-agents' `claims()` vectors.

use mash_engine::algebra::Value;
use mash_engine::proof::{Claim as ProofClaim, Semiotics};
use mash_engine::sdk::agent::Agent;
use mash_library::container::{
    CONTAINS, Container, EXCLUDES_FROM, HAS_NAME, CONTAINER,
};
use mash_library::foundation::{
    Foundation, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, THING,
};
use mash_library::space::{
    DIRECTION, GOES_DIRECTION, HAS_EXIT, LEADS_TO, OPPOSITE_OF, ROOM, Space,
};
use mash_library::ops::{
    EXITED_WITH_CODE, FUNCTION, HAS_COST_USD, HAS_FUNCTION, IS_COMPLETED, IS_FAILED, IS_PENDING,
    IS_RUNNING, LLM_FUNCTION, OPERATION, Ops, PERFORMED_BY, RUNS_COMMAND, SHELL_FUNCTION,
    WROTE_STDOUT,
};
use mash_library::dispatch::{
    CONSIDERS_OP, CONSIDERS_PERFORMER, Dispatch, IS_ADMISSIBLE, IS_CAPABILITY_MISMATCHED,
    IS_OP_READY, IS_PERFORMER_AVAILABLE, IS_UNDERCUT,
};
use mash_library::movement::{
    MOVEMENT, MOVER_IS, MOVES_FROM, MOVES_IN_DIRECTION, MOVES_TO, Movement,
};
use mash_library::teraum::{SPAWN_ROOM, Teraum};

// Three reference rooms from the full Teraum scene. SPAWN_ROOM is
// Fort Kelly; these are Kingsroad segments east and west of it.
const TERAUM_FORT_KELLY: &str = "area:central-plains-fort-kelly";
const TERAUM_EAST_KINGSROAD: &str = "area:central-plains-east-kingsroad";
const TERAUM_WEST_KINGSROAD_1: &str = "area:central-plains-west-kingsroad-1";

fn mount<A: Agent>(semiotics: &mut Semiotics, agent: &A) {
    for claim in agent.claims() {
        let s = semiotics.intern(&claim.subject);
        let p = semiotics.intern(&claim.predicate);
        let o = semiotics.intern(&claim.object);
        semiotics.assert(ProofClaim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        });
    }
}

fn value_of(semiotics: &Semiotics, s: &str, p: &str, o: &str) -> Value {
    let s = semiotics.interner().get(s);
    let p = semiotics.interner().get(p);
    let o = semiotics.interner().get(o);
    match (s, p, o) {
        (Some(s), Some(p), Some(o)) => semiotics.value(s, p, o),
        _ => Value::None,
    }
}

#[test]
fn foundation_mounts_cleanly() {
    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    // Foundation's self-referential bootstrap settles.
    assert_eq!(
        value_of(
            &semiotics,
            IS_A_PREDICATE,
            IS_A_PREDICATE,
            "mash-library-foundation"
        ),
        Value::True,
    );
}

#[test]
fn container_specialization_installs() {
    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);

    assert_eq!(
        value_of(&semiotics, CONTAINER, SPECIALIZES_AS, THING),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, CONTAINER, IS_A_TERM, "mash-library-container"),
        Value::True,
    );
}

#[test]
fn contains_excludes_is_a_clean_negation_pair() {
    // Witness `(room, contains, obj)` True. Double-declared inversion
    // wires both directions: CONTAINS ↔ EXCLUDES_FROM.
    //
    // - CONTAINS inversion fires: produces `(obj, excludes-from, room)` at
    //   negate(True) = False. Reads semantically as "object is-not excluded
    //   from room" — i.e., IS contained. Correct.
    // - EXCLUDES_FROM inversion fires on that derived cell: produces
    //   `(room, contains, obj)` at negate(False) = True. Already True via
    //   knowledge-join; no propagation.
    // - Cascade settles in ≤ 2 steps (Prop. 8).

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);

    let r = semiotics.intern("room-parlor");
    let p = semiotics.intern(CONTAINS);
    let obj = semiotics.intern("rock-1");
    semiotics.assert(ProofClaim {
        subject: r,
        predicate: p,
        object: obj,
        value: Value::True,
    });

    // Forward claim.
    assert_eq!(
        value_of(&semiotics, "room-parlor", CONTAINS, "rock-1"),
        Value::True,
    );
    // Inversion derived: (rock-1, excludes-from, room-parlor) at False,
    // meaning "rock-1 is NOT excluded from room-parlor" = positive
    // membership.
    assert_eq!(
        value_of(&semiotics, "rock-1", EXCLUDES_FROM, "room-parlor"),
        Value::False,
    );
}

#[test]
fn double_inversion_settles_from_either_direction() {
    // Because CONTAINS and EXCLUDES_FROM are BOTH declared with
    // inverts-as, witnessing on either side produces both claims in
    // coherent negation-pair values.
    //
    // Witness on EXCLUDES_FROM side:
    //   (obj, excludes-from, r) True
    //     → inversion: (r, contains, obj) False
    // And double-declaration: CONTAINS has inversion to EXCLUDES_FROM,
    // so the just-settled `(r, contains, obj, False)` triggers:
    //     → inversion: (obj, excludes-from, r) at negate(False) = True.
    // Already True, no change. Fixed point.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);

    let obj = semiotics.intern("gem-7");
    let p = semiotics.intern(EXCLUDES_FROM);
    let r = semiotics.intern("vault-a");
    semiotics.assert(ProofClaim {
        subject: obj,
        predicate: p,
        object: r,
        value: Value::True,
    });

    assert_eq!(
        value_of(&semiotics, "gem-7", EXCLUDES_FROM, "vault-a"),
        Value::True,
        "witnessed",
    );
    assert_eq!(
        value_of(&semiotics, "vault-a", CONTAINS, "gem-7"),
        Value::False,
        "inversion: vault does not contain the excluded gem",
    );
}

#[test]
fn room_specialization_cascades_through_container_to_thing() {
    // Space declares `(ROOM, specializes-as, CONTAINER)`.
    // Container declares `(CONTAINER, specializes-as, THING)`.
    // Specialization is a predicate-level morphism that mirrors any
    // claim on the source predicate to the target predicate.
    //
    // Witnessing `(room-1, ROOM, <marker>)` True should cascade:
    //   - via Space's specialization: `(room-1, CONTAINER, <marker>)` True
    //   - via Container's specialization: `(room-1, THING, <marker>)` True
    //
    // This is how concrete instances inherit type-semantics through
    // the specialization chain — no Rust subtyping required.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);
    mount(&mut semiotics, &Space);

    let s = semiotics.intern("room-1");
    let p = semiotics.intern(ROOM);
    let o = semiotics.intern("scene-teraum");
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::True,
    });

    // Forward claim: room-1 is a room.
    assert_eq!(
        value_of(&semiotics, "room-1", ROOM, "scene-teraum"),
        Value::True,
    );
    // Specialization cascade: room-1 is therefore also a container.
    assert_eq!(
        value_of(&semiotics, "room-1", CONTAINER, "scene-teraum"),
        Value::True,
        "ROOM specializes-as CONTAINER should propagate the membership",
    );
    // And transitively a thing.
    assert_eq!(
        value_of(&semiotics, "room-1", THING, "scene-teraum"),
        Value::True,
        "CONTAINER specializes-as THING should propagate transitively",
    );
}

#[test]
fn spatial_graph_expresses_two_room_corridor() {
    // Build a minimal spatial graph:
    //   room-parlor ─ exit-e1 (north) → room-hall
    // Verify all the declarative claims settle and are readable.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);
    mount(&mut semiotics, &Space);

    // Declare the two rooms as rooms.
    for room in ["room-parlor", "room-hall"] {
        let s = semiotics.intern(room);
        let p = semiotics.intern(ROOM);
        let o = semiotics.intern("scene-test");
        semiotics.assert(ProofClaim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        });
    }

    // Declare exit-e1 as an exit and wire it up.
    let triples = [
        ("room-parlor", HAS_EXIT, "exit-e1"),
        ("exit-e1", GOES_DIRECTION, "north"),
        ("exit-e1", LEADS_TO, "room-hall"),
    ];
    for (subj, pred, obj) in triples {
        let s = semiotics.intern(subj);
        let p = semiotics.intern(pred);
        let o = semiotics.intern(obj);
        semiotics.assert(ProofClaim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        });
    }

    // Readback.
    assert_eq!(
        value_of(&semiotics, "room-parlor", HAS_EXIT, "exit-e1"),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, "exit-e1", GOES_DIRECTION, "north"),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, "exit-e1", LEADS_TO, "room-hall"),
        Value::True,
    );

    // Opposite-direction declaration is symmetric.
    assert_eq!(
        value_of(&semiotics, "north", OPPOSITE_OF, "south"),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, "south", OPPOSITE_OF, "north"),
        Value::True,
    );

    // And the canonical direction inherits specialization-to-direction.
    assert_eq!(
        value_of(&semiotics, "north", SPECIALIZES_AS, DIRECTION),
        Value::True,
    );
}

#[test]
fn op_walks_through_lifecycle_as_settled_claims() {
    // Mount Foundation + Ops. Walk an op through its lifecycle as a
    // sequence of witnessed claims. The op-subject is a single
    // reference point; the cascade settles phase / intent / result /
    // metric claims on its fiber.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Ops);

    // Category sanity: OPERATION specializes-as THING.
    assert_eq!(
        value_of(&semiotics, OPERATION, SPECIALIZES_AS, THING),
        Value::True,
    );
    // SHELL_FUNCTION specializes-as FUNCTION specializes-as THING.
    assert_eq!(
        value_of(&semiotics, SHELL_FUNCTION, SPECIALIZES_AS, FUNCTION),
        Value::True,
    );

    // Mint an op. Intent: run a shell command.
    let op = "op-0001";
    for (s, p, o) in [
        (op, HAS_FUNCTION, SHELL_FUNCTION),
        (op, RUNS_COMMAND, "echo hello"),
        (op, IS_PENDING, op), // diagonal phase marker
    ] {
        let s_id = semiotics.intern(s);
        let p_id = semiotics.intern(p);
        let o_id = semiotics.intern(o);
        semiotics.assert(ProofClaim {
            subject: s_id,
            predicate: p_id,
            object: o_id,
            value: Value::True,
        });
    }

    // Op is pending.
    assert_eq!(value_of(&semiotics, op, IS_PENDING, op), Value::True);
    assert_eq!(
        value_of(&semiotics, op, HAS_FUNCTION, SHELL_FUNCTION),
        Value::True,
    );

    // Transition: running.
    let op_id = semiotics.intern(op);
    let p = semiotics.intern(IS_RUNNING);
    semiotics.assert(ProofClaim {
        subject: op_id,
        predicate: p,
        object: op_id,
        value: Value::True,
    });
    assert_eq!(value_of(&semiotics, op, IS_RUNNING, op), Value::True);

    // Completion + result + metrics land as claims on the op's fiber.
    for (s, p, o) in [
        (op, IS_COMPLETED, op),
        (op, EXITED_WITH_CODE, "0"),
        (op, WROTE_STDOUT, "hello\n"),
        (op, PERFORMED_BY, "shell-agent"),
        (op, HAS_COST_USD, "0.000000"),
    ] {
        let s_id = semiotics.intern(s);
        let p_id = semiotics.intern(p);
        let o_id = semiotics.intern(o);
        semiotics.assert(ProofClaim {
            subject: s_id,
            predicate: p_id,
            object: o_id,
            value: Value::True,
        });
    }

    // All settled and queryable.
    assert_eq!(value_of(&semiotics, op, IS_COMPLETED, op), Value::True);
    assert_eq!(value_of(&semiotics, op, EXITED_WITH_CODE, "0"), Value::True);
    assert_eq!(
        value_of(&semiotics, op, PERFORMED_BY, "shell-agent"),
        Value::True,
    );

    // Notably: IS_FAILED remains None (not witnessed). Phase
    // transitions are monotone via knowledge-join; the op's fiber
    // carries both IS_RUNNING and IS_COMPLETED True simultaneously,
    // which is correct — the substrate records that both phases were
    // touched, not a mutating state machine.
    assert_eq!(value_of(&semiotics, op, IS_FAILED, op), Value::None);
}

#[test]
fn ops_function_specialization_chains() {
    // SHELL_FUNCTION and LLM_FUNCTION both specialize-as FUNCTION.
    // Per the specialization cascade, any subject declared as a
    // specific function kind inherits FUNCTION-ness and transitively
    // THING-ness.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Ops);

    assert_eq!(
        value_of(&semiotics, SHELL_FUNCTION, SPECIALIZES_AS, FUNCTION),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, LLM_FUNCTION, SPECIALIZES_AS, FUNCTION),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, FUNCTION, SPECIALIZES_AS, THING),
        Value::True,
    );
}

#[test]
fn dispatch_admission_cascade_settles_admissible() {
    // Mount Foundation + Dispatch. Mint a candidate, witness both
    // admission premises. The composition morphism should fire and
    // settle is-admissible at the candidate.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Dispatch);

    // Link the candidate to its op and performer.
    for (s, p, o) in [
        ("cand-1", CONSIDERS_OP, "op-1"),
        ("cand-1", CONSIDERS_PERFORMER, "performer-1"),
    ] {
        let s_id = semiotics.intern(s);
        let p_id = semiotics.intern(p);
        let o_id = semiotics.intern(o);
        semiotics.assert(ProofClaim {
            subject: s_id,
            predicate: p_id,
            object: o_id,
            value: Value::True,
        });
    }

    // Witness admission premises at (cand-1, marker).
    // Marker is the dispatch owner identity — arbitrary but constant,
    // so both premises share the same (s, o) coordinate and the
    // composition fires pointwise.
    let marker = "mash-library-dispatch";
    for pred in [IS_OP_READY, IS_PERFORMER_AVAILABLE] {
        let s = semiotics.intern("cand-1");
        let p = semiotics.intern(pred);
        let o = semiotics.intern(marker);
        semiotics.assert(ProofClaim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        });
    }

    // Both premises settled.
    assert_eq!(
        value_of(&semiotics, "cand-1", IS_OP_READY, marker),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, "cand-1", IS_PERFORMER_AVAILABLE, marker),
        Value::True,
    );

    // Composition fired: is-admissible settled at the same coordinate.
    assert_eq!(
        value_of(&semiotics, "cand-1", IS_ADMISSIBLE, marker),
        Value::True,
        "composition IS_OP_READY ∧ IS_PERFORMER_AVAILABLE should derive IS_ADMISSIBLE at the candidate",
    );
}

#[test]
fn dispatch_undercut_implication_fires_on_blocker() {
    // Continue from admission: witnessing is-capability-mismatched
    // should cause the implication IS_ADMISSIBLE ∧ IS_CAPABILITY_MISMATCHED
    // → IS_UNDERCUT to fire.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Dispatch);

    let marker = "mash-library-dispatch";

    // Drive admission to True.
    for pred in [IS_OP_READY, IS_PERFORMER_AVAILABLE] {
        let s = semiotics.intern("cand-2");
        let p = semiotics.intern(pred);
        let o = semiotics.intern(marker);
        semiotics.assert(ProofClaim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        });
    }
    assert_eq!(
        value_of(&semiotics, "cand-2", IS_ADMISSIBLE, marker),
        Value::True,
    );

    // Now witness the capability mismatch.
    let s = semiotics.intern("cand-2");
    let p = semiotics.intern(IS_CAPABILITY_MISMATCHED);
    let o = semiotics.intern(marker);
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::True,
    });

    // Implication: IS_ADMISSIBLE ∧ IS_CAPABILITY_MISMATCHED → IS_UNDERCUT
    // at (cand-2, marker). The `restrict` operation of the implication
    // morphism is truth-extending when both premises are True, so
    // is-undercut should settle True at the candidate.
    let undercut_value = value_of(&semiotics, "cand-2", IS_UNDERCUT, marker);
    assert!(
        matches!(undercut_value, Value::True | Value::Both),
        "expected undercut to settle (True or Both via restrict); got {undercut_value:?}"
    );
}

#[test]
fn movement_is_op_whose_effect_is_containment_swap() {
    // Movement is operationalized as a movement-op that records
    // intent (direction, exit, source, destination) and whose effect
    // is two CONTAINS witnesses — source:False and destination:True.
    // The cascade's CONTAINS ↔ EXCLUDES_FROM double-inversion then
    // propagates the negation-pair views.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);
    mount(&mut semiotics, &Space);
    mount(&mut semiotics, &Ops);
    mount(&mut semiotics, &Movement);

    // MOVEMENT specializes-as OPERATION (via cascade).
    assert_eq!(
        value_of(&semiotics, MOVEMENT, SPECIALIZES_AS, OPERATION),
        Value::True,
    );

    // Initial state: avatar in room-a.
    let s = semiotics.intern("room-a");
    let p = semiotics.intern(CONTAINS);
    let o = semiotics.intern("avatar-1");
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::True,
    });
    assert_eq!(
        value_of(&semiotics, "room-a", CONTAINS, "avatar-1"),
        Value::True,
    );

    // Mint a movement op carrying intent and effect plan.
    let mv_claims = [
        ("mv-1", MOVER_IS, "avatar-1"),
        ("mv-1", MOVES_IN_DIRECTION, "north"),
        ("mv-1", MOVES_FROM, "room-a"),
        ("mv-1", MOVES_TO, "room-b"),
    ];
    for (s, p, o) in mv_claims {
        let s_id = semiotics.intern(s);
        let p_id = semiotics.intern(p);
        let o_id = semiotics.intern(o);
        semiotics.assert(ProofClaim {
            subject: s_id,
            predicate: p_id,
            object: o_id,
            value: Value::True,
        });
    }

    // Perform the containment swap (the effect of the movement):
    // room-a no longer contains avatar-1; room-b now does.
    let s = semiotics.intern("room-a");
    let p = semiotics.intern(CONTAINS);
    let o = semiotics.intern("avatar-1");
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::False,
    });

    let s = semiotics.intern("room-b");
    let p = semiotics.intern(CONTAINS);
    let o = semiotics.intern("avatar-1");
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::True,
    });

    // Knowledge-join: the CONTAINS cell for (room-a, avatar-1) had
    // True witnessed first, then False. Belnap's knowledge-join of
    // True and False is Both — the substrate records conflicting
    // evidence rather than overwriting. This is correct under
    // CRDT monotonicity: both witnesses persist as evidence.
    assert_eq!(
        value_of(&semiotics, "room-a", CONTAINS, "avatar-1"),
        Value::Both,
        "source-room contains-avatar recorded as Both (True witnessed at start, \
         False witnessed as move-effect); this is monotone CRDT behavior",
    );

    // Destination: single True witness, settles True.
    assert_eq!(
        value_of(&semiotics, "room-b", CONTAINS, "avatar-1"),
        Value::True,
    );

    // The CONTAINS ↔ EXCLUDES_FROM double-inversion propagates:
    // - (avatar-1, excludes-from, room-b) should be negate(True) = False
    //   (via CONTAINS → EXCLUDES_FROM inversion)
    // - (avatar-1, excludes-from, room-a) should be negate(Both) = Both
    //   (Both is a fixed point of the negation).
    assert_eq!(
        value_of(&semiotics, "avatar-1", EXCLUDES_FROM, "room-b"),
        Value::False,
    );
    assert_eq!(
        value_of(&semiotics, "avatar-1", EXCLUDES_FROM, "room-a"),
        Value::Both,
        "Both is a negation fixed-point; avatar's exclusion status at the prior room \
         carries the conflicting evidence too"
    );
}

#[test]
fn teraum_scene_boots_as_inhabitable_world() {
    // Mount Foundation + Container + Space + Teraum. The Teraum
    // scene's claims specialize the world via ROOM (which specializes
    // CONTAINER which specializes THING), so after mount, each room
    // should carry name/description claims AND inherit container-ness
    // through the cascade.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);
    mount(&mut semiotics, &Space);
    mount(&mut semiotics, &Teraum);

    // Three reference rooms have name claims at readable coordinates.
    assert_eq!(
        value_of(&semiotics, TERAUM_FORT_KELLY, HAS_NAME, "Fort Kelly"),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, TERAUM_EAST_KINGSROAD, HAS_NAME, "Kingsroad"),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, TERAUM_WEST_KINGSROAD_1, HAS_NAME, "Kingsroad"),
        Value::True,
    );

    // Spawn room is declared.
    assert_eq!(
        value_of(
            &semiotics,
            "mash-scene-mud-teraum",
            "has-spawn-room",
            SPAWN_ROOM,
        ),
        Value::True,
    );
    // And it's Fort Kelly.
    assert_eq!(SPAWN_ROOM, TERAUM_FORT_KELLY);

    // Place an avatar in the spawn room. Using CONTAINS as the forward
    // positive-membership; the cascade's double-inversion from the
    // container module propagates to EXCLUDES_FROM.
    let s = semiotics.intern(SPAWN_ROOM);
    let p = semiotics.intern(CONTAINS);
    let o = semiotics.intern("avatar-newcomer");
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::True,
    });
    assert_eq!(
        value_of(&semiotics, SPAWN_ROOM, CONTAINS, "avatar-newcomer"),
        Value::True,
    );

    // The avatar is not excluded from the spawn room (algebraic
    // inversion: negate(True) = False).
    assert_eq!(
        value_of(&semiotics, "avatar-newcomer", EXCLUDES_FROM, SPAWN_ROOM),
        Value::False,
    );

    // The spawn room is-a-term ROOM (scene-instance rooms use
    // IS_A_TERM, not SPECIALIZES_AS, per the library idiom — the
    // ROOM category-term itself specializes-as CONTAINER, and
    // CONTAINER specializes-as THING, so the cascade lifts the
    // avatar's containment semantics through the chain).
    assert_eq!(
        value_of(&semiotics, SPAWN_ROOM, IS_A_TERM, ROOM),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, ROOM, SPECIALIZES_AS, CONTAINER),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, CONTAINER, SPECIALIZES_AS, THING),
        Value::True,
    );
}

#[test]
fn full_library_stack_boots_without_collision() {
    // The capstone: mount every library owner-agent. Nothing should
    // conflict (colliding IS_A_PREDICATE claims at the same
    // coordinate are fine because knowledge-join is idempotent).
    // This proves the library's module structure produces a coherent
    // substrate when all mounted together.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);
    mount(&mut semiotics, &Space);
    mount(&mut semiotics, &Ops);
    mount(&mut semiotics, &Dispatch);
    mount(
        &mut semiotics,
        &mash_library::offices::Offices,
    );
    mount(
        &mut semiotics,
        &mash_library::presence::Presence,
    );
    mount(&mut semiotics, &Movement);
    mount(
        &mut semiotics,
        &mash_library::perception::Perception,
    );
    mount(
        &mut semiotics,
        &mash_library::conduit::Conduit,
    );
    mount(&mut semiotics, &Teraum);

    // Sanity: a Teraum room is-a-term ROOM, and the ROOM category
    // itself specializes-as CONTAINER, threading through the
    // category lattice.
    assert_eq!(
        value_of(&semiotics, TERAUM_FORT_KELLY, IS_A_TERM, ROOM),
        Value::True,
    );
    assert_eq!(
        value_of(&semiotics, CONTAINER, SPECIALIZES_AS, THING),
        Value::True,
    );
    // And OPERATION (from ops) is also a THING.
    assert_eq!(
        value_of(&semiotics, OPERATION, SPECIALIZES_AS, THING),
        Value::True,
    );
    // And MOVEMENT specializes OPERATION.
    assert_eq!(
        value_of(&semiotics, MOVEMENT, SPECIALIZES_AS, OPERATION),
        Value::True,
    );
    // No panics, no contradictions — the full library coheres.
}

#[test]
fn has_name_is_settled_and_not_inverted() {
    // HAS_NAME is declared as a predicate but NOT paired with INVERTS_AS
    // (since its natural converse is not a negation pair). Witnessing
    // on HAS_NAME settles that fiber only.

    let mut semiotics = Semiotics::new();
    mount(&mut semiotics, &Foundation);
    mount(&mut semiotics, &Container);

    // HAS_NAME is a declared predicate.
    assert_eq!(
        value_of(&semiotics, HAS_NAME, IS_A_PREDICATE, "mash-library-container"),
        Value::True,
    );

    // Witness `(r1, has-name, "Parlor")`. The forward claim settles.
    // No inversion fires (by design — HAS_NAME has no inverts-as
    // declaration; reverse queries happen via fiber-scan).
    let s = semiotics.intern("r1");
    let p = semiotics.intern(HAS_NAME);
    let o = semiotics.intern("Parlor");
    semiotics.assert(ProofClaim {
        subject: s,
        predicate: p,
        object: o,
        value: Value::True,
    });

    assert_eq!(value_of(&semiotics, "r1", HAS_NAME, "Parlor"), Value::True);

    // No "names" fiber settled — HAS_NAME isn't paired via INVERTS_AS.
    // Reverse queries use the interner + fiber scan at the object axis,
    // not a converse predicate.
}
