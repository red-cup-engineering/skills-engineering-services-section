//! Projection of cascade outputs into assertion-shaped witness records.
//!
//! The proof engine's [`SemiosisTrace`] describes what a cascade just
//! derived (settled claims + their derivation chains) in
//! interned-runtime form. The hub's commit path wants that same
//! history expressed as claim-shaped records so it can stream them
//! into the kernel event log alongside the triggering assertion.
//!
//! `witnesses_of` is that projection. It is pure — no I/O, no
//! substrate mutation — and its output is [`AssertionRecord`]s
//! identical in shape to any other assertion. Hub integration is in
//! [`crate::persist::Persistence::record_commit`].
//!
//! # What gets emitted
//!
//! For each settled claim with a non-empty derivation:
//! - one `(claim-hash, derived-via, morphism-name)` per step, and
//! - one `(claim-hash, derived-from, premise-hash)` per premise of
//!   the *last* step in the chain — the step that directly produced
//!   this claim.
//!
//! Directly-asserted claims (empty derivation) emit no records; their
//! provenance is the assertion event itself, already written to the
//! log by the caller.
//!
//! Witness records are NOT re-asserted into the substrate. That
//! would introduce a regress (witnesses about witnesses) and would
//! double the substrate's footprint. They live in the event log,
//! where they are queryable by log scan.

use crate::util::hash::{claim_hash, to_hex, ClaimRef, Hash};
use crate::util::log::AssertionRecord;
use crate::inference::MorphismKind;
use crate::proof::{Claim, Interner, ResolvedClaim, SemiosisTrace};

/// Project a [`SemiosisTrace`] into a list of witness
/// [`AssertionRecord`]s.
#[must_use]
pub fn witnesses_of(trace: &SemiosisTrace, interner: &Interner) -> Vec<AssertionRecord> {
    let mut out = Vec::new();
    for settled in &trace.settled {
        emit_for(settled, interner, &mut out);
    }
    out
}

fn emit_for(settled: &ResolvedClaim, interner: &Interner, out: &mut Vec<AssertionRecord>) {
    if settled.derivation.is_empty() {
        return;
    }
    let Some(claim_hex) = hash_hex(&settled.claim, interner) else {
        return;
    };
    for step in &settled.derivation {
        out.push(AssertionRecord {
            s: claim_hex.clone(),
            p: "derived-via".to_owned(),
            o: morphism_name(step.via).to_owned(),
        });
    }
    if let Some(last) = settled.derivation.last() {
        for premise in &last.premises {
            if let Some(premise_hex) = hash_hex(premise, interner) {
                out.push(AssertionRecord {
                    s: claim_hex.clone(),
                    p: "derived-from".to_owned(),
                    o: premise_hex,
                });
            }
        }
    }
}

fn hash_hex(claim: &Claim, interner: &Interner) -> Option<String> {
    let s = interner.name(claim.subject)?;
    let p = interner.name(claim.predicate)?;
    let o = interner.name(claim.object)?;
    let reference = ClaimRef {
        subject: s,
        predicate: p,
        object: o,
        value: claim.value,
    };
    let hash: Hash = claim_hash(&reference);
    Some(to_hex(&hash))
}

fn morphism_name(kind: MorphismKind) -> &'static str {
    match kind {
        MorphismKind::Specialization => "specialization",
        MorphismKind::Inversion => "inversion",
        MorphismKind::Composition => "composition",
        MorphismKind::Fusion => "fusion",
        MorphismKind::Implication => "implication",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::algebra::Value;
    use crate::proof::Semiotics;

    #[test]
    fn directly_asserted_claims_produce_no_witnesses() {
        let mut sem = Semiotics::new();
        let (s, p, o) = (sem.intern("a"), sem.intern("b"), sem.intern("c"));
        let trace = sem.assert(Claim {
            subject: s,
            predicate: p,
            object: o,
            value: Value::True,
        });
        assert!(witnesses_of(&trace, sem.interner()).is_empty());
    }

    #[test]
    fn specialization_derives_a_witness_pair() {
        let mut sem = Semiotics::new();
        let src = sem.intern("src");
        let tgt = sem.intern("tgt");
        let spec = sem.intern("specializes-as");
        let s = sem.intern("s");
        let o = sem.intern("o");

        sem.assert(Claim {
            subject: src,
            predicate: spec,
            object: tgt,
            value: Value::True,
        });
        let trace = sem.assert(Claim {
            subject: s,
            predicate: src,
            object: o,
            value: Value::True,
        });

        let witnesses = witnesses_of(&trace, sem.interner());
        let src_hash = to_hex(&claim_hash(&ClaimRef {
            subject: "s",
            predicate: "src",
            object: "o",
            value: Value::True,
        }));
        let tgt_hash = to_hex(&claim_hash(&ClaimRef {
            subject: "s",
            predicate: "tgt",
            object: "o",
            value: Value::True,
        }));

        assert!(witnesses.contains(&AssertionRecord {
            s: tgt_hash.clone(),
            p: "derived-via".into(),
            o: "specialization".into(),
        }));
        assert!(witnesses.contains(&AssertionRecord {
            s: tgt_hash,
            p: "derived-from".into(),
            o: src_hash,
        }));
    }
}
