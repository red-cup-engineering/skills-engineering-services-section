//! MUD ambient projections — session disposition, noise, wander.
//!
//! Three scene-level projections that animate the world when nothing
//! is happening on the dispatch path:
//!
//! - [`DispositionPort`] — on session end, moves the puppeted avatar
//!   to the backrooms holding area so live play continues cleanly.
//! - [`NoisePort`] — on a tick signal, picks a noise from each
//!   occupied room and surfaces it to the occupants' renders.
//! - [`WanderPort`] — on a tick signal, moves each roaming NPC one
//!   step along a random exit (deterministic in-library; production
//!   injects a real RNG).
//!
//! # Tick as a substrate cell
//!
//! Rather than a tokio timer, the library-level ambient ports treat
//! `(subject, ambient-tick, subject)` as the trigger. A subprocess
//! binary — or a test harness — witnesses [`AMBIENT_TICK`] on a
//! diagonal cell whenever the cadence fires. This keeps the port
//! logic deterministic and testable without real-time machinery.
//!
//! # Vocabulary
//!
//! - [`HAS_NOISE_TEXT`] — noise subject's rendered text
//! - [`HAS_NOISE_WEIGHT`] — relative weight (decimal string)
//! - [`HAS_ANIMATION`] — NPC's animation kind
//! - [`ROAM_ANIMATION`] — value for wandering NPCs
//! - [`REGION_LOCKED_TO`] — optional region constraint on an NPC
//! - [`AREA_BACKROOMS`] — content marker for the holding area

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;

use crate::accounting::{BALANCES, COMMODITY_PERSON, CREDITS, DEBITS, MEASURED_IN, TRANSACTION};
use crate::container::{CONTAINS, EXCLUDES_FROM};
use crate::conduit::{HAS_BODY, IS_SURFACE_READY, WAS_SAID_IN};
use crate::foundation::IS_A_TERM;
use crate::movement::{MOVEMENT, MOVER_IS, MOVES_FROM, MOVES_IN_DIRECTION, MOVES_TO, MOVES_VIA_EXIT};
use crate::mud::session::{HAS_SESSION_STATE, PUPPETS};
use crate::mud::verbs::STATE_DEPARTED;
use crate::presence::ENDED_AT;
use crate::space::{GOES_DIRECTION, HAS_EXIT, LEADS_TO};

// ─────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────

/// Tick-trigger predicate. Subprocess binaries or test harnesses
/// witness `(subject, ambient-tick, subject)` on a steady cadence;
/// ambient ports subscribe and react.
pub const AMBIENT_TICK: &str = "ambient-tick";

/// `(noise, has-noise-text, string)` — rendered noise text.
pub const HAS_NOISE_TEXT: &str = "has-noise-text";

/// `(noise, has-noise-weight, decimal-string)` — relative pick weight.
/// Absent → defaults to 1.
pub const HAS_NOISE_WEIGHT: &str = "has-noise-weight";

/// `(npc, has-animation, animation-term)` — NPC animation kind.
pub const HAS_ANIMATION: &str = "has-animation";

/// Animation value for NPCs that wander.
pub const ROAM_ANIMATION: &str = "roam";

/// `(npc, region-locked-to, region)` — optional wander region
/// constraint.
pub const REGION_LOCKED_TO: &str = "region-locked-to";

/// `(room, area, area-term)` — room's region membership.
pub const AREA: &str = "area";

/// Backrooms holding area subject — destination for departed avatars.
pub const AREA_BACKROOMS: &str = "area:backrooms";

/// `(noise, located-at, room)` — noise belongs to this room's pool.
pub const NOISE_LOCATED_AT: &str = "located-at";

// ─────────────────────────────────────────────────────────────────────
// Disposition — on ended-at, move the avatar to the backrooms
// ─────────────────────────────────────────────────────────────────────

