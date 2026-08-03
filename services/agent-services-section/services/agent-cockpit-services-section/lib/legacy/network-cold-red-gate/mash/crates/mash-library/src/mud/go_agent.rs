//! Go-agent — handles `go <direction>` commands, minting movement
//! ops + balanced accounting transactions + containment swaps.
//!
//! # Flow
//!
//! On [`crate::mud::verbs::COMMAND_GO`] invocation with a direction
//! binding:
//!
//! 1. Resolve the session's avatar (via [`crate::presence::INHABITS`]).
//! 2. Resolve the avatar's current room (via
//!    [`crate::container::CONTAINS`] reverse scan — the room whose
//!    CONTAINS fiber includes this avatar).
//! 3. Find the room's exit in the requested direction
//!    ([`crate::space::HAS_EXIT`] + [`crate::space::GOES_DIRECTION`]).
//! 4. Resolve the exit's destination ([`crate::space::LEADS_TO`]).
//! 5. Emit:
//!    - A [`crate::movement::MOVEMENT`] op subject with
//!      [`crate::movement::MOVER_IS`] / MOVES_FROM / MOVES_TO /
//!      MOVES_IN_DIRECTION / MOVES_VIA_EXIT intent cells.
//!    - A balanced ledger transaction:
//!      `(txn, debits, source-room)`,
//!      `(txn, credits, destination-room)`,
//!      `(txn, balances, avatar)`,
//!      `(txn, measured-in, commodity:person)`.
//!    - Containment swap: `(source, excludes-from, avatar)` and
//!      `(destination, contains, avatar)`. The cascade's double-
//!      declared CONTAINS/EXCLUDES_FROM inversion propagates either
//!      cell to its negation pair.
//!    - `"You go <dir>."` message.
//!
//! # Wiener/Barad framing
//!
//! No `Avatar::move()`. The move IS the set of settled claims:
//! intent + balanced-ledger + containment. Observers subscribing to
//! the relevant fibers see the departure, arrival, and ledger
//! posting as independent settlements at different subjects.
//!
//! # Scope of this port vs [`crate::movement_effector`]
//!
//! `movement_effector` is a lower-level port that translates a
//! pre-minted movement op's intent into the containment swap. The
//! go-agent is higher-level: it mints the movement op itself from
//! a parsed `go` request. Both can run; the go-agent's emissions
//! feed into what the movement_effector already observes.

