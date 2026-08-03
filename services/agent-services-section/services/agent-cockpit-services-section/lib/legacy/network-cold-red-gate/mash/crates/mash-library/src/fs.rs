//! Filesystem substrate — vocabulary for files, paths, ensembles,
//! authorization, and the retraction-pair counit.
//!
//! # Files are first-class subjects
//!
//! Each file's identity is a UUID: `file:<uuid>`. Identity is
//! decoupled from current filesystem path. The path is derived from
//! an **accounting fiber**: a file-move op is a balanced transaction
//! that debits the prior path, credits the new path, balances the
//! file, measured in [`COMMODITY_FILE_LOCATION`]. Same pattern as
//! character-location accounting for MUD movement.
//!
//! A file's current path = `latest-credits-of-balanced(file)`. No
//! `has-path` predicate needed.
//!
//! # Directories are files
//!
//! With `(file, has-content-kind, file-content-kind:directory)`.
//! Containment uses the shared [`crate::container::CONTAINS`] /
//! [`crate::container::EXCLUDES_FROM`] negation pair — no redeclared
//! inversion here.
//!
//! # The retraction pair
//!
//! A filesystem projector is a retraction:
//!
//! - **Sensor** — parses disk bytes into predicates. Witnesses
//!   [`HAS_OBSERVED_SHA256`], [`WAS_OBSERVED_AT`].
//! - **Effector** — materialises predicate intent to disk. Witnesses
//!   [`HAS_INTENDED_SHA256`], [`WAS_WRITTEN_AT`].
//!
//! Both specialize [`HAS_SHA256`] so generic consumers see a unified
//! fiber. The **counit** projection watches `Both`-valued cells at
//! [`HAS_SHA256`] and surfaces divergence via [`HAS_DIVERGENCE_AT`].
//!
//! # Authorization implication
//!
//! `REQUIRES_CAPABILITY ⇒ HAS_AUTHORIZATION_FOR → AUTHORIZATION_RESIDUAL`.
//!
//! Both sides of the implication live at `(op, _, capability)` so
//! the cascade fires pointwise. The residual cell is fail-closed: a
//! None residual is read as not-authorized.
//!
//! # Divergence from old-library
//!
//! The old `mash-vocab-fs` declared three INVERTS_AS pairs
//! (TARGETS_FILE/FILE_OF_OP, LOCATED_AT/CONTAINS,
//! PART_OF_ENSEMBLE/ENSEMBLE_HAS_OP). All three are converse-positive,
//! not algebraic-negation pairs. Dropped.
//!
//! LOCATED_AT is also dropped entirely — files-in-directories use the
//! shared [`crate::container::CONTAINS`] predicate at the directory's
//! subject, not a separate LOCATED_AT fiber.
//!
//! # Port implementations
//!
//! Vocabulary + two pure projections live here: [`FileEnsemblePort`]
//! aggregates ensemble completion, [`FileCounitPort`] observes
//! intent/observation divergence. The filesystem sensor (reads disk
//! state) and effector (writes disk state) are subprocess binaries
//! that live outside this module — they wrap the pure vocab +
//! projection logic with tokio I/O.

use std::collections::{HashMap, HashSet};

use async_trait::async_trait;
use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::accounting::{ACCOUNT, COMMODITY};
use crate::capability::REQUIRES_CAPABILITY;
use crate::foundation::{
    IMPLIES_INTO, IS_A_PREDICATE, IS_A_TERM, SPECIALIZES_AS, USES_AS_ANTECEDENT,
    USES_AS_CONSEQUENT,
};
use crate::lifecycle::{
    BOOKS_CLOSED_AT, IN_SHADOW, IN_SHADOW_BECAUSE, IS_CLOSED, IS_SETTLED, SHADOW_KIND_UNSETTLED,
};
use crate::ops::{IS_COMPLETED, IS_FAILED, OPERATION};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-fs";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A file. Subject form `file:<uuid>`.
pub const FILE: &str = "file";

/// A grouped multi-file atomic write. Subject form
/// `file-ensemble:<uuid>`. Settles via accounting balance + the
/// settlement shadow-kind lifecycle.
pub const FILE_ENSEMBLE: &str = "file-ensemble";

/// A filesystem path. Subject form `path:<abs-path>`. Paths are
/// **accounts** — they participate in balanced debits/credits for
/// file-move ops.
pub const PATH: &str = "path";

