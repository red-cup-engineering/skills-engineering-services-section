//! Perception-effector — assembles room/thing renderings and delivers
//! them to the session's `HAS_SESSION_RENDER` fiber.
//!
//! # Pattern
//!
//! Stateful projection that:
//!
//! 1. Caches target-quality claims: [`HAS_NAME`], [`HAS_DESCRIPTION`],
//!    [`CONTAINS`] (for room-contents listing).
//! 2. Caches perception-op intent: [`LOOKS_AT`], [`REPORTS_TO`],
//!    function-kind.
//! 3. On selection of a LOOK op, assembles a rendering from the cached
//!    target qualities, witnesses:
//!    - `(session, HAS_SESSION_RENDER, rendered-text)` — the session
//!      picks this up via its effector.
//!    - `(op, HAS_RENDERING, rendered-text)` — the op's own fiber
//!      records what was rendered.
//!    - `(op, IS_COMPLETED, op)` — op done.
//!    - `(op, PERFORMED_BY, IDENTITY)` — provenance.
//!
//! # Rendering format
//!
//! For a room target:
//! ```text
//! <name>
//!
//! <description>
//!
//! Contents: <comma-separated names>
//! ```
//!
//! For a non-container target (an item): just name + description.
//! More nuanced rendering (exits listing, trivia, ambient noise) is
//! downstream content work.
//!
//! # Wiener/Barad framing
//!
//! The rendering is not a method return value; it's a settled claim
//! at `(session, has-session-render, text)`. Conduit ports observe
//! this fiber to write bytes to their sockets; other observers
//! (logging, telemetry, replay) see the same event at the same
//! substrate cell.
//!
//! # Prior art
//!
//! `mash-old-library/archive/mash-port-projection-mud-space/src/bin/look.rs`.

use mash_engine::algebra::Value;
use mash_engine::sdk::agent::Projection;
use mash_engine::sdk::client::Claim;
use std::collections::{HashMap, HashSet};

use crate::container::{CONTAINS, HAS_DESCRIPTION, HAS_NAME};
use crate::dispatch::{CONSIDERS_OP, IS_SELECTED};
use crate::ops::{HAS_FUNCTION, IS_COMPLETED, PERFORMED_BY};
use crate::perception::{HAS_RENDERING, IS_RENDERED, LOOKS_AT, LOOK_FUNCTION, REPORTS_TO};
use crate::presence::HAS_SESSION_RENDER;

/// Owner identity.
pub const IDENTITY: &str = "mash-library-perception-effector";

/// Intent cached per perception op.
#[derive(Debug, Default, Clone)]
struct PerceptionIntent {
    is_look: bool,
    target: Option<String>,
    session: Option<String>,
}

impl PerceptionIntent {
    fn ready(&self) -> bool {
        self.is_look && self.target.is_some() && self.session.is_some()
    }
}

/// Candidate state cached per candidate subject.
#[derive(Debug, Default, Clone)]
struct CandidateState {
    op: Option<String>,
    selected: bool,
}

/// Target-quality cache.
#[derive(Debug, Default, Clone)]
struct TargetCache {
    name: Option<String>,
    description: Option<String>,
    contents: HashSet<String>,
}

/// Perception-effector state.
#[derive(Debug, Default)]
pub struct PerceptionEffector {
    ops: HashMap<String, PerceptionIntent>,
    candidates: HashMap<String, CandidateState>,
    targets: HashMap<String, TargetCache>,
    /// Map from subject (could be any thing with a name) → its name.
    /// Used to resolve member-subjects to their display names when
    /// rendering contents.
    names: HashMap<String, String>,
    /// Ops already rendered; prevents re-firing.
    rendered: HashSet<String>,
}

impl PerceptionEffector {
    /// Fresh effector.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn render_for(&self, target: &str) -> String {
        let cache = self.targets.get(target);
        let name = cache.and_then(|c| c.name.as_deref()).unwrap_or(target);
        let desc = cache.and_then(|c| c.description.as_deref());
        let contents: Vec<&str> = cache
            .map(|c| {
                let mut v: Vec<&str> = c
                    .contents
                    .iter()
                    .map(|s| self.names.get(s).map(String::as_str).unwrap_or(s.as_str()))
                    .collect();
                v.sort_unstable();
                v
            })
            .unwrap_or_default();

        let mut out = String::new();
        out.push_str(name);
        if let Some(d) = desc {
            out.push_str("\n\n");
            out.push_str(d);
        }
        if !contents.is_empty() {
            out.push_str("\n\nContents: ");
            out.push_str(&contents.join(", "));
        }
        out
    }

    fn maybe_render(&mut self, candidate: &str) -> Vec<Claim> {
        let Some(cs) = self.candidates.get(candidate) else {
            return Vec::new();
        };
        if !cs.selected {
            return Vec::new();
        }
        let Some(op) = &cs.op else {
            return Vec::new();
        };
        if self.rendered.contains(op) {
            return Vec::new();
        }
        let Some(intent) = self.ops.get(op) else {
            return Vec::new();
        };
        if !intent.ready() {
            return Vec::new();
        }

        let target = intent.target.as_ref().unwrap().clone();
        let session = intent.session.as_ref().unwrap().clone();
        let op = op.clone();

        let rendering = self.render_for(&target);
        self.rendered.insert(op.clone());

        vec![
            Claim::new(session, HAS_SESSION_RENDER, rendering.clone()),
            Claim::new(&op, HAS_RENDERING, rendering),
            Claim::new(&op, IS_RENDERED, &op),
            Claim::new(&op, IS_COMPLETED, &op),
            Claim::new(&op, PERFORMED_BY, IDENTITY),
        ]
    }
}

