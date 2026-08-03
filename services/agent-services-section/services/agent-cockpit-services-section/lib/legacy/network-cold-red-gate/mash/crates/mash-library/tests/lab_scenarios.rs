//! Lab scenarios — end-to-end substrate-level validation tests.
//!
//! These tests exercise multi-port compositions that individual unit
//! tests can't cover: scenes, handler fan-out, parser → resolver →
//! handler chains, cardinality → learning promotion, accounting +
//! movement round-trips, dispatch 8-stage admission with fine-grained
//! premises.
//!
//! # Convention
//!
//! Each test names the scenario in its fn name. A short doc comment
//! states the hypothesis. Where a scenario interacts with multiple
//! subsystems, the test asserts on the visible end-state cells, not
//! the internal state of any one port.

use mash_engine::algebra::Value;

use mash_library::approval::{
    AggregatorPort, HAS_ALL_APPROVALS_SATISFIED, HAS_APPROVAL, REQUIRES_APPROVAL,
};
use mash_library::capability::{
    CapabilityResolverPort, EXTENDS_ROLE, GRANTS_CAPABILITY, HAS_ROLE, IS_CAPABILITY_FIT, ROLE,
};
use mash_library::conduit::IS_SURFACE_READY;
use mash_library::container::{CONTAINS, EXCLUDES_FROM};
use mash_library::dispatch::{CONSIDERS_OP, CONSIDERS_PERFORMER, IS_ADMISSIBLE, IS_UNDERCUT};
use mash_library::learning::{IS_INSTINCT, IS_SKILL, LearningPort, OBSERVED};
use mash_library::lifecycle::IS_CLOSED;
use mash_library::mud::verbs::{ROLE_ANONYMOUSE, ROLE_REGISTERED};
use mash_library::perception::{LOOKS_AT, PERCEIVER_IS, REPORTS_TO};
use mash_library::presence::IS_NEWLY_CONNECTED;
use mash_library::resolver::ResolverPort;
use mash_library::testkit::TestHub;
use mash_library::testkit_mud::{with_core_stack, with_teraum_scene};

// ─────────────────────────────────────────────────────────────────────
// Boot scenarios
// ─────────────────────────────────────────────────────────────────────

/// The core vocabulary stack composes without predicate collision
/// and the foundation terms settle at True under owner-agent mount.
#[test]
fn core_stack_boots_and_foundation_settled() {
    let hub = with_core_stack(TestHub::builder()).build();
    hub.expect_true(
        "is-a-predicate",
        "is-a-predicate",
        mash_library::foundation::IDENTITY,
    );
    hub.expect_true(
        mash_library::container::CONTAINER,
        mash_library::foundation::SPECIALIZES_AS,
        mash_library::foundation::THING,
    );
}

/// Teraum scene + MUD stack boot; welcome flow fires and the avatar
/// lands in the spawn room with full identity state set up.
#[test]
fn teraum_welcome_flow_places_avatar_and_sets_identity() {
    let mut hub = with_teraum_scene(TestHub::builder()).build_with_replay();
    hub.witness_true("session:1", IS_NEWLY_CONNECTED, "session:1");

    // Core welcome placed the avatar.
    let avatar = hub.expect_any_object_for("session:1", mash_library::presence::INHABITS);
    hub.expect_true(mash_library::teraum::SPAWN_ROOM, CONTAINS, &avatar);

    // MUD welcome set role + state.
    hub.expect_true("session:1", HAS_ROLE, ROLE_ANONYMOUSE);
    hub.expect_true(
        "session:1",
        mash_library::mud::session::HAS_SESSION_STATE,
        mash_library::mud::verbs::STATE_ANONYMOUSE,
    );
}

// ─────────────────────────────────────────────────────────────────────
// Parser → handler chain
// ─────────────────────────────────────────────────────────────────────