/// On `(session, ended-at, iso)`, asserts `state:departed` on the
/// session and emits a balanced move that sends the session's
/// puppeted avatar to [`AREA_BACKROOMS`].
pub struct DispositionPort {
    puppeted: HashMap<String, String>,
    avatar_location: HashMap<String, String>,
    dispatched: HashSet<String>,
    next_id: u64,
    now_iso: fn() -> String,
}

impl Default for DispositionPort {
    fn default() -> Self {
        Self::new()
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl DispositionPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            puppeted: HashMap::new(),
            avatar_location: HashMap::new(),
            dispatched: HashSet::new(),
            next_id: 1,
            now_iso: default_now_iso,
        }
    }

    /// Fresh state with custom clock.
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }
}

impl Projection for DispositionPort {
    fn identity(&self) -> &str {
        "mash-library-disposition"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![ENDED_AT.to_owned(), PUPPETS.to_owned(), CONTAINS.to_owned()]
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
        if predicate == PUPPETS {
            self.puppeted
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == CONTAINS {
            // (room, contains, avatar) — reverse index.
            self.avatar_location
                .insert(object.to_owned(), subject.to_owned());
            return Vec::new();
        }
        if predicate == ENDED_AT {
            if !self.dispatched.insert(subject.to_owned()) {
                return Vec::new();
            }
            let session = subject;
            let id = self.next_id;
            self.next_id += 1;

            let mut out = vec![Claim::new(session, HAS_SESSION_STATE, STATE_DEPARTED)];
            let Some(avatar) = self.puppeted.get(session).cloned() else {
                return out;
            };
            let Some(room) = self.avatar_location.get(&avatar).cloned() else {
                return out;
            };
            if room == AREA_BACKROOMS {
                return out;
            }
            let now = (self.now_iso)();
            let txn = format!("txn:backrooms:{session}:{id}");
            out.extend(vec![
                Claim::new(&txn, IS_A_TERM, TRANSACTION),
                Claim::new(&txn, DEBITS, &room),
                Claim::new(&txn, CREDITS, AREA_BACKROOMS),
                Claim::new(&txn, BALANCES, &avatar),
                Claim::new(&txn, MEASURED_IN, COMMODITY_PERSON),
                Claim::new(&txn, "recorded-at", &now),
                Claim::new(&room, EXCLUDES_FROM, &avatar),
                Claim::new(AREA_BACKROOMS, CONTAINS, &avatar),
            ]);
            return out;
        }
        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Noise — on tick, surface one noise per occupied room
// ─────────────────────────────────────────────────────────────────────

/// On each [`AMBIENT_TICK`], picks the highest-weighted noise from
/// each occupied room and emits it as a session-render addition for
/// each occupant. A production deployment injects a real RNG via
/// [`NoisePort::with_picker`]; the default picker is deterministic
/// (highest weight, then lexicographic subject).
pub struct NoisePort {
    /// room → set of noises located there.
    noises_in_room: HashMap<String, BTreeSet<String>>,
    noise_text: HashMap<String, String>,
    noise_weight: HashMap<String, u32>,
    /// room → set of avatars currently contained.
    room_occupants: HashMap<String, BTreeSet<String>>,
    /// avatar → session puppeting it (inverse of PUPPETS).
    avatar_session: HashMap<String, String>,
    /// Last noise emitted per room (so the pick rotates on consecutive
    /// ticks even with deterministic picker).
    last_emitted: HashMap<String, String>,
    picker: fn(&[(&str, u32)], u64) -> Option<String>,
    tick_counter: u64,
}

impl Default for NoisePort {
    fn default() -> Self {
        Self::new()
    }
}

/// Deterministic picker: returns the noise with the highest weight.
/// Ties broken by lexicographic subject order. `_tick` unused.
fn default_picker(noises: &[(&str, u32)], _tick: u64) -> Option<String> {
    noises
        .iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(b.0)))
        .map(|(s, _)| (*s).to_owned())
}

impl NoisePort {
    /// Fresh state with deterministic picker.
    #[must_use]
    pub fn new() -> Self {
        Self {
            noises_in_room: HashMap::new(),
            noise_text: HashMap::new(),
            noise_weight: HashMap::new(),
            room_occupants: HashMap::new(),
            avatar_session: HashMap::new(),
            last_emitted: HashMap::new(),
            picker: default_picker,
            tick_counter: 0,
        }
    }

