//! Planning — goals, plans, tasks, runs.
//!
//! Four concentric layers between "what we want" and "what actually
//! ran":
//!
//! - [`goal`] — desired outcomes with required capabilities;
//!   decomposable into candidate sub-tasks by a planning port.
//! - [`plan`] — named collection of tasks that together constitute a
//!   higher-level unit of work; completes when every task completes.
//! - [`task`] — unit of declared work with full lifecycle
//!   (closed → routable → clear → ready → completed), dependency /
//!   approval gating compositions, and the task↔op bridge.
//! - [`run`] — logical work-item representing one attempt-chain for
//!   a task; each op the run spawns is one execution attempt.
//!   Multi-attempt logic (retry, backoff, deadline-cancellation)
//!   lives here so ops stay simple and immutable.
//!
//! # Why separate
//!
//! A **goal** is the objective ("deploy release 3.2"). A **plan**
//! groups tasks that implement it. A **task** is a unit of declared
//! work. A **run** is the logical retry-scope for a single task.
//! An **op** is one actual execution attempt.
//!
//! The run layer lets retry / deadline / attempt-counting live
//! between task and op without mutating either — each retry mints a
//! new op, the run accumulates attempts, and the task sees the run's
//! terminal outcome. Individuation not mutation.

pub mod goal;
pub mod plan;
pub mod run;
pub mod task;