use std::collections::{HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::accounting::{BALANCES, COMMODITY_PERSON, CREDITS, DEBITS, MEASURED_IN, TRANSACTION};
use crate::command::INVOKES_COMMAND;
use crate::conduit::{HAS_BODY, ISSUED_BY_SESSION, IS_SURFACE_READY, WAS_SAID_IN};
use crate::container::{CONTAINS, EXCLUDES_FROM};
use crate::foundation::IS_A_TERM;
use crate::movement::{MOVEMENT, MOVER_IS, MOVES_FROM, MOVES_IN_DIRECTION, MOVES_TO, MOVES_VIA_EXIT};
use crate::mud::verbs::{COMMAND_GO, HAS_BINDING_DIRECTION};
use crate::presence::INHABITS;
use crate::space::{GOES_DIRECTION, HAS_EXIT, LEADS_TO};

/// Go-agent projection.
pub struct GoAgentPort {
    // Request-indexed accumulations.
    request_session: HashMap<String, String>,
    request_direction: HashMap<String, String>,
    invoked: HashSet<String>,
    fired: HashSet<String>,
    // World-state accumulations.
    session_avatar: HashMap<String, String>,
    avatar_location: HashMap<String, String>,
    /// `room → direction-term → exit`.
    room_exits_by_direction: HashMap<String, HashMap<String, String>>,
    /// `exit → direction-term` (filled from GOES_DIRECTION; resolves
    /// `HAS_EXIT` cells into per-direction lookup).
    exit_direction: HashMap<String, String>,
    /// `room → exit` (multi-valued in general, but we join against
    /// exit_direction). Intermediate.
    room_exits: HashMap<String, HashSet<String>>,
    exit_destination: HashMap<String, String>,
    next_id: u64,
    now_iso: fn() -> String,
}

impl Default for GoAgentPort {
    fn default() -> Self {
        Self::new()
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl GoAgentPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            request_session: HashMap::new(),
            request_direction: HashMap::new(),
            invoked: HashSet::new(),
            fired: HashSet::new(),
            session_avatar: HashMap::new(),
            avatar_location: HashMap::new(),
            room_exits_by_direction: HashMap::new(),
            exit_direction: HashMap::new(),
            room_exits: HashMap::new(),
            exit_destination: HashMap::new(),
            next_id: 1,
            now_iso: default_now_iso,
        }
    }

    /// Custom clock for deterministic tests.
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }

    /// Re-index a room's exits by direction when either HAS_EXIT or
    /// GOES_DIRECTION arrives.
    fn reindex_room(&mut self, room: &str) {
        let exits = self.room_exits.get(room).cloned().unwrap_or_default();
        let mut by_dir: HashMap<String, String> = HashMap::new();
        for exit in exits {
            if let Some(dir) = self.exit_direction.get(&exit).cloned() {
                by_dir.insert(dir, exit);
            }
        }
        self.room_exits_by_direction.insert(room.to_owned(), by_dir);
    }

    /// When GOES_DIRECTION arrives for an exit, refresh every room
    /// that claims this exit.
    fn reindex_exit(&mut self, exit: &str) {
        let rooms: Vec<String> = self
            .room_exits
            .iter()
            .filter(|(_, exits)| exits.contains(exit))
            .map(|(r, _)| r.clone())
            .collect();
        for r in rooms {
            self.reindex_room(&r);
        }
    }

    fn try_fire(&mut self, request: &str) -> Vec<Claim> {
        if self.fired.contains(request) {
            return Vec::new();
        }
        if !self.invoked.contains(request) {
            return Vec::new();
        }
        let Some(session) = self.request_session.get(request).cloned() else {
            return Vec::new();
        };
        let Some(direction) = self.request_direction.get(request).cloned() else {
            return Vec::new();
        };
        self.fired.insert(request.to_owned());
        let id = self.next_id;
        self.next_id += 1;

        let Some(avatar) = self.session_avatar.get(&session).cloned() else {
            return self.say(&session, "You have no body to move.", id);
        };
        let Some(room) = self.avatar_location.get(&avatar).cloned() else {
            return self.say(&session, "You are nowhere to move from.", id);
        };
        let Some(exit) = self
            .room_exits_by_direction
            .get(&room)
            .and_then(|m| m.get(&direction))
            .cloned()
        else {
            return self.say(&session, &format!("You see no exit {direction}."), id);
        };
        let Some(destination) = self.exit_destination.get(&exit).cloned() else {
            return self.say(&session, &format!("You see no exit {direction}."), id);
        };

        let op = format!("movement:{session}:{id}");
        let txn = format!("txn:move:{session}:{id}");
        let now = (self.now_iso)();

        let mut out = vec![
            // Movement op intent.
            Claim::new(&op, IS_A_TERM, MOVEMENT),
            Claim::new(&op, MOVER_IS, &avatar),
            Claim::new(&op, MOVES_FROM, &room),
            Claim::new(&op, MOVES_TO, &destination),
            Claim::new(&op, MOVES_VIA_EXIT, &exit),
            Claim::new(&op, MOVES_IN_DIRECTION, &direction),
            // Balanced accounting transaction.
            Claim::new(&txn, IS_A_TERM, TRANSACTION),
            Claim::new(&txn, DEBITS, &room),
            Claim::new(&txn, CREDITS, &destination),
            Claim::new(&txn, BALANCES, &avatar),
            Claim::new(&txn, MEASURED_IN, COMMODITY_PERSON),
            Claim::new(&txn, "recorded-at", &now),
            // Containment swap. CONTAINS/EXCLUDES_FROM is a double-
            // declared algebraic-negation pair (per container.rs), so
            // witnessing either side propagates to the other via
            // inversion.
            Claim::new(&room, EXCLUDES_FROM, &avatar),
            Claim::new(&destination, CONTAINS, &avatar),
        ];
        out.extend(self.compose_say_msg(&session, &format!("You go {direction}."), id));

        // Update in-port location cache so a subsequent go- request
        // resolves correctly without waiting for CONTAINS to re-settle.
        self.avatar_location
            .insert(avatar.clone(), destination.clone());

        out
    }

    fn say(&mut self, session: &str, body: &str, id: u64) -> Vec<Claim> {
        self.compose_say_msg(session, body, id)
    }

    fn compose_say_msg(&self, session: &str, body: &str, id: u64) -> Vec<Claim> {
        let msg = format!("msg:go-agent:{id}");
        vec![
            Claim::new(&msg, WAS_SAID_IN, session),
            Claim::new(&msg, HAS_BODY, body),
            Claim::new(&msg, IS_SURFACE_READY, session),
        ]
    }
}