    /// Inject a custom picker: `fn(&[(noise, weight)], tick) -> Option<noise>`.
    #[must_use]
    pub fn with_picker(mut self, picker: fn(&[(&str, u32)], u64) -> Option<String>) -> Self {
        self.picker = picker;
        self
    }

    /// Noise-set for a room (for testing).
    #[must_use]
    pub fn noises_for(&self, room: &str) -> Vec<String> {
        self.noises_in_room
            .get(room)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn emit_for_room(&mut self, room: &str) -> Vec<Claim> {
        let Some(occupants) = self.room_occupants.get(room).cloned() else {
            return Vec::new();
        };
        if occupants.is_empty() {
            return Vec::new();
        }
        let noises: Vec<(&str, u32)> = self
            .noises_in_room
            .get(room)
            .into_iter()
            .flatten()
            .filter_map(|n| {
                // Only include noises with text; weight defaults to 1.
                if !self.noise_text.contains_key(n) {
                    return None;
                }
                let w = self.noise_weight.get(n).copied().unwrap_or(1);
                Some((n.as_str(), w))
            })
            .collect();
        if noises.is_empty() {
            return Vec::new();
        }
        let Some(picked) = (self.picker)(&noises, self.tick_counter) else {
            return Vec::new();
        };
        self.last_emitted
            .insert(room.to_owned(), picked.clone());
        let Some(text) = self.noise_text.get(&picked).cloned() else {
            return Vec::new();
        };

        let mut out = Vec::new();
        for avatar in occupants {
            if let Some(session) = self.avatar_session.get(&avatar).cloned() {
                let msg = format!("msg:noise:{}:{}", self.tick_counter, avatar);
                out.push(Claim::new(&msg, WAS_SAID_IN, &session));
                out.push(Claim::new(&msg, HAS_BODY, &text));
                out.push(Claim::new(&msg, IS_SURFACE_READY, &session));
            }
        }
        out
    }
}

impl Projection for NoisePort {
    fn identity(&self) -> &str {
        "mash-library-ambient-noise"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            AMBIENT_TICK.to_owned(),
            NOISE_LOCATED_AT.to_owned(),
            HAS_NOISE_TEXT.to_owned(),
            HAS_NOISE_WEIGHT.to_owned(),
            CONTAINS.to_owned(),
            PUPPETS.to_owned(),
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
        if predicate == NOISE_LOCATED_AT {
            // (noise, located-at, room)
            self.noises_in_room
                .entry(object.to_owned())
                .or_default()
                .insert(subject.to_owned());
            return Vec::new();
        }
        if predicate == HAS_NOISE_TEXT {
            self.noise_text
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == HAS_NOISE_WEIGHT {
            if let Ok(w) = object.parse::<u32>() {
                self.noise_weight.insert(subject.to_owned(), w);
            }
            return Vec::new();
        }
        if predicate == CONTAINS {
            // (room, contains, avatar)
            self.room_occupants
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
            return Vec::new();
        }
        if predicate == PUPPETS {
            // (session, puppets, avatar)
            self.avatar_session
                .insert(object.to_owned(), subject.to_owned());
            return Vec::new();
        }
        if predicate == AMBIENT_TICK {
            self.tick_counter += 1;
            let rooms: Vec<String> = self.room_occupants.keys().cloned().collect();
            let mut out = Vec::new();
            for room in rooms {
                out.extend(self.emit_for_room(&room));
            }
            return out;
        }
        Vec::new()
    }
}

// ─────────────────────────────────────────────────────────────────────
// Wander — NPCs with has-animation roam pick an exit per tick
// ─────────────────────────────────────────────────────────────────────

/// On each [`AMBIENT_TICK`], each NPC with [`HAS_ANIMATION`] ==
/// [`ROAM_ANIMATION`] picks an exit from its current room and emits
/// a movement op + accounting txn. Exit pick is deterministic via
/// the `exit_picker` closure (defaults to first by name order);
/// production deployments inject a real RNG.
pub struct WanderPort {
    /// (npc → animation). Only `roam` NPCs wander.
    animation: HashMap<String, String>,
    /// npc → region locked to.
    region_lock: HashMap<String, String>,
    /// avatar (or npc) → room (from CONTAINS reverse).
    avatar_location: HashMap<String, String>,
    /// room → (direction → exit).
    room_exits_by_direction: HashMap<String, BTreeMap<String, String>>,
    /// exit → direction.
    exit_direction: HashMap<String, String>,
    /// room → exits.
    room_exits: HashMap<String, BTreeSet<String>>,
    exit_destination: HashMap<String, String>,
    /// room → area.
    room_area: HashMap<String, String>,
    exit_picker: fn(&[(&str, &str)], u64) -> Option<usize>,
    tick_counter: u64,
    next_id: u64,
    now_iso: fn() -> String,
}

impl Default for WanderPort {
    fn default() -> Self {
        Self::new()
    }
}

/// Deterministic exit picker: picks the first exit in lexicographic
/// order. `_tick` unused.
fn default_exit_picker(exits: &[(&str, &str)], _tick: u64) -> Option<usize> {
    if exits.is_empty() {
        None
    } else {
        Some(0)
    }
}

impl WanderPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            animation: HashMap::new(),
            region_lock: HashMap::new(),
            avatar_location: HashMap::new(),
            room_exits_by_direction: HashMap::new(),
            exit_direction: HashMap::new(),
            room_exits: HashMap::new(),
            exit_destination: HashMap::new(),
            room_area: HashMap::new(),
            exit_picker: default_exit_picker,
            tick_counter: 0,
            next_id: 1,
            now_iso: default_now_iso,
        }
    }

