//! Canonical claim serialization and SHA-256 hashing for MASH.
//!
//! Every claim, fiber, and reality has a content-addressable hash. The
//! scheme is specified in `docs/bundle-layout.md`; this crate is the
//! sole authority on what bytes go into the hash.
//!
//! # Canonical form of a claim
//!
//! A claim's canonical bytes are JSON with the fixed field order
//! `s`, `p`, `o`, `v` — matching the on-disk JSONL line format so that
//! a claim's hash can be computed by reading its line verbatim. No
//! surrounding whitespace, no trailing newline. Strings are
//! JSON-escaped minimally (quote, backslash, control characters). The
//! value is encoded with the variant names of
//! [`crate::algebra::Value`] in lowercase (`none` / `true` /
//! `false` / `both`).
//!
//! Canonical bytes are defined *here*, not by round-tripping through
//! `serde_json` — that way the hash is stable against upstream
//! formatter changes.
//!
//! # Assertion records vs. claim hashing
//!
//! Event-log and bundle records carry only `s`, `p`, `o` — the
//! implicit value is `true`, because clients never assert non-`true`
//! values (cascade produces those as derivations). When hashing an
//! assertion record, treat value as `Value::True` before calling
//! [`claim_hash`].
//!
//! # Fiber and reality hashing
//!
//! A fiber's hash is SHA-256 of its constituent claim hashes rendered
//! as lowercase hex and joined with `\n`, in sorted order. Reality
//! hash uses the same algorithm over a directory's fiber hashes. Both
//! are order-independent by construction, so two MASH instances that
//! assert the same set of claims arrive at the same reality hash
//! regardless of the order in which they asserted them.

#![warn(missing_docs)]

use crate::algebra::Value;
use sha2::{Digest, Sha256};

/// A 32-byte SHA-256 digest.
pub type Hash = [u8; 32];

/// A reference to a claim for hashing. The string fields are the *raw*
/// (un-escaped) subject, predicate, and object — identity is defined
/// by the raw triple, not its on-disk path encoding.
#[derive(Debug, Clone, Copy)]
pub struct ClaimRef<'a> {
    /// Raw subject.
    pub subject: &'a str,
    /// Raw predicate.
    pub predicate: &'a str,
    /// Raw object.
    pub object: &'a str,
    /// Bilattice value.
    pub value: Value,
}

/// Write the canonical bytes of a claim into `out`.
///
/// The buffer is extended in place; the caller may reuse it across
/// calls to avoid allocation.
pub fn write_canonical(out: &mut Vec<u8>, claim: &ClaimRef<'_>) {
    out.extend_from_slice(b"{\"s\":");
    write_json_string(out, claim.subject);
    out.extend_from_slice(b",\"p\":");
    write_json_string(out, claim.predicate);
    out.extend_from_slice(b",\"o\":");
    write_json_string(out, claim.object);
    out.extend_from_slice(b",\"v\":");
    write_json_string(out, value_token(claim.value));
    out.push(b'}');
}

/// Return the canonical bytes of a claim.
#[must_use]
pub fn canonical_bytes(claim: &ClaimRef<'_>) -> Vec<u8> {
    let mut out = Vec::with_capacity(
        claim.subject.len() + claim.predicate.len() + claim.object.len() + 48,
    );
    write_canonical(&mut out, claim);
    out
}

/// SHA-256 of a claim's canonical bytes.
#[must_use]
pub fn claim_hash(claim: &ClaimRef<'_>) -> Hash {
    let bytes = canonical_bytes(claim);
    let mut sha = Sha256::new();
    sha.update(&bytes);
    sha.finalize().into()
}

/// Hash of a fiber: SHA-256 of its sorted claim hashes, rendered as
/// lowercase hex and joined with `\n`.
///
/// Accepts the hashes by value; makes an internal sorted copy.
#[must_use]
pub fn fiber_hash(claim_hashes: &[Hash]) -> Hash {
    hash_of_sorted_hashes(claim_hashes)
}

/// Hash of a reality: SHA-256 of its sorted fiber hashes, rendered as
/// lowercase hex and joined with `\n`.
///
/// Algorithmically identical to [`fiber_hash`]; the distinct name
/// records intent at the call site.
#[must_use]
pub fn reality_hash(fiber_hashes: &[Hash]) -> Hash {
    hash_of_sorted_hashes(fiber_hashes)
}

fn hash_of_sorted_hashes(inputs: &[Hash]) -> Hash {
    let mut sorted: Vec<Hash> = inputs.to_vec();
    sorted.sort_unstable();
    let mut sha = Sha256::new();
    for (i, h) in sorted.iter().enumerate() {
        if i > 0 {
            sha.update(b"\n");
        }
        let mut buf = [0u8; 64];
        write_hex(h, &mut buf);
        sha.update(buf);
    }
    sha.finalize().into()
}

/// Render a hash as 64 lowercase hex characters.
#[must_use]
pub fn to_hex(hash: &Hash) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for &b in hash {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Parse a 64-character lowercase hex string into a [`tyalias@Hash`].
///
/// # Errors
///
/// Returns an error if `s` is not exactly 64 ASCII characters or
/// contains a non-hex character.
pub fn from_hex(s: &str) -> Result<Hash, HexError> {
    if s.len() != 64 {
        return Err(HexError::WrongLength(s.len()));
    }
    let bytes = s.as_bytes();
    let mut out = [0u8; 32];
    for i in 0..32 {
        let hi = hex_nibble(bytes[i * 2])?;
        let lo = hex_nibble(bytes[i * 2 + 1])?;
        out[i] = (hi << 4) | lo;
    }
    Ok(out)
}

/// Error returned from [`from_hex`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HexError {
    /// Input was not exactly 64 characters.
    WrongLength(usize),
    /// Input contained a non-hex character at the given byte index.
    BadChar(u8),
}

