//! The four-valued Belnap bilattice **2⊗2** and the twist-product
//! residuation that equips it with an adjoint pair.
//!
//! Every value is an evidence pair `(positive, negative)` drawn from
//! `{0, 1}`, giving four states:
//!
//! | [`Value`]        | pair     | meaning                   |
//! |------------------|----------|---------------------------|
//! | [`Value::None`]  | `(0, 0)` | no evidence               |
//! | [`Value::True`]  | `(1, 0)` | positive evidence only    |
//! | [`Value::False`] | `(0, 1)` | negative evidence only    |
//! | [`Value::Both`]  | `(1, 1)` | contradictory evidence    |
//!
//! Values carry two simultaneous orderings. The **truth ordering**
//! [`truth_leq`] has `False` at the bottom and `True` at the top;
//! `None` and `Both` are incomparable middles. The **knowledge
//! ordering** [`knowledge_leq`] has `None` at the bottom and `Both` at
//! the top.
//!
//! Two adjoint operations, [`fuse`] (⊙) and [`restrict`] (⇒), form the
//! Lambek residuation on the twist product:
//!
//! ```text
//! a ⊙ p ≤_t q    iff    p ≤_t (a ⇒ q)
//! ```
//!
//! Call [`verify_adjunction`] to check this exhaustively on all 64
//! triples. [`knowledge_join`] is commutative, associative, and
//! idempotent, so concurrent writers asserting into the same cell
//! converge without coordination — this is how the MASH substrate
//! functions as a CRDT.
//!
//! See the MASH manual chapter on [values][manual] for the broader
//! discussion.
//!
//! [manual]: https://561.github.io/mash/explanation/concepts/values.html
//!
//! # Quick tour
//!
//! ```
//! use mash_engine::algebra::{fuse, knowledge_join, restrict, truth_leq, Value};
//!
//! // Evidence accumulates under the knowledge ordering.
//! assert_eq!(knowledge_join(Value::True, Value::False), Value::Both);
//! assert_eq!(knowledge_join(Value::True, Value::True),  Value::True);
//!
//! // The adjunction: a ⊙ p ≤_t q  iff  p ≤_t (a ⇒ q).
//! let (a, p, q) = (Value::True, Value::False, Value::Both);
//! assert_eq!(
//!     truth_leq(fuse(a, p), q),
//!     truth_leq(p, restrict(a, q)),
//! );
//! ```

#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

/// One of the four Belnap values.
///
/// Each variant encodes an evidence pair `(positive, negative)`; see
/// the crate-level table for the mapping. Serde serializes each
/// variant as its canonical lowercase name.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::Value;
///
/// assert_eq!(Value::True.pair(),  (1, 0));
/// assert_eq!(Value::False.pair(), (0, 1));
/// assert_eq!(Value::Both.pair(),  (1, 1));
/// assert_eq!(Value::None.pair(),  (0, 0));
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Value {
    /// No evidence either way — `(0, 0)`.
    None,
    /// Positive evidence only — `(1, 0)`.
    True,
    /// Negative evidence only — `(0, 1)`.
    False,
    /// Contradictory evidence — `(1, 1)`.
    Both,
}

impl Value {
    /// Return the `(positive, negative)` evidence pair.
    ///
    /// # Examples
    ///
    /// ```
    /// use mash_engine::algebra::Value;
    /// assert_eq!(Value::Both.pair(), (1, 1));
    /// ```
    #[inline]
    #[must_use]
    pub fn pair(self) -> (u8, u8) {
        match self {
            Value::None => (0, 0),
            Value::True => (1, 0),
            Value::False => (0, 1),
            Value::Both => (1, 1),
        }
    }

    /// Construct a value from an evidence pair.
    ///
    /// # Panics
    ///
    /// Panics if `pos` or `neg` is anything other than `0` or `1`.
    ///
    /// # Examples
    ///
    /// ```
    /// use mash_engine::algebra::Value;
    /// assert_eq!(Value::from_pair(1, 0), Value::True);
    /// assert_eq!(Value::from_pair(0, 1), Value::False);
    /// ```
    #[inline]
    #[must_use]
    pub fn from_pair(pos: u8, neg: u8) -> Value {
        match (pos, neg) {
            (0, 0) => Value::None,
            (1, 0) => Value::True,
            (0, 1) => Value::False,
            (1, 1) => Value::Both,
            _ => panic!("invalid bilattice pair ({pos},{neg})"),
        }
    }

    /// Return the canonical lowercase name (`"none"`, `"true"`,
    /// `"false"`, `"both"`).
    ///
    /// Matches the `serde` representation and the on-wire form used
    /// by the hub.
    ///
    /// # Examples
    ///
    /// ```
    /// use mash_engine::algebra::Value;
    /// assert_eq!(Value::Both.as_str(), "both");
    /// ```
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Value::None => "none",
            Value::True => "true",
            Value::False => "false",
            Value::Both => "both",
        }
    }
}