/// An input line parsed into a look request surfaces a perception
/// with the intent pair wired up correctly.
#[test]
fn look_input_produces_perception_via_parser_and_handler() {
    let mut hub = with_teraum_scene(TestHub::builder()).build_with_replay();
    hub.witness_true("session:1", IS_NEWLY_CONNECTED, "session:1");

    // Stand-in for conduit-level input: body cache + surface-ready
    // on the session channel. Parser observes and mints a request.
    hub.witness_true("msg:1", mash_library::conduit::HAS_BODY, "look rock");
    hub.witness_true("msg:1", IS_SURFACE_READY, "session:1");

    // LookHandler received the invokes-command claim and minted a
    // perception. The perception's intent pair: perceiver-is +
    // reports-to == session:1, looks-at == "rock".
    let perception = {
        let i = hub.semiotics().interner();
        let perceiver_is = i.get(PERCEIVER_IS).expect("perceiver-is interned");
        let session = i.get("session:1").expect("session:1 interned");
        let mut found = None;
        for id in 0..i.len() {
            let s = id as mash_engine::proof::TermId;
            if hub.semiotics().value(s, perceiver_is, session) == Value::True {
                found = Some(i.name(s).unwrap().to_owned());
                break;
            }
        }
        found.expect("perception subject should exist")
    };
    hub.expect_true(&perception, REPORTS_TO, "session:1");
    // `LOOKS_AT` is only witnessed when the look-target resolver
    // binding settles. The resolver isn't mounted in the default MUD
    // stack, so this test only asserts the intent pair; bindings
    // arrive only when a ResolverPort is mounted alongside.
    assert!(
        perception.starts_with("perception:"),
        "perception subject should follow perception:<session>:<id> convention"
    );
}

/// With a ResolverPort mounted for the string-rest kind, a look
/// request with a target binding settles on the perception's
/// looks-at cell.
#[test]
fn look_with_resolver_fills_looks_at() {
    let mut hub = with_teraum_scene(TestHub::builder())
        .with_projection(ResolverPort::string_rest(
            "test-resolver",
            "mash-library-mud-verbs:resolver:string-rest",
        ))
        .build_with_replay();
    hub.witness_true("session:1", IS_NEWLY_CONNECTED, "session:1");

    hub.witness_true("msg:1", mash_library::conduit::HAS_BODY, "look rock");
    hub.witness_true("msg:1", IS_SURFACE_READY, "session:1");

    // A resolve-request was minted with resolver-kind:string-rest +
    // post-verb body "rock" + binds-to "target". The resolver port
    // matches on kind and emits has-binding-target="rock" on the
    // parent request. The look handler reads that and witnesses
    // LOOKS_AT on the perception.
    //
    // Scan for any perception whose looks-at settled.
    let i = hub.semiotics().interner();
    let (Some(pred), Some(obj)) = (i.get(LOOKS_AT), i.get("rock")) else {
        panic!("looks-at or 'rock' not interned — resolver didn't fire");
    };
    let mut found = false;
    for id in 0..i.len() {
        let s = id as mash_engine::proof::TermId;
        if hub.semiotics().value(s, pred, obj) == Value::True {
            found = true;
            break;
        }
    }
    assert!(found, "no perception has looks-at=rock — resolver/handler chain broke");
}

/// Bare-direction input is rewritten to `go <direction>` by the
/// parser; the go-agent resolves the avatar's room + exit and emits
/// a movement op + balanced txn + containment swap.
#[test]
fn bare_direction_routes_through_go_agent_to_containment_swap() {
    let mut hub = with_teraum_scene(TestHub::builder())
        .with_projection(ResolverPort::literal_string(
            "test-resolver-literal",
            "mash-library-mud-verbs:resolver:literal-string",
        ))
        .build_with_replay();
    hub.witness_true("session:1", IS_NEWLY_CONNECTED, "session:1");

    // Type `east` — Fort Kelly (the spawn room) has an east exit to
    // the Kingsroad segment east of Fort Kelly.
    hub.witness_true("msg:1", mash_library::conduit::HAS_BODY, "east");
    hub.witness_true("msg:1", IS_SURFACE_READY, "session:1");

    // The avatar should now be in the east-kingsroad room.
    let avatar = hub.expect_any_object_for("session:1", mash_library::presence::INHABITS);
    const DESTINATION: &str = "area:central-plains-east-kingsroad";
    // After move: destination contains avatar (new True witness).
    hub.expect_true(DESTINATION, CONTAINS, &avatar);
    // Source now excludes avatar.
    hub.expect_true(mash_library::teraum::SPAWN_ROOM, EXCLUDES_FROM, &avatar);
    // Source's CONTAINS cell is monotone — the original True stays,
    // but the inverse (avatar, CONTAINS, source) is now False via
    // the EXCLUDES_FROM inversion cascade.
    hub.expect_false(&avatar, CONTAINS, mash_library::teraum::SPAWN_ROOM);
}

