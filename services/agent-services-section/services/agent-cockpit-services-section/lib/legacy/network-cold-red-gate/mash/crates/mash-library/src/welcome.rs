//! Welcome projection — mints an avatar and places a newly-connected
//! session in the scene's spawn room.
//!
//! # Pattern
//!
//! Subscribes to [`IS_NEWLY_CONNECTED`] and scene-level spawn
//! declarations. When a session's `is-newly-connected` cell settles
//! True, and the scene's spawn-room is known, the projection emits:
//!
//! - a fresh avatar subject (terms like `avatar:session-<id>`)
//! - `(session, inhabits, avatar)` — binding the session to its body
//! - `(spawn-room, contains, avatar)` — placing the avatar in-world
//! - `(avatar, is-mobile, <marker>)` — default quality so avatars
//!   can move
//!
//! # Wiener/Barad framing
//!
//! An avatar is not constructed by `new()`. It emerges from claims
//! witnessed by this projection. The session's inhabitation is a
//! settled claim; the avatar's location is a settled claim; its
//! mobility is a settled claim. Revoking any of those claims (or
//! witnessing their negation) is how the avatar's presence changes
//! or withdraws.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-port-projection-mud-welcome/`.

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;
use std::collections::{HashMap, HashSet};

use crate::container::CONTAINS;
use crate::movement::IS_MOBILE;
use crate::presence::{INHABITS, IS_NEWLY_CONNECTED};

/// Owner identity for the welcome projection.
pub const IDENTITY: &str = "mash-library-welcome";

/// Scene-level predicate: `(scene-identity, has-spawn-room, room)`.
/// Declared by the [`crate::teraum`] scene and by any future scene
/// that hosts sessions.
pub const HAS_SPAWN_ROOM: &str = "has-spawn-room";

/// Welcome projection state.
#[derive(Debug, Default)]
pub struct WelcomePort {
    /// Known spawn rooms, indexed by scene subject. Populated from
    /// `HAS_SPAWN_ROOM` settlements.
    scene_spawn_rooms: HashMap<String, String>,

    /// Sessions already welcomed. Prevents re-welcoming on duplicate
    /// `IS_NEWLY_CONNECTED` settlements (which can happen under
    /// CRDT non-monotone scenarios or replay).
    welcomed: HashSet<String>,
}

impl WelcomePort {
    /// Fresh welcome projection with no state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a session has been welcomed. Public for testing.
    #[must_use]
    pub fn has_welcomed(&self, session: &str) -> bool {
        self.welcomed.contains(session)
    }
}

