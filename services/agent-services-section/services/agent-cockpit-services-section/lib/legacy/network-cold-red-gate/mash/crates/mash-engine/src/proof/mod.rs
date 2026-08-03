//! The MASH substrate: an append-only store of bilattice-valued
//! subject-predicate-object claims, closed under five morphisms.
//!
//! # Operational semantics
//!
//! The substrate holds claims keyed by `(subject, predicate, object)`
//! triples of interned [`TermId`]s. Each claim carries a [`Value`] in
//! the Belnap 2⊗2 bilattice. Asserting a claim applies
//! [`knowledge_join`] against the existing value — so the store
//! behaves as a CRDT under concurrent writers.
//!
//! After a successful assertion, the cascade runs: every morphism that
//! watches the claim's predicate fires, producing derived claims that
//! are asserted recursively. The paper proves all orbits reach a fixed
//! point in at most two steps.
//!
//! # The five morphisms
//!
//! | kind              | arity | derivation                                               |
//! |-------------------|-------|----------------------------------------------------------|
//! | Specialization    | 1→1   | `target(s,o) := source(s,o)`                             |
//! | Inversion         | 1→1   | `target(o,s) := ∼ source(s,o)`                           |
//! | Composition       | 2→1   | `target(s,o) := source(s,o) ∧ₖ aux(s,o)`                 |
//! | Fusion            | 2→1   | `target(s,o) := source(s,o) ⊙ aux(s,o)`                  |
//! | Implication       | 2→1   | `target(s,o) := source(s,o) ⇒ aux(s,o)` (asymmetric)     |
//!
//! Composition, fusion, and implication take an auxiliary predicate;
//! specialization and inversion do not.
//!
//! # Thread safety
//!
//! [`Semiotics`] is `!Sync` by design. The kernel runs cascade on a
//! single writer task; readers are served from snapshots or through
//! the socket.

#![warn(missing_docs)]

use crate::algebra::{fuse, knowledge_join, knowledge_meet, negate, restrict, Value};
use crate::inference::MorphismKind;
use std::collections::{BTreeSet, HashMap, HashSet};

mod interner;
pub use interner::Interner;

/// Interned term identifier — unique per [`Semiotics`].
pub type TermId = u64;

/// A claim in its interned runtime form: subject / predicate / object
/// are [`TermId`]s obtained by interning strings through a
/// [`Semiotics`]. The wire-level counterpart with string fields is
/// [`crate::inference::wire::WireClaim`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Claim {
    /// Subject term.
    pub subject: TermId,
    /// Predicate term.
    pub predicate: TermId,
    /// Object term — the witness.
    pub object: TermId,
    /// Bilattice value.
    pub value: Value,
}

/// The MASH semiotics: an append-only store of bilattice-valued SPO
/// claims, closed under the five predication morphisms. Asserting a
/// claim runs the cascade to quiescence; trigger-predicate claims
/// install morphism instances on the fly.
#[derive(Debug, Default)]
pub struct Semiotics {
    interner: Interner,
    claims: HashMap<(TermId, TermId, TermId), Value>,
    fibers: HashMap<TermId, HashSet<(TermId, TermId)>>,
    morphisms: Vec<Morphism>,
    /// For each predicate, the morphism indices that read that predicate
    /// (as source or auxiliary). Used to drive the cascade.
    watchers: HashMap<TermId, Vec<usize>>,
    /// Partially-assembled `Pair` declarations — composition / fusion /
    /// implication — keyed by `(kind, declarer-subject)`. A pair
    /// materializes into a [`Morphism`] the moment all three role
    /// claims have arrived for the same declarer subject.
    partial_pairs: HashMap<(MorphismKind, TermId), PartialPair>,
}

#[derive(Debug)]
struct Morphism {
    kind: MorphismKind,
    source: TermId,
    target: TermId,
    auxiliary: Option<TermId>,
}

#[derive(Debug, Default)]
struct PartialPair {
    left: Option<TermId>,
    right: Option<TermId>,
    target: Option<TermId>,
}