// ─────────────────────────────────────────────────────────────────────
// Capability resolver integration
// ─────────────────────────────────────────────────────────────────────

/// A capability-resolver receives a candidate + op-requirement +
/// performer-role-grants chain and settles IS_CAPABILITY_FIT only
/// when the role actually grants the required cap.
#[test]
fn capability_resolver_settles_fit_when_role_grants_required_cap() {
    let mut hub = with_core_stack(TestHub::builder())
        .with_projection(CapabilityResolverPort::new())
        .build_with_replay();

    // Scene declares an op requiring cap:perceive and a performer
    // holding role:anonymouse (which grants perceive via mud-verbs).
    hub.witness_true(
        "op:look-1",
        mash_library::capability::REQUIRES_CAPABILITY,
        mash_library::mud::verbs::CAP_PERCEIVE,
    );
    hub.witness_true(
        "role:anonymouse",
        mash_library::foundation::IS_A_TERM,
        ROLE,
    );
    hub.witness_true(
        "role:anonymouse",
        GRANTS_CAPABILITY,
        mash_library::mud::verbs::CAP_PERCEIVE,
    );
    hub.witness_true("performer:alice", HAS_ROLE, "role:anonymouse");
    // Candidate pairing.
    hub.witness_true("cand-1", CONSIDERS_OP, "op:look-1");
    hub.witness_true("cand-1", CONSIDERS_PERFORMER, "performer:alice");

    // Resolver emits IS_CAPABILITY_FIT at the candidate.
    hub.expect_true(
        "cand-1",
        IS_CAPABILITY_FIT,
        mash_library::dispatch::IDENTITY,
    );
}

/// A performer lacking the required cap gets IS_CAPABILITY_MISMATCHED
/// instead. The undercut-implication `IS_ADMISSIBLE ∧
/// IS_CAPABILITY_MISMATCHED → IS_UNDERCUT` then fires if admissibility
/// was independently derived.
#[test]
fn capability_mismatch_undercuts_an_otherwise_admissible_candidate() {
    let mut hub = with_core_stack(TestHub::builder())
        .with_projection(CapabilityResolverPort::new())
        .build_with_replay();

    // Op requires a capability the performer doesn't hold.
    hub.witness_true(
        "op:voice-1",
        mash_library::capability::REQUIRES_CAPABILITY,
        mash_library::mud::verbs::CAP_VOICE,
    );
    // role:anonymouse does NOT grant voice.
    hub.witness_true("performer:alice", HAS_ROLE, "role:anonymouse");
    hub.witness_true(
        "role:anonymouse",
        GRANTS_CAPABILITY,
        mash_library::mud::verbs::CAP_PERCEIVE,
    );
    hub.witness_true(
        "role:anonymouse",
        mash_library::foundation::IS_A_TERM,
        ROLE,
    );
    hub.witness_true("cand-1", CONSIDERS_OP, "op:voice-1");
    hub.witness_true("cand-1", CONSIDERS_PERFORMER, "performer:alice");

    // Independently derive admissibility via simple path.
    hub.witness_true(
        "cand-1",
        mash_library::dispatch::IS_OP_READY,
        mash_library::dispatch::IDENTITY,
    );
    hub.witness_true(
        "cand-1",
        mash_library::dispatch::IS_PERFORMER_AVAILABLE,
        mash_library::dispatch::IDENTITY,
    );

    // Admissibility settled from simple path.
    hub.expect_true("cand-1", IS_ADMISSIBLE, mash_library::dispatch::IDENTITY);
    // Capability mismatch settled from resolver.
    hub.expect_true(
        "cand-1",
        mash_library::dispatch::IS_CAPABILITY_MISMATCHED,
        mash_library::dispatch::IDENTITY,
    );
    // Undercut fired via implication.
    hub.expect_true("cand-1", IS_UNDERCUT, mash_library::dispatch::IDENTITY);
}

// ─────────────────────────────────────────────────────────────────────
// Role inheritance
// ─────────────────────────────────────────────────────────────────────