/// The four [`Value`]s in canonical order: `None, True, False, Both`.
pub const VALUES: [Value; 4] = [Value::None, Value::True, Value::False, Value::Both];

/// Return `true` when `v` carries any evidence at all — every value
/// except [`Value::None`].
///
/// Context composition uses this to decide whether a claim belongs
/// in a rendered prompt: unsettled (`None`) claims are excluded.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{is_settled, Value};
/// assert!( is_settled(Value::True));
/// assert!( is_settled(Value::Both));
/// assert!(!is_settled(Value::None));
/// ```
#[inline]
#[must_use]
pub fn is_settled(v: Value) -> bool {
    v != Value::None
}

/// The three values that can appear after [`post_close`] pushes
/// `None` up to `Both`.
pub const POST_CLOSURE_VALUES: [Value; 3] = [Value::True, Value::False, Value::Both];

// ================================================================
//                    Truth ordering ≤_t
// ================================================================

/// Return `true` if `a ≤_t b` under the truth ordering.
///
/// `False` is the bottom and `True` is the top; `None` and `Both` are
/// incomparable middles.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{truth_leq, Value};
/// assert!( truth_leq(Value::False, Value::True));
/// assert!( truth_leq(Value::None,  Value::True));
/// assert!(!truth_leq(Value::Both,  Value::None));
/// ```
#[must_use]
pub fn truth_leq(a: Value, b: Value) -> bool {
    let (ap, an) = a.pair();
    let (bp, bn) = b.pair();
    ap <= bp && bn <= an
}

/// Return the greatest lower bound under the truth ordering.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{truth_meet, Value};
/// assert_eq!(truth_meet(Value::True, Value::False), Value::False);
/// ```
#[must_use]
pub fn truth_meet(a: Value, b: Value) -> Value {
    let (ap, an) = a.pair();
    let (bp, bn) = b.pair();
    Value::from_pair(ap.min(bp), an.max(bn))
}

/// Return the least upper bound under the truth ordering.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{truth_join, Value};
/// assert_eq!(truth_join(Value::True, Value::False), Value::True);
/// ```
#[must_use]
pub fn truth_join(a: Value, b: Value) -> Value {
    let (ap, an) = a.pair();
    let (bp, bn) = b.pair();
    Value::from_pair(ap.max(bp), an.min(bn))
}

// ================================================================
//                  Knowledge ordering ≤_k
// ================================================================

/// Return `true` if `a ≤_k b` under the knowledge ordering.
///
/// `None` is the bottom and `Both` is the top; `True` and `False` are
/// incomparable middles.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{knowledge_leq, Value};
/// assert!( knowledge_leq(Value::None, Value::True));
/// assert!( knowledge_leq(Value::True, Value::Both));
/// assert!(!knowledge_leq(Value::True, Value::False));
/// ```
#[must_use]
pub fn knowledge_leq(a: Value, b: Value) -> bool {
    let (ap, an) = a.pair();
    let (bp, bn) = b.pair();
    ap <= bp && an <= bn
}

/// Return the greatest lower bound under the knowledge ordering.
#[must_use]
pub fn knowledge_meet(a: Value, b: Value) -> Value {
    let (ap, an) = a.pair();
    let (bp, bn) = b.pair();
    Value::from_pair(ap.min(bp), an.min(bn))
}

/// Return the least upper bound under the knowledge ordering — the
/// CRDT merge.
///
/// Commutative, associative, and idempotent, so concurrent observers
/// asserting conflicting evidence about the same cell converge on
/// the same value.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{knowledge_join, Value};
///
/// // Disagreement rises to Both without losing either side.
/// assert_eq!(knowledge_join(Value::True, Value::False), Value::Both);
///
/// // Agreement is idempotent.
/// assert_eq!(knowledge_join(Value::True, Value::True), Value::True);
///
/// // Commutative.
/// assert_eq!(
///     knowledge_join(Value::True, Value::False),
///     knowledge_join(Value::False, Value::True),
/// );
/// ```
#[must_use]
pub fn knowledge_join(a: Value, b: Value) -> Value {
    let (ap, an) = a.pair();
    let (bp, bn) = b.pair();
    Value::from_pair(ap.max(bp), an.max(bn))
}

// ================================================================
//                           Negation
// ================================================================