impl Projection for GoAgentPort {
    fn identity(&self) -> &str {
        "mash-library-go-agent"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            ISSUED_BY_SESSION.to_owned(),
            INVOKES_COMMAND.to_owned(),
            HAS_BINDING_DIRECTION.to_owned(),
            INHABITS.to_owned(),
            CONTAINS.to_owned(),
            HAS_EXIT.to_owned(),
            GOES_DIRECTION.to_owned(),
            LEADS_TO.to_owned(),
        ]
    }

    fn ingest(
        &mut self,
        subject: &str,
        predicate: &str,
        object: &str,
        value: Value,
    ) -> Vec<Claim> {
        if value != Value::True {
            return Vec::new();
        }

        if predicate == ISSUED_BY_SESSION {
            self.request_session
                .insert(subject.to_owned(), object.to_owned());
            return self.try_fire(subject);
        }
        if predicate == HAS_BINDING_DIRECTION {
            self.request_direction
                .insert(subject.to_owned(), object.to_owned());
            return self.try_fire(subject);
        }
        if predicate == INVOKES_COMMAND && object == COMMAND_GO {
            self.invoked.insert(subject.to_owned());
            return self.try_fire(subject);
        }
        if predicate == INHABITS {
            // (session, inhabits, avatar)
            self.session_avatar
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == CONTAINS {
            // (room, contains, avatar) — reverse-index so avatar →
            // room lookup is O(1). A subsequent move-emission updates
            // this in-port; external CONTAINS settlements also feed in.
            self.avatar_location
                .insert(object.to_owned(), subject.to_owned());
            return Vec::new();
        }
        if predicate == HAS_EXIT {
            // (room, has-exit, exit)
            self.room_exits
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
            self.reindex_room(subject);
            return Vec::new();
        }
        if predicate == GOES_DIRECTION {
            // (exit, goes-direction, direction)
            self.exit_direction
                .insert(subject.to_owned(), object.to_owned());
            self.reindex_exit(subject);
            return Vec::new();
        }
        if predicate == LEADS_TO {
            // (exit, leads-to, room)
            self.exit_destination
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_now() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    fn mount_world(port: &mut GoAgentPort) {
        // Two rooms connected north/south by a single exit.
        let _ = port.ingest("room:a", HAS_EXIT, "exit:a-north", Value::True);
        let _ = port.ingest("exit:a-north", GOES_DIRECTION, "north", Value::True);
        let _ = port.ingest("exit:a-north", LEADS_TO, "room:b", Value::True);
        let _ = port.ingest("room:b", HAS_EXIT, "exit:b-south", Value::True);
        let _ = port.ingest("exit:b-south", GOES_DIRECTION, "south", Value::True);
        let _ = port.ingest("exit:b-south", LEADS_TO, "room:a", Value::True);
    }

    fn place_avatar(port: &mut GoAgentPort, session: &str, avatar: &str, room: &str) {
        let _ = port.ingest(session, INHABITS, avatar, Value::True);
        let _ = port.ingest(room, CONTAINS, avatar, Value::True);
    }

    fn fire_go(
        port: &mut GoAgentPort,
        request: &str,
        session: &str,
        direction: &str,
    ) -> Vec<Claim> {
        let mut out = Vec::new();
        out.extend(port.ingest(request, ISSUED_BY_SESSION, session, Value::True));
        out.extend(port.ingest(request, HAS_BINDING_DIRECTION, direction, Value::True));
        out.extend(port.ingest(request, INVOKES_COMMAND, COMMAND_GO, Value::True));
        out
    }

    #[test]
    fn successful_go_emits_movement_op_and_txn_and_swap() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        mount_world(&mut port);
        place_avatar(&mut port, "session:1", "avatar:1", "room:a");
        let out = fire_go(&mut port, "req-1", "session:1", "north");

        // Movement op.
        assert!(out.iter().any(|c| c.predicate == MOVER_IS && c.object == "avatar:1"));
        assert!(out.iter().any(|c| c.predicate == MOVES_FROM && c.object == "room:a"));
        assert!(out.iter().any(|c| c.predicate == MOVES_TO && c.object == "room:b"));
        assert!(out
            .iter()
            .any(|c| c.predicate == MOVES_IN_DIRECTION && c.object == "north"));
        assert!(out
            .iter()
            .any(|c| c.predicate == MOVES_VIA_EXIT && c.object == "exit:a-north"));

        // Accounting.
        assert!(out.iter().any(|c| c.predicate == DEBITS && c.object == "room:a"));
        assert!(out.iter().any(|c| c.predicate == CREDITS && c.object == "room:b"));
        assert!(out.iter().any(|c| c.predicate == BALANCES && c.object == "avatar:1"));
        assert!(out
            .iter()
            .any(|c| c.predicate == MEASURED_IN && c.object == COMMODITY_PERSON));

        // Containment swap.
        assert!(out
            .iter()
            .any(|c| c.subject == "room:a" && c.predicate == EXCLUDES_FROM && c.object == "avatar:1"));
        assert!(out
            .iter()
            .any(|c| c.subject == "room:b" && c.predicate == CONTAINS && c.object == "avatar:1"));

        // Reply message.
        assert!(out.iter().any(|c| c.predicate == HAS_BODY && c.object == "You go north."));
    }

    #[test]
    fn missing_avatar_emits_error() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        mount_world(&mut port);
        // No INHABITS.
        let out = fire_go(&mut port, "req-1", "session:1", "north");
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object == "You have no body to move."));
        assert!(!out.iter().any(|c| c.predicate == MOVES_TO));
    }

    #[test]
    fn missing_location_emits_error() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        mount_world(&mut port);
        let _ = port.ingest("session:1", INHABITS, "avatar:1", Value::True);
        // No CONTAINS for avatar:1.
        let out = fire_go(&mut port, "req-1", "session:1", "north");
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object.contains("nowhere")));
    }

    #[test]
    fn unknown_direction_emits_no_exit_message() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        mount_world(&mut port);
        place_avatar(&mut port, "session:1", "avatar:1", "room:a");
        let out = fire_go(&mut port, "req-1", "session:1", "up");
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_BODY && c.object == "You see no exit up."));
        assert!(!out.iter().any(|c| c.predicate == MOVES_TO));
    }

    #[test]
    fn second_go_resolves_from_new_location() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        mount_world(&mut port);
        place_avatar(&mut port, "session:1", "avatar:1", "room:a");
        let _ = fire_go(&mut port, "req-1", "session:1", "north");
        // Now at room:b. Going south should land back at room:a.
        let out = fire_go(&mut port, "req-2", "session:1", "south");
        assert!(out.iter().any(|c| c.predicate == MOVES_FROM && c.object == "room:b"));
        assert!(out.iter().any(|c| c.predicate == MOVES_TO && c.object == "room:a"));
    }

    #[test]
    fn go_is_once_per_request() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        mount_world(&mut port);
        place_avatar(&mut port, "session:1", "avatar:1", "room:a");
        let first = fire_go(&mut port, "req-1", "session:1", "north");
        assert!(!first.is_empty());
        let again = port.ingest("req-1", INVOKES_COMMAND, COMMAND_GO, Value::True);
        assert!(again.is_empty());
    }

    #[test]
    fn ordering_of_accumulations_does_not_matter() {
        let mut port = GoAgentPort::new().with_clock(fixed_now);
        // Introduce binding + direction BEFORE avatar/world setup.
        let _ = port.ingest("req-1", ISSUED_BY_SESSION, "session:1", Value::True);
        let _ = port.ingest("req-1", HAS_BINDING_DIRECTION, "north", Value::True);
        let _ = port.ingest("req-1", INVOKES_COMMAND, COMMAND_GO, Value::True);
        // Above fires with no avatar → "no body" error.
        // Now setup world; second invocation should succeed.
        mount_world(&mut port);
        place_avatar(&mut port, "session:1", "avatar:1", "room:a");
        let out = fire_go(&mut port, "req-2", "session:1", "north");
        assert!(out.iter().any(|c| c.predicate == MOVES_TO && c.object == "room:b"));
    }
}
