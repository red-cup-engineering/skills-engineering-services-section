//! Content-addressed blob store for port-level payload handling.
//!
//! Large payloads (command output, file bodies, LLM completions) are
//! impractical to carry as an inline claim object — the substrate
//! interns every subject / predicate / object as a `TermId`, and
//! interning a megabyte of text per claim would balloon the interner.
//! This crate provides the small/large split: payloads at or under a
//! threshold pass through as UTF-8 strings; payloads over the
//! threshold land in a content-addressed directory, and the claim
//! object becomes `blob:sha256:<hex>`.
//!
//! The store is deliberately thin. No GC, no refcount, no metadata
//! sidecar — a blob file is its own canonical identity, and sha256
//! collisions are handled implicitly by file-existence short-circuit.

#![warn(missing_docs)]

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// The literal prefix used in claim-object strings that point at a
/// sha256 blob. Callers that need to recognise blob references in
/// arbitrary claim objects can match against this without parsing.
pub const SHA256_PREFIX: &str = "blob:sha256:";

/// Reference to a blob — either inline bytes (small) or a sha256
/// pointer into the content-addressed store (large).
///
/// Constructed by [`store`]; consumed by [`read`]. The stringly
/// representation used in claim objects is produced via
/// [`BlobRef::as_claim_object`] and parsed via [`BlobRef::parse`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobRef {
    /// Inline payload — fit under the configured threshold. The
    /// string is UTF-8; non-UTF-8 input bytes have been replaced
    /// with `U+FFFD` by [`store`].
    Inline(String),
    /// Content-addressed payload. The string is the sha256 of the
    /// bytes, rendered as 64 lowercase hex characters. Resolve with
    /// [`read`] against the same directory [`store`] used.
    Sha256(String),
}

impl BlobRef {
    /// Render for use as a claim object string.
    #[must_use]
    pub fn as_claim_object(&self) -> String {
        match self {
            Self::Inline(s) => s.clone(),
            Self::Sha256(h) => format!("{SHA256_PREFIX}{h}"),
        }
    }

    /// Parse a claim object string into a [`BlobRef`].
    ///
    /// An input starting with `blob:sha256:` becomes [`Self::Sha256`];
    /// anything else is taken as [`Self::Inline`]. This is pure
    /// syntax — the referenced file is not validated until [`read`].
    #[must_use]
    pub fn parse(s: &str) -> Self {
        s.strip_prefix(SHA256_PREFIX)
            .map_or_else(|| Self::Inline(s.to_owned()), |h| Self::Sha256(h.to_owned()))
    }
}

/// Decide where to put `payload` and return a [`BlobRef`] that can
/// be resolved back with [`read`] (or rendered as a claim-object
/// string via [`BlobRef::as_claim_object`]).
///
/// If `payload.len() <= threshold`, the return is [`BlobRef::Inline`]
/// carrying the payload as a UTF-8-lossy string (non-UTF-8 bytes
/// become `U+FFFD`). Otherwise the payload is written to
/// `dir/<sha256-hex>` (if not already present) and the return is
/// [`BlobRef::Sha256`].
///
/// # Errors
///
/// Returns an error if the blob directory cannot be created, or the
/// blob file cannot be written.
pub async fn store(dir: &Path, payload: &[u8], threshold: usize) -> Result<BlobRef> {
    if payload.len() <= threshold {
        return Ok(BlobRef::Inline(String::from_utf8_lossy(payload).into_owned()));
    }
    let digest = Sha256::digest(payload);
    let hex = hex_encode(digest.as_slice());
    fs::create_dir_all(dir)
        .await
        .with_context(|| format!("mkdir -p {}", dir.display()))?;
    let path = dir.join(&hex);
    if fs::try_exists(&path).await.unwrap_or(false) {
        return Ok(BlobRef::Sha256(hex));
    }
    let mut f = fs::File::create(&path)
        .await
        .with_context(|| format!("create {}", path.display()))?;
    f.write_all(payload).await?;
    f.sync_all().await?;
    Ok(BlobRef::Sha256(hex))
}

/// Resolve a [`BlobRef`] back to raw bytes.
///
/// [`BlobRef::Inline`] returns the string as UTF-8 bytes; round-trip
/// is lossy only for payloads that were not valid UTF-8 when
/// [`store`] saw them.
///
/// [`BlobRef::Sha256`] reads `dir/<hex>`.
///
/// # Errors
///
/// Returns an error if the hex is structurally invalid or the blob
/// file cannot be read.
pub async fn read(dir: &Path, blob: &BlobRef) -> Result<Vec<u8>> {
    match blob {
        BlobRef::Inline(s) => Ok(s.as_bytes().to_vec()),
        BlobRef::Sha256(hex) => {
            if !is_valid_hex(hex) {
                anyhow::bail!("blob hex is not a 64-char lowercase hex string: {hex:?}");
            }
            let path: PathBuf = dir.join(hex);
            fs::read(&path)
                .await
                .with_context(|| format!("read {}", path.display()))
        }
    }
}