    /// Inject a custom exit picker.
    #[must_use]
    pub fn with_exit_picker(
        mut self,
        picker: fn(&[(&str, &str)], u64) -> Option<usize>,
    ) -> Self {
        self.exit_picker = picker;
        self
    }

    /// Custom clock.
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }

    fn reindex_room(&mut self, room: &str) {
        let exits = self.room_exits.get(room).cloned().unwrap_or_default();
        let mut by_dir: BTreeMap<String, String> = BTreeMap::new();
        for exit in exits {
            if let Some(dir) = self.exit_direction.get(&exit).cloned() {
                by_dir.insert(dir, exit);
            }
        }
        self.room_exits_by_direction.insert(room.to_owned(), by_dir);
    }

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

    fn wander_npc(&mut self, npc: &str) -> Vec<Claim> {
        let Some(room) = self.avatar_location.get(npc).cloned() else {
            return Vec::new();
        };
        let exits = self
            .room_exits_by_direction
            .get(&room)
            .cloned()
            .unwrap_or_default();
        let region = self.region_lock.get(npc).cloned();
        let candidates: Vec<(String, String)> = exits
            .into_iter()
            .filter(|(_, exit)| {
                let Some(dest) = self.exit_destination.get(exit) else {
                    return false;
                };
                match &region {
                    Some(r) => self.room_area.get(dest).map(String::as_str) == Some(r.as_str()),
                    None => true,
                }
            })
            .collect();
        if candidates.is_empty() {
            return Vec::new();
        }
        let view: Vec<(&str, &str)> = candidates
            .iter()
            .map(|(d, e)| (d.as_str(), e.as_str()))
            .collect();
        let Some(idx) = (self.exit_picker)(&view, self.tick_counter) else {
            return Vec::new();
        };
        let (direction, exit) = candidates[idx].clone();
        let Some(destination) = self.exit_destination.get(&exit).cloned() else {
            return Vec::new();
        };

        let id = self.next_id;
        self.next_id += 1;
        let op = format!("movement:wander:{npc}:{id}");
        let txn = format!("txn:wander:{npc}:{id}");
        let now = (self.now_iso)();

        let out = vec![
            Claim::new(&op, IS_A_TERM, MOVEMENT),
            Claim::new(&op, MOVER_IS, npc),
            Claim::new(&op, MOVES_FROM, &room),
            Claim::new(&op, MOVES_TO, &destination),
            Claim::new(&op, MOVES_VIA_EXIT, &exit),
            Claim::new(&op, MOVES_IN_DIRECTION, &direction),
            Claim::new(&txn, IS_A_TERM, TRANSACTION),
            Claim::new(&txn, DEBITS, &room),
            Claim::new(&txn, CREDITS, &destination),
            Claim::new(&txn, BALANCES, npc),
            Claim::new(&txn, MEASURED_IN, COMMODITY_PERSON),
            Claim::new(&txn, "recorded-at", &now),
            Claim::new(&room, EXCLUDES_FROM, npc),
            Claim::new(&destination, CONTAINS, npc),
        ];

        self.avatar_location
            .insert(npc.to_owned(), destination);
        out
    }
}

