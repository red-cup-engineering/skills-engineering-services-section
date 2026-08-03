//! MUD/Teraum testkit fixtures — presets that mount the common
//! vocabulary + handler stacks for end-to-end scenario tests.
//!
//! # What these are for
//!
//! Substrate tests that exercise the full MUD pipeline (welcome →
//! parse → authorize → handle → render) need a consistent set of
//! owner-agents and projections mounted. The presets here avoid
//! boilerplate and keep scenario tests focused on the behavior
//! under test.
//!
//! # Convention: "stack" = owner agents + handler projections
//!
//! - [`with_core_stack`] — foundation + container + space + presence
//!   + ops + dispatch + movement + perception + conduit + command +
//!   capability + grammar + lifecycle + workers + approval +
//!   correlation + accounting. The substrate vocabulary lattice.
//! - [`with_mud_stack`] — core + mud::session + mud::verbs +
//!   mud::parser + mud::welcome + mud::handlers (all five). The
//!   shipping MUD-roster runtime.
//! - [`with_teraum_scene`] — MUD stack + teraum scene. A full boot
//!   with three rooms and the spawn declaration.

use crate::testkit::TestHubBuilder;

/// Mount the core library vocabulary stack.
#[must_use]
pub fn with_core_stack(builder: TestHubBuilder) -> TestHubBuilder {
    builder
        .with_owner_agent(crate::foundation::Foundation)
        .with_owner_agent(crate::container::Container)
        .with_owner_agent(crate::space::Space)
        .with_owner_agent(crate::presence::Presence)
        .with_owner_agent(crate::ops::Ops)
        .with_owner_agent(crate::dispatch::Dispatch)
        .with_owner_agent(crate::movement::Movement)
        .with_owner_agent(crate::perception::Perception)
        .with_owner_agent(crate::conduit::Conduit)
        .with_owner_agent(crate::command::Command)
        .with_owner_agent(crate::capability::Capability)
        .with_owner_agent(crate::grammar::Grammar)
        .with_owner_agent(crate::lifecycle::Lifecycle)
        .with_owner_agent(crate::workers::Workers)
        .with_owner_agent(crate::approval::Approval)
        .with_owner_agent(crate::correlation::Correlation)
        .with_owner_agent(crate::accounting::Accounting)
}

/// Mount MUD-specific vocabulary + handler projections on top of the
/// core stack.
#[must_use]
pub fn with_mud_stack(builder: TestHubBuilder) -> TestHubBuilder {
    with_core_stack(builder)
        .with_owner_agent(crate::mud::session::MudSession)
        .with_owner_agent(crate::mud::verbs::MudVerbs)
        .with_projection(crate::mud::parser::MudParserPort::new())
        .with_projection(crate::mud::welcome::MudWelcomePort::new())
        .with_projection(crate::mud::handlers::QuitPort::new())
        .with_projection(crate::mud::handlers::LookPort::new())
        .with_projection(crate::mud::handlers::SayPort::new())
        .with_projection(crate::mud::handlers::HelpPort::new())
        .with_projection(crate::mud::handlers::WhoPort::new())
        .with_projection(crate::mud::go_agent::GoAgentPort::new())
}