impl Projection for PerceptionEffector {
    fn identity(&self) -> &str {
        IDENTITY
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            HAS_FUNCTION.to_owned(),
            LOOKS_AT.to_owned(),
            REPORTS_TO.to_owned(),
            HAS_NAME.to_owned(),
            HAS_DESCRIPTION.to_owned(),
            CONTAINS.to_owned(),
            CONSIDERS_OP.to_owned(),
            IS_SELECTED.to_owned(),
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

        // Quality caching — for any subject that gets a name/description,
        // cache it. The name-map doubles as a lookup for contents
        // rendering.
        if predicate == HAS_NAME {
            self.names.insert(subject.to_owned(), object.to_owned());
            self.targets
                .entry(subject.to_owned())
                .or_default()
                .name = Some(object.to_owned());
            return Vec::new();
        }
        if predicate == HAS_DESCRIPTION {
            self.targets
                .entry(subject.to_owned())
                .or_default()
                .description = Some(object.to_owned());
            return Vec::new();
        }
        if predicate == CONTAINS {
            self.targets
                .entry(subject.to_owned())
                .or_default()
                .contents
                .insert(object.to_owned());
            return Vec::new();
        }

        // Op-intent accumulation.
        if predicate == HAS_FUNCTION {
            let entry = self.ops.entry(subject.to_owned()).or_default();
            if object == LOOK_FUNCTION {
                entry.is_look = true;
            }
        } else if predicate == LOOKS_AT {
            self.ops
                .entry(subject.to_owned())
                .or_default()
                .target = Some(object.to_owned());
        } else if predicate == REPORTS_TO {
            self.ops
                .entry(subject.to_owned())
                .or_default()
                .session = Some(object.to_owned());
        }
        // Candidate linkage.
        else if predicate == CONSIDERS_OP {
            self.candidates
                .entry(subject.to_owned())
                .or_default()
                .op = Some(object.to_owned());
        } else if predicate == IS_SELECTED {
            let entry = self.candidates.entry(subject.to_owned()).or_default();
            entry.selected = true;
            return self.maybe_render(subject);
        }

        // After accumulating intent, retry any selected candidate.
        let keys: Vec<String> = self.candidates.keys().cloned().collect();
        keys.into_iter()
            .flat_map(|c| self.maybe_render(&c))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::container::Container;
    use crate::dispatch::Dispatch;
    use crate::foundation::Foundation;
    use crate::ops::Ops;
    use crate::perception::Perception;
    use crate::testkit::TestHub;

    #[test]
    fn selected_look_op_renders_target_to_session() {
        let mut hub = TestHub::builder()
            .with_owner_agent(Foundation)
            .with_owner_agent(Container)
            .with_owner_agent(Ops)
            .with_owner_agent(Dispatch)
            .with_owner_agent(Perception)
            .with_projection(PerceptionEffector::new())
            .build();

        // Target: a room with name + description + one member.
        hub.witness_true("room-parlor", HAS_NAME, "Parlor");
        hub.witness_true(
            "room-parlor",
            HAS_DESCRIPTION,
            "A small parlor with a fireplace.",
        );
        hub.witness_true("rock-1", HAS_NAME, "rock");
        hub.witness_true("room-parlor", CONTAINS, "rock-1");

        // Look op: session-1 looks at room-parlor.
        hub.witness_true("look-op-1", HAS_FUNCTION, LOOK_FUNCTION);
        hub.witness_true("look-op-1", LOOKS_AT, "room-parlor");
        hub.witness_true("look-op-1", REPORTS_TO, "session-1");

        // Candidate + selection.
        hub.witness_true("cand-look-1", CONSIDERS_OP, "look-op-1");
        hub.witness_true("cand-look-1", IS_SELECTED, "mash-library-dispatch");

        // Session's render fiber should have the assembled text.
        let expected = "Parlor\n\nA small parlor with a fireplace.\n\nContents: rock";
        assert_eq!(
            hub.value("session-1", HAS_SESSION_RENDER, expected),
            Value::True,
        );
        assert_eq!(
            hub.value("look-op-1", IS_COMPLETED, "look-op-1"),
            Value::True,
        );
        assert_eq!(
            hub.value("look-op-1", PERFORMED_BY, IDENTITY),
            Value::True,
        );
    }

    #[test]
    fn unit_rendering_contains_name_and_description() {
        let port = PerceptionEffector {
            names: [("room-1".to_owned(), "Room One".to_owned())]
                .into_iter()
                .collect(),
            targets: [(
                "room-1".to_owned(),
                TargetCache {
                    name: Some("Room One".to_owned()),
                    description: Some("A plain room.".to_owned()),
                    contents: HashSet::new(),
                },
            )]
            .into_iter()
            .collect(),
            ..Default::default()
        };

        let rendered = port.render_for("room-1");
        assert!(rendered.starts_with("Room One"));
        assert!(rendered.contains("plain room"));
        assert!(
            !rendered.contains("Contents:"),
            "empty contents should not surface"
        );
    }

    #[test]
    fn unknown_target_falls_back_to_subject_string() {
        let port = PerceptionEffector::new();
        let rendered = port.render_for("mystery-subject");
        assert_eq!(rendered, "mystery-subject");
    }
}