/// A performer with role:registered (extends role:anonymouse) holds
/// the union of both roles' granted capabilities via the resolver's
/// inheritance walk.
#[test]
fn role_inheritance_unions_granted_capabilities() {
    let mut hub = with_core_stack(TestHub::builder())
        .with_projection(CapabilityResolverPort::new())
        .build_with_replay();

    // Op requires voice (granted by role:registered only).
    hub.witness_true(
        "op:say-1",
        mash_library::capability::REQUIRES_CAPABILITY,
        mash_library::mud::verbs::CAP_VOICE,
    );
    hub.witness_true("performer:bob", HAS_ROLE, ROLE_REGISTERED);
    hub.witness_true(
        ROLE_REGISTERED,
        mash_library::foundation::IS_A_TERM,
        ROLE,
    );
    hub.witness_true(ROLE_REGISTERED, EXTENDS_ROLE, ROLE_ANONYMOUSE);
    hub.witness_true(
        ROLE_ANONYMOUSE,
        mash_library::foundation::IS_A_TERM,
        ROLE,
    );
    hub.witness_true(
        ROLE_REGISTERED,
        GRANTS_CAPABILITY,
        mash_library::mud::verbs::CAP_VOICE,
    );

    hub.witness_true("cand-1", CONSIDERS_OP, "op:say-1");
    hub.witness_true("cand-1", CONSIDERS_PERFORMER, "performer:bob");

    // Fit — role:registered grants voice.
    hub.expect_true(
        "cand-1",
        IS_CAPABILITY_FIT,
        mash_library::dispatch::IDENTITY,
    );
}

// ─────────────────────────────────────────────────────────────────────
// Approval aggregator + learning feedback loop
// ─────────────────────────────────────────────────────────────────────

/// Approval aggregator settles HAS_ALL_APPROVALS_SATISFIED only
/// when all declared approvals are granted AND the subject is closed.
/// Verifies the closure gating.
#[test]
fn approval_aggregator_gates_rollup_on_closure() {
    let mut hub = with_core_stack(TestHub::builder())
        .with_projection(AggregatorPort::for_approval())
        .build_with_replay();

    hub.witness_true("task-1", REQUIRES_APPROVAL, "approval-a");
    hub.witness_true("task-1", REQUIRES_APPROVAL, "approval-b");
    hub.witness_true("task-1", HAS_APPROVAL, "approval-a");
    hub.witness_true("task-1", HAS_APPROVAL, "approval-b");

    // Before closure: rollup not emitted.
    hub.expect_none("task-1", HAS_ALL_APPROVALS_SATISFIED, "task-1");

    hub.witness_true("task-1", IS_CLOSED, "task-1");
    // After closure: rollup emitted.
    hub.expect_true("task-1", HAS_ALL_APPROVALS_SATISFIED, "task-1");
}

/// Accumulating three OBSERVED witnesses at a pattern subject fires
/// learning-port promotion to IS_INSTINCT for every accumulated
/// witness.
#[test]
fn learning_promotes_pattern_to_instinct_at_threshold() {
    let mut hub = with_core_stack(TestHub::builder())
        .with_projection(LearningPort::new())
        .build_with_replay();

    let pat = "pattern:exit-7";
    hub.witness_true(pat, OBSERVED, "failure-1");
    hub.witness_true(pat, OBSERVED, "failure-2");
    // Below threshold.
    hub.expect_none(pat, IS_INSTINCT, "failure-1");

    hub.witness_true(pat, OBSERVED, "failure-3");
    // At threshold — all three witnesses lifted to IS_INSTINCT.
    hub.expect_true(pat, IS_INSTINCT, "failure-1");
    hub.expect_true(pat, IS_INSTINCT, "failure-2");
    hub.expect_true(pat, IS_INSTINCT, "failure-3");
    // Still below skill threshold.
    hub.expect_none(pat, IS_SKILL, "failure-1");
}

// ─────────────────────────────────────────────────────────────────────
// Containment + cardinality
// ─────────────────────────────────────────────────────────────────────

/// Double-declared CONTAINS/EXCLUDES_FROM algebraic-negation pair
/// propagates: witnessing one side yields the negated value on the
/// converse triple (subject and object swapped) via pointwise
/// inversion.
#[test]
fn contains_excludes_inversion_propagates() {
    let mut hub = with_core_stack(TestHub::builder()).build();
    hub.witness_true("room-a", CONTAINS, "rock-1");
    hub.expect_true("room-a", CONTAINS, "rock-1");
    // Inversion: `(room-a, contains, rock-1) True` propagates to
    // `(rock-1, excludes-from, room-a) False`. Reads as "rock-1 is
    // not excluded from room-a" — positive membership.
    hub.expect_false("rock-1", EXCLUDES_FROM, "room-a");
}