impl std::fmt::Display for HexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongLength(n) => write!(f, "expected 64 hex chars, got {n}"),
            Self::BadChar(b) => write!(f, "non-hex byte {b:#x}"),
        }
    }
}

impl std::error::Error for HexError {}

fn write_hex(hash: &Hash, out: &mut [u8; 64]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for (i, &b) in hash.iter().enumerate() {
        out[i * 2] = HEX[(b >> 4) as usize];
        out[i * 2 + 1] = HEX[(b & 0x0f) as usize];
    }
}

fn hex_nibble(b: u8) -> Result<u8, HexError> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        _ => Err(HexError::BadChar(b)),
    }
}

fn value_token(v: Value) -> &'static str {
    match v {
        Value::None => "none",
        Value::True => "true",
        Value::False => "false",
        Value::Both => "both",
    }
}

fn write_json_string(out: &mut Vec<u8>, s: &str) {
    out.push(b'"');
    for c in s.chars() {
        match c {
            '"' => out.extend_from_slice(b"\\\""),
            '\\' => out.extend_from_slice(b"\\\\"),
            '\n' => out.extend_from_slice(b"\\n"),
            '\r' => out.extend_from_slice(b"\\r"),
            '\t' => out.extend_from_slice(b"\\t"),
            '\x08' => out.extend_from_slice(b"\\b"),
            '\x0c' => out.extend_from_slice(b"\\f"),
            c if (c as u32) < 0x20 => {
                let mut buf = [0u8; 6];
                let hex = b"0123456789abcdef";
                buf[0] = b'\\';
                buf[1] = b'u';
                buf[2] = b'0';
                buf[3] = b'0';
                buf[4] = hex[((c as u32) >> 4) as usize];
                buf[5] = hex[((c as u32) & 0x0f) as usize];
                out.extend_from_slice(&buf);
            }
            c => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    out.push(b'"');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ClaimRef<'static> {
        ClaimRef {
            subject: "agent:shell",
            predicate: "is-a",
            object: "service",
            value: Value::True,
        }
    }

    #[test]
    fn canonical_bytes_are_stable() {
        let bytes = canonical_bytes(&sample());
        assert_eq!(
            std::str::from_utf8(&bytes).unwrap(),
            r#"{"s":"agent:shell","p":"is-a","o":"service","v":"true"}"#
        );
    }

    #[test]
    fn claim_hash_is_deterministic() {
        let a = claim_hash(&sample());
        let b = claim_hash(&sample());
        assert_eq!(a, b);
    }

    #[test]
    fn different_claims_have_different_hashes() {
        let a = claim_hash(&sample());
        let b = claim_hash(&ClaimRef {
            value: Value::False,
            ..sample()
        });
        assert_ne!(a, b);
    }

    #[test]
    fn hex_round_trips() {
        let h = claim_hash(&sample());
        let s = to_hex(&h);
        assert_eq!(s.len(), 64);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(from_hex(&s).unwrap(), h);
    }

    #[test]
    fn from_hex_rejects_bad_length_and_bad_chars() {
        assert!(matches!(from_hex("abcd"), Err(HexError::WrongLength(4))));
        let mut s = "a".repeat(64);
        // Replace one char with a non-hex char.
        s.replace_range(10..11, "Z");
        assert!(matches!(from_hex(&s), Err(HexError::BadChar(_))));
    }

    #[test]
    fn fiber_hash_is_order_independent() {
        let a = claim_hash(&sample());
        let b = claim_hash(&ClaimRef {
            predicate: "has-version",
            object: "0.1",
            ..sample()
        });
        assert_eq!(fiber_hash(&[a, b]), fiber_hash(&[b, a]));
    }

    #[test]
    fn fiber_hash_distinguishes_content() {
        let a = claim_hash(&sample());
        let b = claim_hash(&ClaimRef {
            predicate: "has-version",
            object: "0.1",
            ..sample()
        });
        assert_ne!(fiber_hash(&[a]), fiber_hash(&[a, b]));
    }

    #[test]
    fn reality_hash_is_algorithmically_equivalent_to_fiber_hash() {
        let a = claim_hash(&sample());
        let b = claim_hash(&ClaimRef {
            predicate: "has-version",
            object: "0.1",
            ..sample()
        });
        // Same inputs → same output, regardless of which name we call.
        assert_eq!(fiber_hash(&[a, b]), reality_hash(&[a, b]));
    }

    #[test]
    fn json_string_escapes() {
        let c = ClaimRef {
            subject: "s",
            predicate: "p",
            object: "has \"quote\" and\nnewline",
            value: Value::True,
        };
        let bytes = canonical_bytes(&c);
        let s = std::str::from_utf8(&bytes).unwrap();
        assert!(s.contains(r#"\"quote\""#));
        assert!(s.contains(r"\n"));
    }

    #[test]
    fn value_tokens_match_algebra_serde_rename() {
        // Guard: if mash_engine::algebra changes the serde rename rule,
        // our canonical form diverges silently. Surface it here.
        for (v, expected) in [
            (Value::None, "none"),
            (Value::True, "true"),
            (Value::False, "false"),
            (Value::Both, "both"),
        ] {
            assert_eq!(value_token(v), expected);
            let via_serde = serde_json::to_string(&v).ok();
            assert_eq!(via_serde.as_deref(), Some(&*format!("\"{expected}\"")));
        }
    }
}
