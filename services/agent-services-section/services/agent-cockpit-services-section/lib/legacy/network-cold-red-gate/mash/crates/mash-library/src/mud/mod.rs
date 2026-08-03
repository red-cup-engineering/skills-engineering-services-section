//! MUD — the talker/MUD reference application atop the library.
//!
//! This module aggregates the MUD-specific vocabularies: session
//! extensions (character / account / authentication / states), verbs
//! (the shipping command roster + roles + capabilities). Each
//! sub-module has its own owner-agent and its own namespaced subject
//! prefix to prevent collisions across federated instances.
//!
//! # Sub-modules
//!
//! - [`session`] — character / account / FSM-state vocabulary atop
//!   [`crate::presence::SESSION`].
//! - [`verbs`] — shipping command roster: look / go / quit / help /
//!   who / say / register / login, with anonymouse / registered roles
//!   and their capability grants.
//!
//! # What's intentionally not here yet
//!
//! Timeline / lore / beastiary / extras vocabularies from
//! `mash-old-library/archive/` are content-heavy direction layers
//! that aren't on the substrate's critical path. They'll be ported
//! as a later pass once the verb + session vocabulary is exercised
//! by downstream projections (T45–T48).

pub mod ambient;
pub mod go_agent;
pub mod handlers;
pub mod identity;
pub mod parser;
pub mod session;
pub mod verbs;
pub mod welcome;