/// The fixed trigger-predicate vocabulary.
///
/// Asserting a claim whose predicate matches one of these eleven
/// names installs an *instance* of the corresponding hardcoded Rust
/// morphism. Morphism *kinds* are not user-extensible — the algebra
/// has five primitives, proved exhaustive; the ingestor recognizes
/// them by name and dispatches to a fixed Rust function.
///
/// Two shapes:
/// - **`OneClaim`** — the claim itself carries source (subject) and
///   target (object): `(source, specialization, target)` or
///   `(source, inversion, target)`.
/// - **Pair** — three co-subjected claims assemble a declaration:
///   `(id, composition-left,  P)`,
///   `(id, composition-right, Q)`,
///   `(id, composition-target, T)` — and analogously for fusion
///   (`-left/-right/-target`) and implication
///   (`-antecedent/-consequent/-target`).
///
/// The table is const and private — this is Rust business.
const TRIGGERS: &[(&str, Trigger)] = &[
    (
        "specializes-as",
        Trigger::OneClaim(MorphismKind::Specialization),
    ),
    ("inverts-as", Trigger::OneClaim(MorphismKind::Inversion)),
    (
        "uses-as-composition-left",
        Trigger::PairRole(MorphismKind::Composition, PairRole::Left),
    ),
    (
        "uses-as-composition-right",
        Trigger::PairRole(MorphismKind::Composition, PairRole::Right),
    ),
    (
        "composes-into",
        Trigger::PairRole(MorphismKind::Composition, PairRole::Target),
    ),
    (
        "uses-as-fusion-left",
        Trigger::PairRole(MorphismKind::Fusion, PairRole::Left),
    ),
    (
        "uses-as-fusion-right",
        Trigger::PairRole(MorphismKind::Fusion, PairRole::Right),
    ),
    (
        "fuses-into",
        Trigger::PairRole(MorphismKind::Fusion, PairRole::Target),
    ),
    (
        "uses-as-antecedent",
        Trigger::PairRole(MorphismKind::Implication, PairRole::Left),
    ),
    (
        "uses-as-consequent",
        Trigger::PairRole(MorphismKind::Implication, PairRole::Right),
    ),
    (
        "implies-into",
        Trigger::PairRole(MorphismKind::Implication, PairRole::Target),
    ),
];

#[derive(Debug, Clone, Copy)]
enum Trigger {
    OneClaim(MorphismKind),
    PairRole(MorphismKind, PairRole),
}

#[derive(Debug, Clone, Copy)]
enum PairRole {
    Left,
    Right,
    Target,
}

fn trigger_for(name: &str) -> Option<Trigger> {
    TRIGGERS
        .iter()
        .find_map(|(n, t)| if *n == name { Some(*t) } else { None })
}

/// The result of a cascade: every claim whose value changed, in the
/// order the cascade settled them.
#[derive(Debug, Default)]
pub struct SemiosisTrace {
    /// Settled claims, in cascade order.
    pub settled: Vec<ResolvedClaim>,
}

/// A claim that settled, paired with the morphism steps that produced it.
#[derive(Debug, Clone)]
pub struct ResolvedClaim {
    /// The claim at its final value.
    pub claim: Claim,
    /// The morphisms applied to produce this claim. Empty for directly
    /// asserted claims.
    pub derivation: Vec<DerivationStep>,
}

/// One step of a derivation chain.
#[derive(Debug, Clone)]
pub struct DerivationStep {
    /// Which morphism was applied.
    pub via: MorphismKind,
    /// The claims whose values were combined to produce the consequent.
    pub premises: Vec<Claim>,
}

/// A claim travelling through the cascade wavefront, with the
/// derivation chain that produced it and the morphism indices it has
/// already been derived through. The ancestry set caps each morphism
/// instance to firing at most once per wave, bounding cascade depth
/// independent of fiber topology.
struct WaveItem {
    claim: Claim,
    derivation: Vec<DerivationStep>,
    ancestry: BTreeSet<usize>,
}

impl Semiotics {
    /// Create an empty substrate — no terms, no cells, no morphisms.
    ///
    /// Most callers never do this directly. The hub constructs a
    /// `Semiotics` at boot, mounts owner-agent claims into it,
    /// replays the event log, and runs it for the life of the
    /// process. Tests and research scenarios use this constructor
    /// plus [`assert`](Self::assert) to drive the cascade in-process.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Intern a term, returning a stable [`TermId`] for the lifetime
    /// of this `Semiotics`. Identical strings intern to identical
    /// ids; this is how the substrate represents triples as three
    /// `u64`s at rest.
    ///
    /// Called freely by the cascade itself; agent code more often
    /// reaches for [`read_object`](Self::read_object) /
    /// [`read_subject`](Self::read_subject), which take `&str` and
    /// intern on the way in.
    pub fn intern(&mut self, s: &str) -> TermId {
        self.interner.intern(s)
    }