/// A file-move operation — debits one path, credits another.
/// Specializes [`OPERATION`].
pub const FILE_MOVE: &str = "file-move";

// ─────────────────────────────────────────────────────────────────────
// Content-kind classification
// ─────────────────────────────────────────────────────────────────────

/// A content-kind classification.
pub const FILE_CONTENT_KIND: &str = "file-content-kind";

/// File body is valid UTF-8 text.
pub const FILE_CONTENT_KIND_UTF8: &str = "file-content-kind:utf-8-text";

/// File body is opaque bytes.
pub const FILE_CONTENT_KIND_BINARY: &str = "file-content-kind:binary";

/// The file is a directory.
pub const FILE_CONTENT_KIND_DIRECTORY: &str = "file-content-kind:directory";

/// The file is a symlink (body is the target path).
pub const FILE_CONTENT_KIND_SYMLINK: &str = "file-content-kind:symlink";

// ─────────────────────────────────────────────────────────────────────
// Write-mode classification
// ─────────────────────────────────────────────────────────────────────

/// A write-mode classification — what the effector should do.
pub const FILE_MODE: &str = "file-mode";

/// Create a new file; fail if one exists at target.
pub const FILE_MODE_CREATE: &str = "file-mode:create";

/// Overwrite atomically (tmp + rename).
pub const FILE_MODE_OVERWRITE: &str = "file-mode:overwrite";

/// Append to end of file.
pub const FILE_MODE_APPEND: &str = "file-mode:append";

/// Unlink file; credits back to [`PATH_VOID`].
pub const FILE_MODE_DELETE: &str = "file-mode:delete";

/// Move file from current path to target. No content change.
pub const FILE_MODE_RENAME: &str = "file-mode:rename";

/// Create a directory at target path.
pub const FILE_MODE_MKDIR: &str = "file-mode:mkdir";

// ─────────────────────────────────────────────────────────────────────
// Commodity and placeless path
// ─────────────────────────────────────────────────────────────────────

/// Commodity for file-move accounting.
pub const COMMODITY_FILE_LOCATION: &str = "commodity:file-location";

/// The placeless path. A file's credits-balance before its first
/// create is `path:void`; deleting credits back to `path:void`.
/// "File exists on disk?" reduces to
/// `latest-credits-of-balanced(file) != path:void`.
pub const PATH_VOID: &str = "path:void";

// ─────────────────────────────────────────────────────────────────────
// Intent predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, targets-file, file)` — file this op operates on.
pub const TARGETS_FILE: &str = "targets-file";

/// `(op, writes-body, body-or-blob-ref)` — intended body. Inline
/// string for short payloads, `blob:sha256:<hex>` for large.
pub const WRITES_BODY: &str = "writes-body";

/// `(op, writes-mode, file-mode-term)` — write mode.
pub const WRITES_MODE: &str = "writes-mode";

// ─────────────────────────────────────────────────────────────────────
// File-state predicates
// ─────────────────────────────────────────────────────────────────────

/// `(file, has-content, body-or-blob-ref)` — current content.
pub const HAS_CONTENT: &str = "has-content";

/// `(file, has-sha256, hex)` — sha256 of current content. Consumers
/// who don't care about provenance subscribe here. The substrate
/// settles [`Both`] when intended and observed diverge — the counit
/// port watches for that.
pub const HAS_SHA256: &str = "has-sha256";

/// `(file, has-intended-sha256, hex)` — hash the effector intended
/// to write. Specializes [`HAS_SHA256`].
pub const HAS_INTENDED_SHA256: &str = "has-intended-sha256";

/// `(file, has-observed-sha256, hex)` — hash the sensor read off
/// disk. Specializes [`HAS_SHA256`].
pub const HAS_OBSERVED_SHA256: &str = "has-observed-sha256";

/// `(file, has-byte-length, decimal-string)` — byte length.
pub const HAS_BYTE_LENGTH: &str = "has-byte-length";

/// `(file, has-content-kind, content-kind-term)` — kind of file.
pub const HAS_CONTENT_KIND: &str = "has-content-kind";

/// `(file, was-written-at, iso)` — last effector write timestamp.
pub const WAS_WRITTEN_AT: &str = "was-written-at";

/// `(file, was-observed-at, iso)` — last sensor observation.
pub const WAS_OBSERVED_AT: &str = "was-observed-at";