impl Projection for WanderPort {
    fn identity(&self) -> &str {
        "mash-library-ambient-wander"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            AMBIENT_TICK.to_owned(),
            HAS_ANIMATION.to_owned(),
            REGION_LOCKED_TO.to_owned(),
            CONTAINS.to_owned(),
            HAS_EXIT.to_owned(),
            GOES_DIRECTION.to_owned(),
            LEADS_TO.to_owned(),
            AREA.to_owned(),
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
        if predicate == HAS_ANIMATION {
            self.animation
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == REGION_LOCKED_TO {
            self.region_lock
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == CONTAINS {
            // (room, contains, something).
            self.avatar_location
                .insert(object.to_owned(), subject.to_owned());
            return Vec::new();
        }
        if predicate == HAS_EXIT {
            self.room_exits
                .entry(subject.to_owned())
                .or_default()
                .insert(object.to_owned());
            self.reindex_room(subject);
            return Vec::new();
        }
        if predicate == GOES_DIRECTION {
            self.exit_direction
                .insert(subject.to_owned(), object.to_owned());
            self.reindex_exit(subject);
            return Vec::new();
        }
        if predicate == LEADS_TO {
            self.exit_destination
                .insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == AREA {
            self.room_area.insert(subject.to_owned(), object.to_owned());
            return Vec::new();
        }
        if predicate == AMBIENT_TICK {
            self.tick_counter += 1;
            let npcs: Vec<String> = self
                .animation
                .iter()
                .filter(|(_, a)| a.as_str() == ROAM_ANIMATION)
                .map(|(n, _)| n.clone())
                .collect();
            let mut out = Vec::new();
            for npc in npcs {
                out.extend(self.wander_npc(&npc));
            }
            return out;
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

    // ─── Disposition ─────────────────────────────────────────────

    #[test]
    fn disposition_transitions_state_and_sends_to_backrooms() {
        let mut port = DispositionPort::new().with_clock(fixed_now);
        let _ = port.ingest("session:1", PUPPETS, "avatar:1", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "avatar:1", Value::True);
        let out = port.ingest("session:1", ENDED_AT, fixed_now().as_str(), Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_SESSION_STATE && c.object == STATE_DEPARTED));
        assert!(out.iter().any(|c| c.predicate == DEBITS && c.object == "room:a"));
        assert!(out.iter().any(|c| c.predicate == CREDITS && c.object == AREA_BACKROOMS));
        assert!(out.iter().any(|c| c.predicate == BALANCES && c.object == "avatar:1"));
    }

    #[test]
    fn disposition_is_idempotent() {
        let mut port = DispositionPort::new().with_clock(fixed_now);
        let _ = port.ingest("session:1", PUPPETS, "avatar:1", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "avatar:1", Value::True);
        let first = port.ingest("session:1", ENDED_AT, fixed_now().as_str(), Value::True);
        assert!(!first.is_empty());
        let again = port.ingest("session:1", ENDED_AT, fixed_now().as_str(), Value::True);
        assert!(again.is_empty());
    }

    #[test]
    fn disposition_without_puppet_only_marks_state() {
        let mut port = DispositionPort::new().with_clock(fixed_now);
        let out = port.ingest("session:1", ENDED_AT, "now", Value::True);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].predicate, HAS_SESSION_STATE);
        assert_eq!(out[0].object, STATE_DEPARTED);
    }

    #[test]
    fn disposition_skips_move_when_already_in_backrooms() {
        let mut port = DispositionPort::new().with_clock(fixed_now);
        let _ = port.ingest("session:1", PUPPETS, "avatar:1", Value::True);
        let _ = port.ingest(AREA_BACKROOMS, CONTAINS, "avatar:1", Value::True);
        let out = port.ingest("session:1", ENDED_AT, "now", Value::True);
        // State transition only; no txn.
        assert!(out.iter().any(|c| c.predicate == HAS_SESSION_STATE));
        assert!(!out.iter().any(|c| c.predicate == DEBITS));
    }

    // ─── Noise ───────────────────────────────────────────────────

    #[test]
    fn noise_tick_surfaces_highest_weight_to_occupants() {
        let mut port = NoisePort::new();
        // Two noises in room:a.
        let _ = port.ingest("noise:drip", NOISE_LOCATED_AT, "room:a", Value::True);
        let _ = port.ingest("noise:drip", HAS_NOISE_TEXT, "A drip echoes.", Value::True);
        let _ = port.ingest("noise:drip", HAS_NOISE_WEIGHT, "1", Value::True);
        let _ = port.ingest("noise:howl", NOISE_LOCATED_AT, "room:a", Value::True);
        let _ = port.ingest("noise:howl", HAS_NOISE_TEXT, "A distant howl.", Value::True);
        let _ = port.ingest("noise:howl", HAS_NOISE_WEIGHT, "5", Value::True);
        // Two occupants.
        let _ = port.ingest("session:1", PUPPETS, "avatar:1", Value::True);
        let _ = port.ingest("session:2", PUPPETS, "avatar:2", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "avatar:1", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "avatar:2", Value::True);

        let out = port.ingest("global", AMBIENT_TICK, "global", Value::True);
        // Higher-weighted howl wins.
        let body_claims: Vec<&Claim> = out.iter().filter(|c| c.predicate == HAS_BODY).collect();
        assert_eq!(body_claims.len(), 2);
        for c in &body_claims {
            assert_eq!(c.object, "A distant howl.");
        }
        // One is-surface-ready per occupant.
        let sr: Vec<&Claim> = out.iter().filter(|c| c.predicate == IS_SURFACE_READY).collect();
        assert_eq!(sr.len(), 2);
    }

    #[test]
    fn noise_tick_skips_empty_rooms() {
        let mut port = NoisePort::new();
        let _ = port.ingest("noise:x", NOISE_LOCATED_AT, "room:a", Value::True);
        let _ = port.ingest("noise:x", HAS_NOISE_TEXT, "?", Value::True);
        // No CONTAINS — room:a has no occupants.
        let out = port.ingest("global", AMBIENT_TICK, "global", Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn noise_default_weight_is_one() {
        let mut port = NoisePort::new();
        let _ = port.ingest("noise:a", NOISE_LOCATED_AT, "room:a", Value::True);
        let _ = port.ingest("noise:a", HAS_NOISE_TEXT, "A.", Value::True);
        // No weight declared — treated as 1.
        let _ = port.ingest("session:1", PUPPETS, "avatar:1", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "avatar:1", Value::True);
        let out = port.ingest("g", AMBIENT_TICK, "g", Value::True);
        assert!(out.iter().any(|c| c.predicate == HAS_BODY && c.object == "A."));
    }

    // ─── Wander ──────────────────────────────────────────────────

    fn mount_small_world(port: &mut WanderPort) {
        let _ = port.ingest("room:a", HAS_EXIT, "exit:a-north", Value::True);
        let _ = port.ingest("exit:a-north", GOES_DIRECTION, "north", Value::True);
        let _ = port.ingest("exit:a-north", LEADS_TO, "room:b", Value::True);
        let _ = port.ingest("room:b", HAS_EXIT, "exit:b-south", Value::True);
        let _ = port.ingest("exit:b-south", GOES_DIRECTION, "south", Value::True);
        let _ = port.ingest("exit:b-south", LEADS_TO, "room:a", Value::True);
    }

    #[test]
    fn wander_moves_roaming_npc_on_tick() {
        let mut port = WanderPort::new().with_clock(fixed_now);
        mount_small_world(&mut port);
        let _ = port.ingest("npc:bat", HAS_ANIMATION, ROAM_ANIMATION, Value::True);
        let _ = port.ingest("room:a", CONTAINS, "npc:bat", Value::True);
        let out = port.ingest("g", AMBIENT_TICK, "g", Value::True);
        assert!(out.iter().any(|c| c.predicate == MOVER_IS && c.object == "npc:bat"));
        assert!(out.iter().any(|c| c.predicate == MOVES_FROM && c.object == "room:a"));
        assert!(out.iter().any(|c| c.predicate == MOVES_TO && c.object == "room:b"));
    }

    #[test]
    fn wander_ignores_non_roaming_npcs() {
        let mut port = WanderPort::new().with_clock(fixed_now);
        mount_small_world(&mut port);
        let _ = port.ingest("npc:statue", HAS_ANIMATION, "still", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "npc:statue", Value::True);
        let out = port.ingest("g", AMBIENT_TICK, "g", Value::True);
        assert!(!out.iter().any(|c| c.predicate == MOVER_IS));
    }

    #[test]
    fn wander_respects_region_lock() {
        let mut port = WanderPort::new().with_clock(fixed_now);
        mount_small_world(&mut port);
        // Only room:a is in region1; room:b is in region2. NPC is
        // locked to region1.
        let _ = port.ingest("room:a", AREA, "region1", Value::True);
        let _ = port.ingest("room:b", AREA, "region2", Value::True);
        let _ = port.ingest("npc:bat", HAS_ANIMATION, ROAM_ANIMATION, Value::True);
        let _ = port.ingest("npc:bat", REGION_LOCKED_TO, "region1", Value::True);
        let _ = port.ingest("room:a", CONTAINS, "npc:bat", Value::True);
        let out = port.ingest("g", AMBIENT_TICK, "g", Value::True);
        // No exit leads to another room:a-area destination; skip.
        assert!(!out.iter().any(|c| c.predicate == MOVER_IS));
    }

    #[test]
    fn wander_consecutive_ticks_move_npc_through_chain() {
        let mut port = WanderPort::new().with_clock(fixed_now);
        mount_small_world(&mut port);
        let _ = port.ingest("npc:bat", HAS_ANIMATION, ROAM_ANIMATION, Value::True);
        let _ = port.ingest("room:a", CONTAINS, "npc:bat", Value::True);
        let t1 = port.ingest("g", AMBIENT_TICK, "g", Value::True);
        assert!(t1.iter().any(|c| c.predicate == MOVES_TO && c.object == "room:b"));
        let t2 = port.ingest("g", AMBIENT_TICK, "g", Value::True);
        assert!(t2.iter().any(|c| c.predicate == MOVES_FROM && c.object == "room:b"));
        assert!(t2.iter().any(|c| c.predicate == MOVES_TO && c.object == "room:a"));
    }
}