/// Swap positive and negative evidence.
///
/// Involutive: `negate(negate(v)) == v`. Fixes `None` and `Both` (they
/// are symmetric under the swap).
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{negate, Value};
/// assert_eq!(negate(Value::True),  Value::False);
/// assert_eq!(negate(Value::False), Value::True);
/// assert_eq!(negate(Value::None),  Value::None);
/// assert_eq!(negate(Value::Both),  Value::Both);
/// ```
#[must_use]
pub fn negate(v: Value) -> Value {
    let (p, n) = v.pair();
    Value::from_pair(n, p)
}

// ================================================================
//                Twist-product residuated pair
// ================================================================

#[inline]
fn b_and(x: u8, y: u8) -> u8 {
    x & y
}

#[inline]
fn b_impl(x: u8, y: u8) -> u8 {
    u8::from(!(x == 1 && y == 0))
}

/// Lambek product `⊙` — the left adjoint of [`restrict`].
///
/// `fuse` (⊙) combines two evidence pairs by fusing positive evidence
/// and cross-checking each side's positive evidence against the
/// other's negative evidence. Under the Chu identification
/// `2⊗2 ≅ Chu(2, 0)`, `fuse` is the multiplicative tensor.
///
/// The adjunction `fuse ⊣ restrict` satisfies, for all `a, p, q`:
///
/// ```text
/// truth_leq(fuse(a, p), q) == truth_leq(p, restrict(a, q))
/// ```
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{fuse, Value};
/// // Top for `fuse` is Both (not True).
/// assert_eq!(fuse(Value::Both,  Value::True), Value::True);
/// // False absorbs.
/// assert_eq!(fuse(Value::False, Value::True), Value::False);
/// ```
// The single-letter bindings track the variable names from the
// paper's presentation of the twist product; renaming to verbose
// identifiers would make this harder to cross-check against the math.
#[must_use]
#[allow(clippy::many_single_char_names)]
pub fn fuse(a: Value, b: Value) -> Value {
    let (x, y) = a.pair();
    let (z, v) = b.pair();
    Value::from_pair(b_and(x, z), b_and(b_impl(x, v), b_impl(z, y)))
}

/// Lambek implication `⇒` — the right adjoint of [`fuse`].
///
/// Under the Chu identification, `restrict` is the linear implication.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{restrict, Value};
/// assert_eq!(restrict(Value::True,  Value::True),  Value::True);
/// assert_eq!(restrict(Value::False, Value::False), Value::True);
/// ```
#[must_use]
#[allow(clippy::many_single_char_names)]
pub fn restrict(a: Value, b: Value) -> Value {
    let (x, y) = a.pair();
    let (z, v) = b.pair();
    Value::from_pair(b_and(b_impl(x, z), b_impl(v, y)), b_and(x, v))
}

// ================================================================
//                         Post-closure
// ================================================================

/// Raise `None` to `Both`; leave every other value unchanged.
///
/// Applied after settlement, so "no information within scope" becomes
/// "fully indeterminate" rather than silently vanishing.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{post_close, Value};
/// assert_eq!(post_close(Value::None),  Value::Both);
/// assert_eq!(post_close(Value::True),  Value::True);
/// assert_eq!(post_close(Value::False), Value::False);
/// assert_eq!(post_close(Value::Both),  Value::Both);
/// ```
#[must_use]
pub fn post_close(v: Value) -> Value {
    match v {
        Value::None => Value::Both,
        other => other,
    }
}

// ================================================================
//                     Nelson implication
// ================================================================

/// Nelson implication `⇒_N` — coincides with [`restrict`] on 2⊗2.
///
/// Incorporates contrapositive symmetry at the algebra level:
/// `nelson_imply(a, b) = knowledge_meet(restrict(a, b), restrict(¬b, ¬a))`.
/// On 2⊗2 the two definitions produce identical tables; the Nelson
/// form is provided for parity with the paper's development.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::{nelson_imply, restrict, Value};
/// for a in [Value::None, Value::True, Value::False, Value::Both] {
///     for b in [Value::None, Value::True, Value::False, Value::Both] {
///         assert_eq!(nelson_imply(a, b), restrict(a, b));
///     }
/// }
/// ```
#[must_use]
pub fn nelson_imply(a: Value, b: Value) -> Value {
    knowledge_meet(restrict(a, b), restrict(negate(b), negate(a)))
}

/// Nelson conjunction — coincides with [`fuse`] on 2⊗2.
#[must_use]
pub fn nelson_fuse(a: Value, b: Value) -> Value {
    negate(nelson_imply(a, negate(b)))
}

// ================================================================
//                       Verification
// ================================================================

/// Result of exhaustively enumerating the `fuse ⊣ restrict`
/// adjunction on 2⊗2.
#[derive(Debug)]
pub struct AdjunctionReport {
    /// Number of `(a, p, q)` triples inspected. Always `64 = 4³`.
    pub checked: usize,
    /// Triples where `fuse(a, p) ≤_t q` disagreed with
    /// `p ≤_t restrict(a, q)`. Expected to be empty.
    pub violations: Vec<(Value, Value, Value, bool, bool)>,
}