fn is_valid_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("mash-util-blob-{tag}-{}-{nanos}", std::process::id()))
    }

    #[tokio::test]
    async fn small_payload_is_inlined() {
        let dir = fresh_dir("inline");
        let blob = store(&dir, b"hello\n", 16).await.unwrap();
        assert_eq!(blob, BlobRef::Inline("hello\n".into()));
        assert_eq!(blob.as_claim_object(), "hello\n");
        // Inline short-circuits: nothing on disk.
        assert!(!dir.exists() || fs::read_dir(&dir).await.unwrap().next_entry().await.unwrap().is_none());
        let round = read(&dir, &blob).await.unwrap();
        assert_eq!(round, b"hello\n");
        let _ = fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn large_payload_is_blobbed_and_round_trips() {
        let dir = fresh_dir("blob");
        let payload: Vec<u8> = (0..1024_u32).flat_map(u32::to_le_bytes).collect();
        assert!(payload.len() > 16);
        let blob = store(&dir, &payload, 16).await.unwrap();
        let BlobRef::Sha256(ref hex) = blob else {
            panic!("expected sha256 ref, got {blob:?}");
        };
        assert_eq!(hex.len(), 64);
        assert!(blob.as_claim_object().starts_with(SHA256_PREFIX));
        let round = read(&dir, &blob).await.unwrap();
        assert_eq!(round, payload);
        let _ = fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn duplicate_store_short_circuits() {
        let dir = fresh_dir("dedupe");
        let payload: Vec<u8> = (0..256_u32).flat_map(u32::to_le_bytes).collect();
        let first = store(&dir, &payload, 16).await.unwrap();
        let second = store(&dir, &payload, 16).await.unwrap();
        assert_eq!(first, second);
        // Only one file in the dir.
        let mut entries = fs::read_dir(&dir).await.unwrap();
        let mut count = 0;
        while entries.next_entry().await.unwrap().is_some() {
            count += 1;
        }
        assert_eq!(count, 1);
        let _ = fs::remove_dir_all(&dir).await;
    }

    #[test]
    fn parse_distinguishes_inline_and_blob() {
        assert_eq!(
            BlobRef::parse("plain text"),
            BlobRef::Inline("plain text".into())
        );
        let hex = "a".repeat(64);
        assert_eq!(
            BlobRef::parse(&format!("{SHA256_PREFIX}{hex}")),
            BlobRef::Sha256(hex)
        );
    }

    #[test]
    fn as_claim_object_round_trips_through_parse() {
        let inline = BlobRef::Inline("x".into());
        assert_eq!(BlobRef::parse(&inline.as_claim_object()), inline);
        let sha = BlobRef::Sha256("f".repeat(64));
        assert_eq!(BlobRef::parse(&sha.as_claim_object()), sha);
    }

    #[tokio::test]
    async fn read_rejects_malformed_hex() {
        let dir = fresh_dir("badhex");
        let bad = BlobRef::Sha256("nothex".into());
        assert!(read(&dir, &bad).await.is_err());
        let short = BlobRef::Sha256("a".repeat(63));
        assert!(read(&dir, &short).await.is_err());
        let uppercase = BlobRef::Sha256("A".repeat(64));
        assert!(read(&dir, &uppercase).await.is_err());
    }

    #[tokio::test]
    async fn read_surfaces_missing_file_error() {
        let dir = fresh_dir("missing");
        let phantom = BlobRef::Sha256("0".repeat(64));
        assert!(read(&dir, &phantom).await.is_err());
    }

    #[test]
    fn hex_encoding_matches_known_sha256() {
        // `sha256sum </dev/null` → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            hex_encode(Sha256::digest(b"").as_slice()),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[tokio::test]
    async fn threshold_boundary_is_inclusive() {
        let dir = fresh_dir("boundary");
        // payload.len() == threshold → inline.
        let blob = store(&dir, &[b'x'; 16], 16).await.unwrap();
        assert!(matches!(blob, BlobRef::Inline(_)));
        // threshold + 1 → blob.
        let blob = store(&dir, &[b'x'; 17], 16).await.unwrap();
        assert!(matches!(blob, BlobRef::Sha256(_)));
        let _ = fs::remove_dir_all(&dir).await;
    }
}