impl Projection for WelcomePort {
    fn identity(&self) -> &str {
        IDENTITY
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![HAS_SPAWN_ROOM.to_owned(), IS_NEWLY_CONNECTED.to_owned()]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        // Only act on True settlements.
        if value != Value::True {
            return Vec::new();
        }

        match predicate {
            HAS_SPAWN_ROOM => {
                // Remember this scene's spawn room for future
                // welcomes. `subject` is the scene identity; `object`
                // is the spawn room.
                self.scene_spawn_rooms
                    .insert(subject.to_owned(), object.to_owned());
                Vec::new()
            }
            IS_NEWLY_CONNECTED => {
                // `subject` is the session. Only the diagonal form
                // `(session, is-newly-connected, session)` is used
                // for phase markers per the ops-module convention;
                // accept other objects permissively.
                let session = subject;

                if self.welcomed.contains(session) {
                    return Vec::new();
                }

                // Pick any known spawn room. If the scene hasn't
                // declared one yet, defer — re-try will happen when
                // the next session connects (or when spawn room
                // finally settles, there's no re-try from that side;
                // future work could retain pending sessions).
                let Some(spawn_room) = self.scene_spawn_rooms.values().next() else {
                    return Vec::new();
                };

                self.welcomed.insert(session.to_owned());

                // Mint an avatar subject from the session id.
                let avatar = format!("avatar:for-{session}");

                vec![
                    Claim::new(session, INHABITS, &avatar),
                    Claim::new(spawn_room.as_str(), CONTAINS, &avatar),
                    Claim::new(&avatar, IS_MOBILE, &avatar),
                ]
            }
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn welcome_requires_known_spawn_room() {
        let mut port = WelcomePort::new();
        // Session connects before spawn room is known — no emissions
        // and no welcome-mark.
        let claims = port.ingest("session-1", IS_NEWLY_CONNECTED, "session-1", Value::True);
        assert!(claims.is_empty());
        assert!(!port.has_welcomed("session-1"));
    }

    #[test]
    fn session_connect_after_spawn_declaration_places_avatar() {
        let mut port = WelcomePort::new();

        // Scene declares its spawn room.
        let claims = port.ingest(
            "mash-scene-teraum",
            HAS_SPAWN_ROOM,
            "room:okaga-plaza",
            Value::True,
        );
        assert!(claims.is_empty(), "spawn declaration itself emits nothing");

        // Session connects.
        let claims = port.ingest("session-1", IS_NEWLY_CONNECTED, "session-1", Value::True);

        // Should produce three claims: inhabits + contains + is-mobile.
        assert_eq!(claims.len(), 3);
        assert!(claims.iter().any(|c| c.subject == "session-1"
            && c.predicate == INHABITS
            && c.object == "avatar:for-session-1"));
        assert!(claims.iter().any(|c| c.subject == "room:okaga-plaza"
            && c.predicate == CONTAINS
            && c.object == "avatar:for-session-1"));
        assert!(claims.iter().any(|c| c.subject == "avatar:for-session-1"
            && c.predicate == IS_MOBILE));
        assert!(port.has_welcomed("session-1"));
    }

    #[test]
    fn repeated_connect_does_not_re_welcome() {
        let mut port = WelcomePort::new();
        port.ingest(
            "mash-scene-teraum",
            HAS_SPAWN_ROOM,
            "room:okaga-plaza",
            Value::True,
        );
        let first = port.ingest("session-1", IS_NEWLY_CONNECTED, "session-1", Value::True);
        assert!(!first.is_empty());

        let second = port.ingest("session-1", IS_NEWLY_CONNECTED, "session-1", Value::True);
        assert!(second.is_empty(), "second connect should not re-welcome");
    }

    #[test]
    fn multiple_sessions_get_distinct_avatars() {
        let mut port = WelcomePort::new();
        port.ingest(
            "mash-scene-teraum",
            HAS_SPAWN_ROOM,
            "room:okaga-plaza",
            Value::True,
        );
        let s1 = port.ingest("session-1", IS_NEWLY_CONNECTED, "session-1", Value::True);
        let s2 = port.ingest("session-2", IS_NEWLY_CONNECTED, "session-2", Value::True);

        let avatar_1 = s1
            .iter()
            .find(|c| c.predicate == INHABITS)
            .map(|c| c.object.clone())
            .unwrap();
        let avatar_2 = s2
            .iter()
            .find(|c| c.predicate == INHABITS)
            .map(|c| c.object.clone())
            .unwrap();
        assert_ne!(avatar_1, avatar_2);
    }

    #[test]
    fn integration_with_testkit_routes_projection_emissions() {
        use crate::container::Container;
        use crate::foundation::Foundation;
        use crate::presence::Presence;
        use crate::space::Space;
        use crate::testkit::TestHub;

        // Note: we don't mount Teraum here. Owner-agent mount
        // settlements bypass projection observation (by testkit
        // design). If we want the welcome projection to know the
        // spawn room via Teraum's declaration, we'd need to re-witness
        // that claim — which is a no-op if already True via mount.
        //
        // Instead, mount the minimal stack and witness a fresh
        // spawn-declaration directly. This is what a real hub would
        // do too: scenes declare at mount, but a post-mount projection
        // would use fiber-scan priming (future testkit feature) or
        // be declared as an owner-agent that the hub loads after.
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .with_owner_agent(Space)
            .with_owner_agent(Presence)
            .with_projection(WelcomePort::new())
            .build();

        // Fresh scene declaration — projection observes it.
        hub.witness_true("test-scene", HAS_SPAWN_ROOM, "room:test-spawn");

        // Session connects.
        hub.witness_true("session-newcomer", IS_NEWLY_CONNECTED, "session-newcomer");

        // Welcome fired. Avatar is inhabiting the session and
        // placed in the spawn room.
        assert_eq!(
            hub.value("session-newcomer", INHABITS, "avatar:for-session-newcomer"),
            Value::True,
        );
        assert_eq!(
            hub.value("room:test-spawn", CONTAINS, "avatar:for-session-newcomer"),
            Value::True,
        );
        assert_eq!(
            hub.value(
                "avatar:for-session-newcomer",
                IS_MOBILE,
                "avatar:for-session-newcomer"
            ),
            Value::True,
        );
    }
}