// ─────────────────────────────────────────────────────────────────────
// Ensemble predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, part-of-ensemble, ensemble)` — op is part of a grouped
/// atomic write.
pub const PART_OF_ENSEMBLE: &str = "part-of-ensemble";

/// `(ensemble, expects-op-count, decimal-string)` — how many member
/// ops to expect. Asserted by the ensemble's author before any
/// members complete; the ensemble projection settles closure when
/// [`HAS_COMPLETED_OP`] count reaches this.
pub const EXPECTS_OP_COUNT: &str = "expects-op-count";

/// `(ensemble, has-completed-op, op)` — witness of a member op's
/// terminal phase.
pub const HAS_COMPLETED_OP: &str = "has-completed-op";

/// `(ensemble, ensemble-closed-at, iso)` — when the ensemble
/// settled.
pub const ENSEMBLE_CLOSED_AT: &str = "ensemble-closed-at";

// ─────────────────────────────────────────────────────────────────────
// Authorization predicates
// ─────────────────────────────────────────────────────────────────────

/// `(op, has-authorization-for, capability)` — rule-port recognition
/// that the op's cap-requirement is satisfied. Lives at
/// `(op, _, capability)` matching [`REQUIRES_CAPABILITY`] coordinates.
pub const HAS_AUTHORIZATION_FOR: &str = "has-authorization-for";

/// Residual of `REQUIRES_CAPABILITY ⇒ HAS_AUTHORIZATION_FOR`. Value
/// reveals whether the cap-gap is closed. Fail-closed: None ≡
/// not-authorized.
pub const AUTHORIZATION_RESIDUAL: &str = "authorization-residual";

// ─────────────────────────────────────────────────────────────────────
// Counit predicates
// ─────────────────────────────────────────────────────────────────────

/// `(file, has-divergence-at, iso)` — counit observed divergence
/// between effector intent and sensor observation.
pub const HAS_DIVERGENCE_AT: &str = "has-divergence-at";

/// `(file, diverged-because, reason)` — why divergence fired.
/// Conventional values: `"path-mismatch"`, `"content-hash-mismatch"`,
/// `"absent-when-expected"`.
pub const DIVERGED_BECAUSE: &str = "diverged-because";

// ─────────────────────────────────────────────────────────────────────
// Implication anchor
// ─────────────────────────────────────────────────────────────────────

const AUTH_TRIGGER: &str = "fs:auth-residual";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the filesystem vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Fs;