/// Mount the Teraum scene + MUD stack. The [`crate::welcome::WelcomePort`]
/// runs alongside [`crate::mud::welcome::MudWelcomePort`] to place
/// the avatar in the spawn room as well as do MUD-specific init.
#[must_use]
pub fn with_teraum_scene(builder: TestHubBuilder) -> TestHubBuilder {
    with_mud_stack(builder)
        .with_owner_agent(crate::teraum::Teraum)
        .with_projection(crate::welcome::WelcomePort::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conduit::IS_SURFACE_READY;
    use crate::mud::verbs::{COMMAND_LOOK, COMMAND_QUIT};
    use crate::presence::{ENDED_AT, IS_NEWLY_CONNECTED};
    use crate::testkit::TestHub;
    use mash_engine::algebra::Value;

    #[test]
    fn core_stack_boots_without_collision() {
        // If any owner-agent collides on terms/predicates in a way
        // that breaks the knowledge-join, the build will show up as
        // unexpected value states. This smoke test just verifies the
        // build succeeds and foundation is in place.
        let hub = with_core_stack(TestHub::builder()).build();
        hub.expect_true(
            "is-a-predicate",
            "is-a-predicate",
            crate::foundation::IDENTITY,
        );
    }

    #[test]
    fn mud_stack_boots_with_verb_roster_available() {
        let hub = with_mud_stack(TestHub::builder()).build();
        // COMMAND_LOOK is-a command
        hub.expect_true(
            COMMAND_LOOK,
            crate::foundation::IS_A_TERM,
            crate::command::COMMAND,
        );
        // COMMAND_QUIT is-a command
        hub.expect_true(
            COMMAND_QUIT,
            crate::foundation::IS_A_TERM,
            crate::command::COMMAND,
        );
    }

    #[test]
    fn teraum_scene_declares_spawn_room() {
        let hub = with_teraum_scene(TestHub::builder()).build();
        // Scene declares has-spawn-room.
        hub.expect_true(
            crate::teraum::IDENTITY,
            crate::welcome::HAS_SPAWN_ROOM,
            crate::teraum::SPAWN_ROOM,
        );
    }

    #[test]
    fn newly_connected_session_triggers_welcome_flow() {
        // Build with replay so WelcomePort observes Teraum's
        // HAS_SPAWN_ROOM declaration.
        let mut hub = with_teraum_scene(TestHub::builder()).build_with_replay();
        hub.witness_true("session:1", IS_NEWLY_CONNECTED, "session:1");

        // Core welcome: session inhabits an avatar.
        let avatar = hub.expect_any_object_for("session:1", crate::presence::INHABITS);
        assert_eq!(avatar, "avatar:for-session:1");

        // MUD welcome: session has-role anonymouse, state anonymouse,
        // was-welcomed-at event.
        hub.expect_true(
            "session:1",
            crate::capability::HAS_ROLE,
            crate::mud::verbs::ROLE_ANONYMOUSE,
        );
        hub.expect_true(
            "session:1",
            crate::mud::session::HAS_SESSION_STATE,
            crate::mud::verbs::STATE_ANONYMOUSE,
        );
        let _event = hub.expect_any_object_for("session:1", crate::mud::session::WAS_WELCOMED_AT);
        // Avatar placed in spawn room by the core WelcomePort.
        assert_eq!(
            hub.value(
                crate::teraum::SPAWN_ROOM,
                crate::container::CONTAINS,
                &avatar
            ),
            Value::True
        );
        // A banner message was surface-ready at the session. Scan
        // the IS_SURFACE_READY fiber for any subject whose object is
        // this session.
        assert!(
            surface_ready_message_exists(&hub, "session:1"),
            "welcome banner should be surface-ready at session:1"
        );
    }

    #[test]
    fn quit_after_welcome_transitions_session_to_ended() {
        let mut hub = with_teraum_scene(TestHub::builder()).build_with_replay();
        hub.witness_true("session:1", IS_NEWLY_CONNECTED, "session:1");
        // Short-circuit the parser by witnessing a quit request
        // directly. QuitPort subscribes to ISSUED_BY_SESSION +
        // INVOKES_COMMAND and fires when both are present.
        hub.witness_true("req-1", crate::conduit::ISSUED_BY_SESSION, "session:1");
        hub.witness_true("req-1", crate::command::INVOKES_COMMAND, COMMAND_QUIT);
        // ended-at settled (object is a timestamp string).
        let _ts = hub.expect_any_object_for("session:1", ENDED_AT);
        // Goodbye message was surface-ready at the session.
        assert!(
            surface_ready_message_exists(&hub, "session:1"),
            "quit handler should have surface-readied a message"
        );
    }

    /// Scan the IS_SURFACE_READY fiber for any subject settling True
    /// with the given object.
    fn surface_ready_message_exists(hub: &TestHub, session: &str) -> bool {
        let i = hub.semiotics().interner();
        let (Some(pred), Some(obj)) = (i.get(IS_SURFACE_READY), i.get(session)) else {
            return false;
        };
        for id in 0..i.len() {
            let subject_id = id as mash_engine::proof::TermId;
            if hub.semiotics().value(subject_id, pred, obj) == Value::True {
                return true;
            }
        }
        false
    }
}