    /// Recover the original string for an interned [`TermId`].
    /// Returns `None` if the id was never minted by this
    /// `Semiotics` (cross-process ids are not portable).
    #[must_use]
    pub fn term(&self, id: TermId) -> Option<&str> {
        self.interner.name(id)
    }

    /// Borrow the interner — usually only needed for bulk interning
    /// during snapshot serialization or for tools that walk the
    /// full term table.
    #[must_use]
    pub fn interner(&self) -> &Interner {
        &self.interner
    }

    /// The current value of the `(subject, predicate, object)` cell.
    ///
    /// Returns [`Value::None`] for unasserted triples — the
    /// substrate is a sparse map and reserves no memory for the
    /// (infinite) set of triples that have never been witnessed.
    #[must_use]
    pub fn value(&self, subject: TermId, predicate: TermId, object: TermId) -> Value {
        self.claims
            .get(&(subject, predicate, object))
            .copied()
            .unwrap_or(Value::None)
    }

    /// Iterate over the fiber of `predicate` — every
    /// `(subject, object, value)` currently held on that predicate.
    ///
    /// The fiber is unordered; do not assume stability between
    /// iterations. Projections that need ordering should collect and
    /// sort. The iterator borrows `&self`, so cells cannot mutate
    /// while it is live.
    pub fn fiber(&self, predicate: TermId) -> impl Iterator<Item = (TermId, TermId, Value)> + '_ {
        self.fibers
            .get(&predicate)
            .into_iter()
            .flat_map(move |set| set.iter().copied())
            .map(move |(s, o)| (s, o, self.value(s, predicate, o)))
    }

    /// Read the object of the first [`Value::True`] cell at
    /// `(subject, predicate, ?)`, resolved through the interner on
    /// both input and output. Returns `None` if either term is
    /// unknown or no `True` witness exists. The common "substrate
    /// holds a functional fact" lookup.
    #[must_use]
    pub fn read_object(&self, subject: &str, predicate: &str) -> Option<String> {
        let s = self.interner.get(subject)?;
        let p = self.interner.get(predicate)?;
        for (fiber_subject, fiber_object, value) in self.fiber(p) {
            if fiber_subject == s && value == Value::True {
                return self.term(fiber_object).map(str::to_owned);
            }
        }
        None
    }

    /// Read the subject of the first [`Value::True`] cell at
    /// `(?, predicate, object)` — the mirror of [`Self::read_object`]
    /// for reverse lookup. Useful when a relation is declared in
    /// forward form (`puppets` / `has-exit`) and the caller needs to
    /// walk it backward *without* relying on the `inverts-as`
    /// morphism (which negates the value — correct for genuine dual
    /// predicates, wrong for converse lookup).
    #[must_use]
    pub fn read_subject(&self, predicate: &str, object: &str) -> Option<String> {
        let p = self.interner.get(predicate)?;
        let o = self.interner.get(object)?;
        for (fiber_subject, fiber_object, value) in self.fiber(p) {
            if fiber_object == o && value == Value::True {
                return self.term(fiber_subject).map(str::to_owned);
            }
        }
        None
    }

    /// Assert a claim. Runs the cascade to quiescence and returns every
    /// claim whose value changed.
    ///
    /// If the claim's predicate is one of the eleven trigger names
    /// (see the crate-level `TRIGGERS` table), it also installs a
    /// morphism instance (for
    /// `specialization` / `inversion`) or fills in a pair role (for
    /// `composition-*` / `fusion-*` / `implication-*`); newly
    /// installed morphisms replay across the existing source (and
    /// auxiliary) fibers so declarations can arrive in either order
    /// relative to their source cells.
    ///
    /// The cascade carries an ancestry set (morphism indices already
    /// traversed by this wave) so each morphism instance fires at most
    /// once per wave, bounding cascade depth independent of fiber
    /// topology.
    pub fn assert(&mut self, claim: Claim) -> SemiosisTrace {
        let mut report = SemiosisTrace::default();
        let mut work: Vec<WaveItem> = vec![WaveItem {
            claim,
            derivation: Vec::new(),
            ancestry: BTreeSet::new(),
        }];
        while let Some(item) = work.pop() {
            let Some(settled) = self.apply_one(item.claim) else {
                continue;
            };
            let mut derived = self.propagate(settled, &item.derivation, &item.ancestry);
            if let Some(idx) = self.try_install_from_trigger(settled) {
                derived.extend(self.replay_through(idx, &item.derivation, &item.ancestry));
            }
            report.settled.push(ResolvedClaim {
                claim: settled,
                derivation: item.derivation,
            });
            work.extend(derived);
        }
        report
    }

    /// If `settled`'s predicate is a trigger, either install a
    /// `OneClaim` morphism immediately or fill a `Pair` role; return
    /// the newly-registered morphism's index so the caller can replay
    /// existing cells through it.
    ///
    /// Only `Value::True` triggers install; `False` / `Both` on a
    /// trigger predicate is ignored (the morphism is either declared
    /// or it isn't — you don't "unknow" a declaration by disputing it).
    fn try_install_from_trigger(&mut self, settled: Claim) -> Option<usize> {
        if settled.value != Value::True {
            return None;
        }
        let pred_name = self.interner.name(settled.predicate)?.to_owned();
        match trigger_for(&pred_name)? {
            Trigger::OneClaim(kind) => self.install_one_claim(kind, settled),
            Trigger::PairRole(kind, role) => self.install_pair_role(kind, role, settled),
        }
    }

    fn install_one_claim(&mut self, kind: MorphismKind, c: Claim) -> Option<usize> {
        let source = c.subject;
        let target = c.object;
        if self.morphisms.iter().any(|m| {
            m.kind == kind && m.source == source && m.target == target && m.auxiliary.is_none()
        }) {
            return None;
        }
        let idx = self.morphisms.len();
        self.morphisms.push(Morphism {
            kind,
            source,
            target,
            auxiliary: None,
        });
        self.watchers.entry(source).or_default().push(idx);
        Some(idx)
    }

    fn install_pair_role(&mut self, kind: MorphismKind, role: PairRole, c: Claim) -> Option<usize> {
        let declarer = c.subject;
        let partial = self.partial_pairs.entry((kind, declarer)).or_default();
        match role {
            PairRole::Left => partial.left = Some(c.object),
            PairRole::Right => partial.right = Some(c.object),
            PairRole::Target => partial.target = Some(c.object),
        }
        let (Some(left), Some(right), Some(target)) = (partial.left, partial.right, partial.target)
        else {
            return None;
        };
        self.partial_pairs.remove(&(kind, declarer));
        if self.morphisms.iter().any(|m| {
            m.kind == kind && m.source == left && m.auxiliary == Some(right) && m.target == target
        }) {
            return None;
        }
        let idx = self.morphisms.len();
        self.morphisms.push(Morphism {
            kind,
            source: left,
            target,
            auxiliary: Some(right),
        });
        self.watchers.entry(left).or_default().push(idx);
        self.watchers.entry(right).or_default().push(idx);
        Some(idx)
    }

    /// Feed the existing source (and auxiliary, for binary morphisms)
    /// fiber cells through the freshly-installed morphism, so that
    /// declarations arriving *after* their data still derive.
    fn replay_through(
        &mut self,
        idx: usize,
        history: &[DerivationStep],
        ancestry: &BTreeSet<usize>,
    ) -> Vec<WaveItem> {
        let (source, auxiliary) = {
            let m = &self.morphisms[idx];
            (m.source, m.auxiliary)
        };
        let mut out = Vec::new();
        for pred in std::iter::once(source).chain(auxiliary) {
            let cells: Vec<(TermId, TermId, Value)> = self.fiber(pred).collect();
            for (s, o, v) in cells {
                let trigger = Claim {
                    subject: s,
                    predicate: pred,
                    object: o,
                    value: v,
                };
                for (derived, step) in self.derive_via_idx(idx, trigger) {
                    let mut chain = history.to_vec();
                    chain.push(step);
                    let mut new_ancestry = ancestry.clone();
                    new_ancestry.insert(idx);
                    out.push(WaveItem {
                        claim: derived,
                        derivation: chain,
                        ancestry: new_ancestry,
                    });
                }
            }
        }
        out
    }

    /// Apply a single claim via knowledge-join. Returns the settled
    /// claim if its value changed, or `None` if the claim was already
    /// at or above its new value.
    fn apply_one(&mut self, c: Claim) -> Option<Claim> {
        let key = (c.subject, c.predicate, c.object);
        let old = self.claims.get(&key).copied().unwrap_or(Value::None);
        let new = knowledge_join(old, c.value);
        if new == old {
            return None;
        }
        self.claims.insert(key, new);
        self.fibers
            .entry(c.predicate)
            .or_default()
            .insert((c.subject, c.object));
        Some(Claim { value: new, ..c })
    }

    fn propagate(
        &mut self,
        settled: Claim,
        history: &[DerivationStep],
        ancestry: &BTreeSet<usize>,
    ) -> Vec<WaveItem> {
        let Some(indices) = self.watchers.get(&settled.predicate).cloned() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for idx in indices {
            if ancestry.contains(&idx) {
                continue;
            }
            for (derived, step) in self.derive_via_idx(idx, settled) {
                let mut chain = history.to_vec();
                chain.push(step);
                let mut new_ancestry = ancestry.clone();
                new_ancestry.insert(idx);
                out.push(WaveItem {
                    claim: derived,
                    derivation: chain,
                    ancestry: new_ancestry,
                });
            }
        }
        out
    }

    fn derive_via_idx(&mut self, idx: usize, trigger: Claim) -> Vec<(Claim, DerivationStep)> {
        let (kind, source, target, auxiliary) = {
            let m = &self.morphisms[idx];
            (m.kind, m.source, m.target, m.auxiliary)
        };
        match kind {
            MorphismKind::Specialization => vec![Self::mirror(target, trigger)],
            MorphismKind::Inversion => vec![Self::invert(target, trigger)],
            MorphismKind::Composition => self.pointwise_combine(
                source,
                target,
                auxiliary,
                trigger,
                knowledge_meet,
                MorphismKind::Composition,
            ),
            MorphismKind::Fusion => self.pointwise_combine(
                source,
                target,
                auxiliary,
                trigger,
                fuse,
                MorphismKind::Fusion,
            ),
            MorphismKind::Implication => self.pointwise_combine(
                source,
                target,
                auxiliary,
                trigger,
                restrict,
                MorphismKind::Implication,
            ),
        }
    }

    fn mirror(target: TermId, trigger: Claim) -> (Claim, DerivationStep) {
        (
            Claim {
                predicate: target,
                ..trigger
            },
            DerivationStep {
                via: MorphismKind::Specialization,
                premises: vec![trigger],
            },
        )
    }

    fn invert(target: TermId, trigger: Claim) -> (Claim, DerivationStep) {
        (
            Claim {
                subject: trigger.object,
                predicate: target,
                object: trigger.subject,
                value: negate(trigger.value),
            },
            DerivationStep {
                via: MorphismKind::Inversion,
                premises: vec![trigger],
            },
        )
    }

    /// Pointwise binary combine at a shared (subject, object): given a
    /// trigger claim in either the source or the auxiliary fiber, check
    /// the partner fiber for a cell at the **same** (subject, object).
    /// If both fibers have cells at that coordinate, derive
    ///
    /// ```text
    /// (s, target, o) = op(left_val, right_val)
    /// ```
    ///
    /// at the same (s, o). This matches the paper's fiber-functor
    /// construction (§3): composition, fusion, and implication are the
    /// pointwise lifts of the twist-product residuation ($\odot$,
    /// $\Rightarrow$) and its knowledge-meet. If the partner fiber has
    /// no cell at (s, o), or the combined value collapses to None,
    /// nothing is derived.
    fn pointwise_combine(
        &mut self,
        source: TermId,
        target: TermId,
        auxiliary: Option<TermId>,
        trigger: Claim,
        op: fn(Value, Value) -> Value,
        kind: MorphismKind,
    ) -> Vec<(Claim, DerivationStep)> {
        let Some(aux) = auxiliary else {
            return Vec::new();
        };
        let triggered_by_source = trigger.predicate == source;
        let partner_pred = if triggered_by_source { aux } else { source };
        let partner_val = self.value(trigger.subject, partner_pred, trigger.object);
        if partner_val == Value::None {
            return Vec::new();
        }
        let partner_claim = Claim {
            subject: trigger.subject,
            predicate: partner_pred,
            object: trigger.object,
            value: partner_val,
        };
        let (left, right, left_val, right_val) = if triggered_by_source {
            (trigger, partner_claim, trigger.value, partner_val)
        } else {
            (partner_claim, trigger, partner_val, trigger.value)
        };
        let derived_val = op(left_val, right_val);
        if derived_val == Value::None {
            return Vec::new();
        }
        vec![(
            Claim {
                subject: trigger.subject,
                predicate: target,
                object: trigger.object,
                value: derived_val,
            },
            DerivationStep {
                via: kind,
                premises: vec![left, right],
            },
        )]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(s: TermId, p: TermId, o: TermId, v: Value) -> Claim {
        Claim {
            subject: s,
            predicate: p,
            object: o,
            value: v,
        }
    }

    #[test]
    fn bare_assert_stores_value() {
        let mut sub = Semiotics::new();
        let (s, p, o) = (sub.intern("s"), sub.intern("p"), sub.intern("o"));
        let r = sub.assert(claim(s, p, o, Value::True));
        assert_eq!(sub.value(s, p, o), Value::True);
        assert_eq!(r.settled.len(), 1);
        assert!(r.settled[0].derivation.is_empty());
    }

    #[test]
    fn knowledge_join_is_idempotent_under_repeated_assert() {
        let mut sub = Semiotics::new();
        let (s, p, o) = (sub.intern("s"), sub.intern("p"), sub.intern("o"));
        sub.assert(claim(s, p, o, Value::True));
        let r = sub.assert(claim(s, p, o, Value::True));
        assert!(r.settled.is_empty());
    }

    #[test]
    fn conflicting_asserts_join_to_both() {
        let mut sub = Semiotics::new();
        let (s, p, o) = (sub.intern("s"), sub.intern("p"), sub.intern("o"));
        sub.assert(claim(s, p, o, Value::True));
        sub.assert(claim(s, p, o, Value::False));
        assert_eq!(sub.value(s, p, o), Value::Both);
    }

    #[test]
    fn fiber_iter_returns_all_claims_for_predicate() {
        let mut sub = Semiotics::new();
        let p = sub.intern("p");
        let (s1, s2, o) = (sub.intern("s1"), sub.intern("s2"), sub.intern("o"));
        sub.assert(claim(s1, p, o, Value::True));
        sub.assert(claim(s2, p, o, Value::False));
        let mut fiber: Vec<_> = sub.fiber(p).collect();
        fiber.sort_by_key(|&(s, _, _)| s);
        assert_eq!(fiber, vec![(s1, o, Value::True), (s2, o, Value::False)]);
    }

    // ---------------------------------------------------------------
    // Trigger-predicate install: morphism instances arrive as claims.
    // ---------------------------------------------------------------
    //
    // The five morphism kinds are fixed in Rust. Claims can install
    // *instances* of them only by using the reserved trigger
    // predicates — `specialization`, `inversion`, and the three-role
    // pairs for composition / fusion / implication. Each test below
    // runs the ordering both ways: declaration-before-data and
    // data-before-declaration; the cascade must settle the same way.

    fn t(sub: &mut Semiotics, s: &str, p: &str, o: &str) {
        let (s, p, o) = (sub.intern(s), sub.intern(p), sub.intern(o));
        sub.assert(claim(s, p, o, Value::True));
    }

    #[test]
    fn specialization_installs_from_claim_either_order() {
        // (fido, dog, labrador) — fido is a dog *witnessed by* the
        // breed "labrador". Specialization `(dog, specialization,
        // mammal)` preserves the witness through the class edge, so
        // the derived cell lands at (fido, mammal, labrador). The O
        // rides along; the bilattice value carries truthfulness.

        // Declaration first, then data.
        let mut a = Semiotics::new();
        t(&mut a, "dog", "specializes-as", "mammal");
        t(&mut a, "fido", "dog", "labrador");
        let (fido, mammal, labrador) = (a.intern("fido"), a.intern("mammal"), a.intern("labrador"));
        assert_eq!(a.value(fido, mammal, labrador), Value::True);

        // Data first, then declaration — replay must catch up.
        let mut b = Semiotics::new();
        t(&mut b, "fido", "dog", "labrador");
        t(&mut b, "dog", "specializes-as", "mammal");
        let (fido, mammal, labrador) = (b.intern("fido"), b.intern("mammal"), b.intern("labrador"));
        assert_eq!(b.value(fido, mammal, labrador), Value::True);
    }

    #[test]
    fn inversion_installs_from_claim_either_order() {
        // Declaration first.
        let mut a = Semiotics::new();
        t(&mut a, "loves", "inverts-as", "loved-by");
        t(&mut a, "alice", "loves", "bob");
        let (alice, bob, lb) = (a.intern("alice"), a.intern("bob"), a.intern("loved-by"));
        // likes(alice, bob) = T ⇒ loved-by(bob, alice) = ∼T = F
        assert_eq!(a.value(bob, lb, alice), Value::False);

        // Data first.
        let mut b = Semiotics::new();
        t(&mut b, "alice", "loves", "bob");
        t(&mut b, "loves", "inverts-as", "loved-by");
        let (alice, bob, lb) = (b.intern("alice"), b.intern("bob"), b.intern("loved-by"));
        assert_eq!(b.value(bob, lb, alice), Value::False);
    }

    #[test]
    fn composition_pair_materializes_on_third_role() {
        // Pointwise: (sigma, P, x) ∧_k (sigma, Q, x) → (sigma, R, x).
        // Left and right premises must share (s, o) for the rule to
        // fire.
        let mut sub = Semiotics::new();
        t(&mut sub, "sigma", "P", "x");
        t(&mut sub, "sigma", "Q", "x"); // same (s, o) as P's claim
                                        // Only two roles — not yet live.
        t(&mut sub, "cD", "uses-as-composition-left", "P");
        t(&mut sub, "cD", "uses-as-composition-right", "Q");
        let (sigma, r, x) = (sub.intern("sigma"), sub.intern("R"), sub.intern("x"));
        assert_eq!(sub.value(sigma, r, x), Value::None);
        // Third role completes the declaration and replays existing cells.
        t(&mut sub, "cD", "composes-into", "R");
        assert_eq!(sub.value(sigma, r, x), Value::True);
    }

    #[test]
    fn composition_does_not_fire_across_differing_objects() {
        // (sigma, P, x) and (sigma, Q, y) have the same subject but
        // different objects. Under pointwise composition, nothing
        // fires. The pair-by-subject cheat is gone.
        let mut sub = Semiotics::new();
        t(&mut sub, "sigma", "P", "x");
        t(&mut sub, "sigma", "Q", "y");
        t(&mut sub, "cD", "uses-as-composition-left", "P");
        t(&mut sub, "cD", "uses-as-composition-right", "Q");
        t(&mut sub, "cD", "composes-into", "R");
        let (sigma, r, x, y) = (
            sub.intern("sigma"),
            sub.intern("R"),
            sub.intern("x"),
            sub.intern("y"),
        );
        assert_eq!(sub.value(sigma, r, x), Value::None);
        assert_eq!(sub.value(sigma, r, y), Value::None);
    }

    #[test]
    fn fusion_pair_with_disagreement_yields_false_via_fuse() {
        // ⊙(T, F) = F under the Lambek product on 2⊗2. Pointwise:
        // both premises at the same (s, o).
        let mut sub = Semiotics::new();
        t(&mut sub, "fD", "uses-as-fusion-left", "A");
        t(&mut sub, "fD", "uses-as-fusion-right", "B");
        t(&mut sub, "fD", "fuses-into", "F");
        let (s, a, b) = (sub.intern("s"), sub.intern("A"), sub.intern("B"));
        let (o, f) = (sub.intern("o"), sub.intern("F"));
        sub.assert(claim(s, a, o, Value::True));
        sub.assert(claim(s, b, o, Value::False));
        assert_eq!(sub.value(s, f, o), Value::False);
    }

    #[test]
    fn implication_pair_derives_residual() {
        // ⇒(T, F) = F. Pointwise: antecedent and consequent at same
        // (s, o).
        let mut sub = Semiotics::new();
        t(&mut sub, "iD", "uses-as-antecedent", "A");
        t(&mut sub, "iD", "uses-as-consequent", "B");
        t(&mut sub, "iD", "implies-into", "I");
        let (s, a, b) = (sub.intern("s"), sub.intern("A"), sub.intern("B"));
        let (o, i) = (sub.intern("o"), sub.intern("I"));
        sub.assert(claim(s, a, o, Value::True));
        sub.assert(claim(s, b, o, Value::False));
        assert_eq!(sub.value(s, i, o), Value::False);
    }

    #[test]
    fn re_asserting_declaration_does_not_re_install() {
        // Idempotence: asserting (P, specialization, Q) twice must not
        // register two copies of the same morphism.
        let mut sub = Semiotics::new();
        t(&mut sub, "P", "specializes-as", "Q");
        let before = sub.morphisms.len();
        t(&mut sub, "P", "specializes-as", "Q");
        assert_eq!(sub.morphisms.len(), before);
    }
}