#[async_trait]
impl Agent for Fs {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    #[allow(clippy::too_many_lines)]
    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            FILE,
            FILE_ENSEMBLE,
            PATH,
            FILE_MOVE,
            FILE_CONTENT_KIND,
            FILE_CONTENT_KIND_UTF8,
            FILE_CONTENT_KIND_BINARY,
            FILE_CONTENT_KIND_DIRECTORY,
            FILE_CONTENT_KIND_SYMLINK,
            FILE_MODE,
            FILE_MODE_CREATE,
            FILE_MODE_OVERWRITE,
            FILE_MODE_APPEND,
            FILE_MODE_DELETE,
            FILE_MODE_RENAME,
            FILE_MODE_MKDIR,
            PATH_VOID,
            COMMODITY_FILE_LOCATION,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        for p in [
            TARGETS_FILE,
            WRITES_BODY,
            WRITES_MODE,
            HAS_CONTENT,
            HAS_SHA256,
            HAS_INTENDED_SHA256,
            HAS_OBSERVED_SHA256,
            HAS_BYTE_LENGTH,
            HAS_CONTENT_KIND,
            WAS_WRITTEN_AT,
            WAS_OBSERVED_AT,
            PART_OF_ENSEMBLE,
            EXPECTS_OP_COUNT,
            HAS_COMPLETED_OP,
            ENSEMBLE_CLOSED_AT,
            HAS_AUTHORIZATION_FOR,
            AUTHORIZATION_RESIDUAL,
            HAS_DIVERGENCE_AT,
            DIVERGED_BECAUSE,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        // Content-kind and write-mode specializations.
        for kind in [
            FILE_CONTENT_KIND_UTF8,
            FILE_CONTENT_KIND_BINARY,
            FILE_CONTENT_KIND_DIRECTORY,
            FILE_CONTENT_KIND_SYMLINK,
        ] {
            out.push(Claim::new(kind, SPECIALIZES_AS, FILE_CONTENT_KIND));
        }
        for mode in [
            FILE_MODE_CREATE,
            FILE_MODE_OVERWRITE,
            FILE_MODE_APPEND,
            FILE_MODE_DELETE,
            FILE_MODE_RENAME,
            FILE_MODE_MKDIR,
        ] {
            out.push(Claim::new(mode, SPECIALIZES_AS, FILE_MODE));
        }

        // Cross-module specializations.
        out.push(Claim::new(FILE_MOVE, SPECIALIZES_AS, OPERATION));
        out.push(Claim::new(PATH, SPECIALIZES_AS, ACCOUNT));
        out.push(Claim::new(COMMODITY_FILE_LOCATION, SPECIALIZES_AS, COMMODITY));
        out.push(Claim::new(PATH_VOID, SPECIALIZES_AS, PATH));

        // Provenance-split sha256 lifts to unified has-sha256.
        out.push(Claim::new(HAS_INTENDED_SHA256, SPECIALIZES_AS, HAS_SHA256));
        out.push(Claim::new(HAS_OBSERVED_SHA256, SPECIALIZES_AS, HAS_SHA256));

        // Authorization implication at (op, _, capability).
        out.push(Claim::new(AUTH_TRIGGER, USES_AS_ANTECEDENT, REQUIRES_CAPABILITY));
        out.push(Claim::new(AUTH_TRIGGER, USES_AS_CONSEQUENT, HAS_AUTHORIZATION_FOR));
        out.push(Claim::new(AUTH_TRIGGER, IMPLIES_INTO, AUTHORIZATION_RESIDUAL));

        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// FileEnsemblePort — closes the books on a file-ensemble
// ─────────────────────────────────────────────────────────────────────

/// Per-ensemble bookkeeping.
#[derive(Debug, Default, Clone)]
struct EnsembleState {
    expected: Option<usize>,
    completed: HashSet<String>,
    first_failure: Option<String>,
    /// Whether terminal settlement (success or shadow) has been
    /// emitted — prevents duplicate closure messages.
    closed: bool,
}

/// File-ensemble aggregator projection.
///
/// Watches `PART_OF_ENSEMBLE` + `EXPECTS_OP_COUNT` + `IS_COMPLETED` +
/// `IS_FAILED`; emits `HAS_COMPLETED_OP` per terminal transition and
/// the closure chain once all members settle.
///
/// Semantics (v1 `any-fail`): first observed failure shadows the
/// ensemble immediately (emits `IN_SHADOW` + `IN_SHADOW_BECAUSE`).
/// Success emission requires the expected-op count declared and met
/// (`IS_SETTLED` + `IS_CLOSED` + `BOOKS_CLOSED_AT`).
pub struct FileEnsemblePort {
    op_ensemble: HashMap<String, String>,
    ensembles: HashMap<String, EnsembleState>,
    reported_ops: HashSet<String>,
    now_iso: fn() -> String,
}

impl Default for FileEnsemblePort {
    fn default() -> Self {
        Self::new()
    }
}

fn default_now_iso() -> String {
    "1970-01-01T00:00:00Z".to_owned()
}

impl FileEnsemblePort {
    /// Fresh state with the default clock.
    #[must_use]
    pub fn new() -> Self {
        Self {
            op_ensemble: HashMap::new(),
            ensembles: HashMap::new(),
            reported_ops: HashSet::new(),
            now_iso: default_now_iso,
        }
    }

    /// Fresh state with a custom clock (deterministic tests).
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }

    fn record_terminal(
        &mut self,
        op: &str,
        failed: bool,
        out: &mut Vec<Claim>,
    ) {
        let Some(ensemble) = self.op_ensemble.get(op).cloned() else {
            return;
        };
        if self.reported_ops.insert(op.to_owned()) {
            out.push(Claim::new(&ensemble, HAS_COMPLETED_OP, op));
        }
        let entry = self.ensembles.entry(ensemble.clone()).or_default();
        if failed {
            if entry.first_failure.is_none() {
                entry.first_failure = Some(op.to_owned());
            }
        } else {
            entry.completed.insert(op.to_owned());
        }
        self.try_close(&ensemble, out);
    }

    fn try_close(&mut self, ensemble: &str, out: &mut Vec<Claim>) {
        let entry = self.ensembles.entry(ensemble.to_owned()).or_default();
        if entry.closed {
            return;
        }
        if let Some(ref first) = entry.first_failure {
            let first = first.clone();
            entry.closed = true;
            out.push(Claim::new(ensemble, IN_SHADOW, SHADOW_KIND_UNSETTLED));
            out.push(Claim::new(ensemble, IN_SHADOW_BECAUSE, &first));
            return;
        }
        let Some(expected) = entry.expected else {
            return;
        };
        if entry.completed.len() < expected {
            return;
        }
        entry.closed = true;
        let now = (self.now_iso)();
        out.push(Claim::new(ensemble, IS_SETTLED, &now));
        out.push(Claim::new(ensemble, IS_CLOSED, &now));
        out.push(Claim::new(ensemble, BOOKS_CLOSED_AT, &now));
    }
}

impl Projection for FileEnsemblePort {
    fn identity(&self) -> &str {
        "mash-library-file-ensemble"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            PART_OF_ENSEMBLE.to_owned(),
            EXPECTS_OP_COUNT.to_owned(),
            IS_COMPLETED.to_owned(),
            IS_FAILED.to_owned(),
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
        let mut out = Vec::new();
        if predicate == PART_OF_ENSEMBLE {
            self.op_ensemble
                .insert(subject.to_owned(), object.to_owned());
            self.ensembles.entry(object.to_owned()).or_default();
            self.try_close(object, &mut out);
        } else if predicate == EXPECTS_OP_COUNT {
            if let Ok(n) = object.parse::<usize>() {
                let entry = self.ensembles.entry(subject.to_owned()).or_default();
                entry.expected = Some(n);
                self.try_close(subject, &mut out);
            }
        } else if predicate == IS_COMPLETED {
            self.record_terminal(subject, false, &mut out);
        } else if predicate == IS_FAILED {
            self.record_terminal(subject, true, &mut out);
        }
        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// FileCounitPort — surfaces intent/observation divergence
// ─────────────────────────────────────────────────────────────────────

/// Counit projection for the sensor/effector retraction pair.
///
/// Watches `HAS_INTENDED_SHA256` + `HAS_OBSERVED_SHA256` per file
/// subject; when both have settled and disagree, emits
/// `HAS_DIVERGENCE_AT <iso>` + `DIVERGED_BECAUSE "content-hash-mismatch"`.
///
/// First-wins per file: once divergence has been witnessed, the port
/// stays silent on subsequent updates to avoid cell churn.
pub struct FileCounitPort {
    intended: HashMap<String, String>,
    observed: HashMap<String, String>,
    diverged: HashSet<String>,
    now_iso: fn() -> String,
}

impl Default for FileCounitPort {
    fn default() -> Self {
        Self::new()
    }
}

impl FileCounitPort {
    /// Fresh state with the default clock.
    #[must_use]
    pub fn new() -> Self {
        Self {
            intended: HashMap::new(),
            observed: HashMap::new(),
            diverged: HashSet::new(),
            now_iso: default_now_iso,
        }
    }

    /// Fresh state with a custom clock (deterministic tests).
    #[must_use]
    pub fn with_clock(mut self, now_iso: fn() -> String) -> Self {
        self.now_iso = now_iso;
        self
    }

    fn check(&mut self, file: &str) -> Vec<Claim> {
        if self.diverged.contains(file) {
            return Vec::new();
        }
        let (Some(i), Some(o)) = (self.intended.get(file), self.observed.get(file)) else {
            return Vec::new();
        };
        if i == o {
            return Vec::new();
        }
        self.diverged.insert(file.to_owned());
        let now = (self.now_iso)();
        vec![
            Claim::new(file, HAS_DIVERGENCE_AT, &now),
            Claim::new(file, DIVERGED_BECAUSE, "content-hash-mismatch"),
        ]
    }
}

impl Projection for FileCounitPort {
    fn identity(&self) -> &str {
        "mash-library-file-counit"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![
            HAS_INTENDED_SHA256.to_owned(),
            HAS_OBSERVED_SHA256.to_owned(),
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
        if predicate == HAS_INTENDED_SHA256 {
            self.intended
                .insert(subject.to_owned(), object.to_owned());
            self.check(subject)
        } else if predicate == HAS_OBSERVED_SHA256 {
            self.observed
                .insert(subject.to_owned(), object.to_owned());
            self.check(subject)
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::INVERTS_AS;

    fn has_claim(claims: &[Claim], s: &str, p: &str, o: &str) -> bool {
        claims.iter().any(|c| c.subject == s && c.predicate == p && c.object == o)
    }

    #[test]
    fn core_terms_declared() {
        let claims = Fs.claims();
        for t in [FILE, FILE_ENSEMBLE, PATH, FILE_MOVE, PATH_VOID] {
            assert!(
                claims.iter().any(|c| c.subject == t && c.predicate == IS_A_TERM),
                "missing term: {t}"
            );
        }
    }

    #[test]
    fn file_move_specializes_operation() {
        assert!(has_claim(&Fs.claims(), FILE_MOVE, SPECIALIZES_AS, OPERATION));
    }

    #[test]
    fn path_is_an_account() {
        assert!(has_claim(&Fs.claims(), PATH, SPECIALIZES_AS, ACCOUNT));
    }

    #[test]
    fn commodity_file_location_lifts_to_commodity() {
        assert!(has_claim(
            &Fs.claims(),
            COMMODITY_FILE_LOCATION,
            SPECIALIZES_AS,
            COMMODITY,
        ));
    }

    #[test]
    fn authorization_implication_wired() {
        let claims = Fs.claims();
        assert!(has_claim(
            &claims,
            AUTH_TRIGGER,
            USES_AS_ANTECEDENT,
            REQUIRES_CAPABILITY,
        ));
        assert!(has_claim(
            &claims,
            AUTH_TRIGGER,
            USES_AS_CONSEQUENT,
            HAS_AUTHORIZATION_FOR,
        ));
        assert!(has_claim(
            &claims,
            AUTH_TRIGGER,
            IMPLIES_INTO,
            AUTHORIZATION_RESIDUAL,
        ));
    }

    #[test]
    fn content_kinds_specialize() {
        let claims = Fs.claims();
        for kind in [
            FILE_CONTENT_KIND_UTF8,
            FILE_CONTENT_KIND_BINARY,
            FILE_CONTENT_KIND_DIRECTORY,
            FILE_CONTENT_KIND_SYMLINK,
        ] {
            assert!(has_claim(&claims, kind, SPECIALIZES_AS, FILE_CONTENT_KIND));
        }
    }

    #[test]
    fn file_modes_specialize() {
        let claims = Fs.claims();
        for mode in [
            FILE_MODE_CREATE,
            FILE_MODE_OVERWRITE,
            FILE_MODE_APPEND,
            FILE_MODE_DELETE,
            FILE_MODE_RENAME,
            FILE_MODE_MKDIR,
        ] {
            assert!(has_claim(&claims, mode, SPECIALIZES_AS, FILE_MODE));
        }
    }

    #[test]
    fn provenance_split_lifts_to_has_sha256() {
        let claims = Fs.claims();
        assert!(has_claim(
            &claims,
            HAS_INTENDED_SHA256,
            SPECIALIZES_AS,
            HAS_SHA256,
        ));
        assert!(has_claim(
            &claims,
            HAS_OBSERVED_SHA256,
            SPECIALIZES_AS,
            HAS_SHA256,
        ));
    }

    #[test]
    fn no_spurious_inversions() {
        // Old fs vocab declared TARGETS_FILE/FILE_OF_OP,
        // LOCATED_AT/CONTAINS, PART_OF_ENSEMBLE/ENSEMBLE_HAS_OP —
        // all converse-positive, not algebraic-negation. Dropped.
        let claims = Fs.claims();
        assert!(
            !claims.iter().any(|c| c.predicate == INVERTS_AS),
            "fs module should declare no INVERTS_AS wiring"
        );
    }

    // ─── FileEnsemblePort ────────────────────────────────────────

    fn fixed_now() -> String {
        "2026-04-21T00:00:00Z".to_owned()
    }

    #[test]
    fn ensemble_settles_after_all_members_complete() {
        let mut port = FileEnsemblePort::new().with_clock(fixed_now);
        let _ = port.ingest("op:a", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        let _ = port.ingest("op:b", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        let _ = port.ingest("ensemble:1", EXPECTS_OP_COUNT, "2", Value::True);
        let _ = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        let out = port.ingest("op:b", IS_COMPLETED, "op:b", Value::True);
        assert!(out.iter().any(|c| c.predicate == HAS_COMPLETED_OP));
        assert!(out.iter().any(|c| c.predicate == IS_SETTLED));
        assert!(out.iter().any(|c| c.predicate == IS_CLOSED));
        assert!(out.iter().any(|c| c.predicate == BOOKS_CLOSED_AT));
    }

    #[test]
    fn ensemble_first_failure_shadows_immediately() {
        let mut port = FileEnsemblePort::new().with_clock(fixed_now);
        let _ = port.ingest("op:a", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        let _ = port.ingest("op:b", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        let _ = port.ingest("ensemble:1", EXPECTS_OP_COUNT, "2", Value::True);
        let _ = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        let out = port.ingest("op:b", IS_FAILED, "op:b", Value::True);
        assert!(out.iter().any(|c| c.predicate == IN_SHADOW
            && c.object == SHADOW_KIND_UNSETTLED));
        assert!(out.iter().any(|c| c.predicate == IN_SHADOW_BECAUSE
            && c.object == "op:b"));
    }

    #[test]
    fn ensemble_waits_for_expected_count() {
        let mut port = FileEnsemblePort::new().with_clock(fixed_now);
        let _ = port.ingest("op:a", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        let _ = port.ingest("op:b", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        // No EXPECTS_OP_COUNT — no closure even if both complete.
        let _ = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        let out = port.ingest("op:b", IS_COMPLETED, "op:b", Value::True);
        assert!(!out.iter().any(|c| c.predicate == IS_SETTLED));
    }

    #[test]
    fn ensemble_closure_fires_once() {
        let mut port = FileEnsemblePort::new().with_clock(fixed_now);
        let _ = port.ingest("op:a", PART_OF_ENSEMBLE, "ensemble:1", Value::True);
        let _ = port.ingest("ensemble:1", EXPECTS_OP_COUNT, "1", Value::True);
        let first = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        assert!(first.iter().any(|c| c.predicate == IS_SETTLED));
        // Re-witnessing the terminal cell: no re-closure.
        let again = port.ingest("op:a", IS_COMPLETED, "op:a", Value::True);
        assert!(!again.iter().any(|c| c.predicate == IS_SETTLED));
    }

    // ─── FileCounitPort ──────────────────────────────────────────

    #[test]
    fn counit_stays_silent_when_hashes_match() {
        let mut port = FileCounitPort::new().with_clock(fixed_now);
        let _ = port.ingest("file:f", HAS_INTENDED_SHA256, "abc123", Value::True);
        let out = port.ingest("file:f", HAS_OBSERVED_SHA256, "abc123", Value::True);
        assert!(out.is_empty());
    }

    #[test]
    fn counit_emits_divergence_when_hashes_differ() {
        let mut port = FileCounitPort::new().with_clock(fixed_now);
        let _ = port.ingest("file:f", HAS_INTENDED_SHA256, "abc123", Value::True);
        let out = port.ingest("file:f", HAS_OBSERVED_SHA256, "def456", Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_DIVERGENCE_AT && c.subject == "file:f"));
        assert!(out.iter().any(|c| c.predicate == DIVERGED_BECAUSE
            && c.object == "content-hash-mismatch"));
    }

    #[test]
    fn counit_fires_once_per_file() {
        let mut port = FileCounitPort::new().with_clock(fixed_now);
        let _ = port.ingest("file:f", HAS_INTENDED_SHA256, "a", Value::True);
        let first = port.ingest("file:f", HAS_OBSERVED_SHA256, "b", Value::True);
        assert!(first.iter().any(|c| c.predicate == HAS_DIVERGENCE_AT));
        // New intended / new observed: already-diverged, stays silent.
        let _ = port.ingest("file:f", HAS_INTENDED_SHA256, "c", Value::True);
        let again = port.ingest("file:f", HAS_OBSERVED_SHA256, "d", Value::True);
        assert!(!again.iter().any(|c| c.predicate == HAS_DIVERGENCE_AT));
    }

    #[test]
    fn counit_waits_for_both_hashes() {
        let mut port = FileCounitPort::new().with_clock(fixed_now);
        // Only intended; no observed yet.
        let out = port.ingest("file:f", HAS_INTENDED_SHA256, "a", Value::True);
        assert!(out.is_empty());
    }
}