/// Verify `a ⊙ p ≤_t q ⇔ p ≤_t (a ⇒ q)` on every triple in
/// `{None, True, False, Both}³`.
///
/// The report is empty on a correct implementation. This function is
/// used both as a regression check (see the `adjunction_zero_violations`
/// test) and as a runtime sanity probe.
///
/// # Examples
///
/// ```
/// use mash_engine::algebra::verify_adjunction;
/// let r = verify_adjunction();
/// assert_eq!(r.checked, 64);
/// assert!(r.violations.is_empty());
/// ```
#[must_use]
pub fn verify_adjunction() -> AdjunctionReport {
    let mut violations = Vec::new();
    let mut checked = 0;
    for &a in &VALUES {
        for &p in &VALUES {
            for &q in &VALUES {
                checked += 1;
                let left = truth_leq(fuse(a, p), q);
                let right = truth_leq(p, restrict(a, q));
                if left != right {
                    violations.push((a, p, q, left, right));
                }
            }
        }
    }
    AdjunctionReport {
        checked,
        violations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pair_roundtrip() {
        for &v in &VALUES {
            let (p, n) = v.pair();
            assert_eq!(Value::from_pair(p, n), v);
        }
    }

    #[test]
    fn knowledge_join_is_crdt() {
        for &a in &VALUES {
            assert_eq!(knowledge_join(a, a), a, "idempotent");
            for &b in &VALUES {
                assert_eq!(knowledge_join(a, b), knowledge_join(b, a), "commutative");
                for &c in &VALUES {
                    let left = knowledge_join(knowledge_join(a, b), c);
                    let right = knowledge_join(a, knowledge_join(b, c));
                    assert_eq!(left, right, "associative");
                }
            }
        }
    }

    #[test]
    fn knowledge_join_is_monotonic() {
        for &a in &VALUES {
            for &b in &VALUES {
                assert!(knowledge_leq(a, knowledge_join(a, b)));
                assert!(knowledge_leq(b, knowledge_join(a, b)));
            }
        }
    }

    #[test]
    fn knowledge_diamond_shape() {
        assert!(knowledge_leq(Value::None, Value::True));
        assert!(knowledge_leq(Value::None, Value::False));
        assert!(knowledge_leq(Value::True, Value::Both));
        assert!(knowledge_leq(Value::False, Value::Both));
        assert!(!knowledge_leq(Value::True, Value::False));
        assert!(!knowledge_leq(Value::False, Value::True));
    }

    #[test]
    fn truth_diamond_shape() {
        assert!(truth_leq(Value::False, Value::None));
        assert!(truth_leq(Value::False, Value::Both));
        assert!(truth_leq(Value::None, Value::True));
        assert!(truth_leq(Value::Both, Value::True));
        assert!(!truth_leq(Value::None, Value::Both));
        assert!(!truth_leq(Value::Both, Value::None));
    }

    #[test]
    fn negation_involution() {
        for &v in &VALUES {
            assert_eq!(negate(negate(v)), v);
        }
        assert_eq!(negate(Value::True), Value::False);
        assert_eq!(negate(Value::False), Value::True);
        assert_eq!(negate(Value::None), Value::None);
        assert_eq!(negate(Value::Both), Value::Both);
    }

    #[test]
    fn adjunction_zero_violations() {
        let r = verify_adjunction();
        assert_eq!(r.checked, 64);
        assert!(r.violations.is_empty(), "violations: {:?}", r.violations);
    }

    #[test]
    fn settled_excludes_only_none() {
        assert!(is_settled(Value::True));
        assert!(is_settled(Value::False));
        assert!(is_settled(Value::Both));
        assert!(!is_settled(Value::None));
    }

    #[test]
    fn nelson_coincides_with_busaniche_cignoli_on_2x2() {
        for &a in &VALUES {
            for &b in &VALUES {
                assert_eq!(nelson_imply(a, b), restrict(a, b));
                assert_eq!(nelson_fuse(a, b), fuse(a, b));
            }
        }
    }

    #[test]
    fn post_close_raises_none_to_both() {
        assert_eq!(post_close(Value::None), Value::Both);
        assert_eq!(post_close(Value::True), Value::True);
        assert_eq!(post_close(Value::False), Value::False);
        assert_eq!(post_close(Value::Both), Value::Both);
    }

    #[test]
    fn fuse_and_restrict_spot_checks() {
        assert_eq!(fuse(Value::True, Value::True), Value::True);
        assert_eq!(fuse(Value::True, Value::False), Value::False);
        for &a in &VALUES {
            assert!(truth_leq(fuse(a, restrict(a, a)), a));
        }
    }
}
