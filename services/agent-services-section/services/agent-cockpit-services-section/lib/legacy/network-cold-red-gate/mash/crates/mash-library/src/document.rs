//! Document — files with structured frontmatter plus body.
//!
//! # What a document is
//!
//! A file whose contents begin with a `---\n...\n---\n` YAML-like
//! frontmatter block followed by a body. The parser ingests the file
//! into substrate claims:
//!
//! ```text
//! (f, is-a, document)
//! (f, has-body, <text-or-blob-ref>)
//! (f, has-frontmatter, <f>:frontmatter:<key>)     [per key]
//! (<f>:frontmatter:<key>, is-a, document-frontmatter-entry)
//! (<f>:frontmatter:<key>, has-key, "<key>")
//! (<f>:frontmatter:<key>, has-value, "<value>")   [multi for seqs]
//! ```
//!
//! Reifying each key as its own subject keeps fiber predicates
//! ownable and queryable without dynamic predicate minting.
//!
//! # Supported frontmatter shape
//!
//! This parser is deliberately minimal — no external YAML dep. It
//! handles:
//!
//! - `---\n...\n---\n<body>` delimited frontmatter
//! - Scalar key-value: `key: value`
//! - Block-sequence values:
//!   ```yaml
//!   tags:
//!     - alpha
//!     - beta
//!   ```
//! - Quoted scalars (strips surrounding `"..."` or `'...'`).
//!
//! Not handled (emits [`HAS_FRONTMATTER_PARSE_ERROR`] with
//! `"malformed-frontmatter"`):
//!
//! - Nested mappings
//! - Inline sequences (`tags: [a, b]`)
//! - Multi-line scalars (`|` / `>`)
//!
//! Real YAML fidelity is deferred until a specific consumer needs
//! features this parser doesn't provide.
//!
//! # Parse errors
//!
//! Emitted as `(file, has-frontmatter-parse-error, reason)`:
//! - `"blob-body"` — content is a `blob:sha256:<hex>` reference
//! - `"not-utf-8"` — binary content kind
//! - `"malformed-frontmatter"` — frontmatter present but unparseable
//! - `"no-frontmatter"` — file has no frontmatter block

use std::collections::HashMap;

use async_trait::async_trait;
use mash_engine::algebra::Value;
use mash_engine::sdk::agent::{Agent, Projection};
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};
use crate::fs::{FILE_CONTENT_KIND_BINARY, HAS_CONTENT, HAS_CONTENT_KIND};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-document";

// ─────────────────────────────────────────────────────────────────────
// Terms
// ─────────────────────────────────────────────────────────────────────

/// A file with structured frontmatter and body.
pub const DOCUMENT: &str = "document";

/// A reified frontmatter key/values pair.
pub const DOCUMENT_FRONTMATTER_ENTRY: &str = "document-frontmatter-entry";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(document, has-body, string-or-blob-ref)` — post-frontmatter
/// body payload. Different shape from [`crate::conduit::HAS_BODY`]
/// (document body vs surface-ready response body); same predicate
/// string by design — the substrate is ontology-neutral, and
/// "has-body" reads cleanly in both contexts.
pub const HAS_BODY: &str = "has-body";

/// `(document, has-frontmatter, entry-subject)` — per-key reified
/// entry.
pub const HAS_FRONTMATTER: &str = "has-frontmatter";

/// `(entry, has-key, key-string)`.
pub const HAS_KEY: &str = "has-key";

/// `(entry, has-value, value-string)` — multi-valued for sequences.
pub const HAS_VALUE: &str = "has-value";

/// `(document, has-frontmatter-parse-error, reason)` — failure
/// witness.
pub const HAS_FRONTMATTER_PARSE_ERROR: &str = "has-frontmatter-parse-error";

// Error reason strings.
const REASON_BLOB_BODY: &str = "blob-body";
const REASON_NOT_UTF8: &str = "not-utf-8";
const REASON_MALFORMED: &str = "malformed-frontmatter";
const REASON_NO_FRONTMATTER: &str = "no-frontmatter";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the document vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Document;

#[async_trait]
impl Agent for Document {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();
        for t in [DOCUMENT, DOCUMENT_FRONTMATTER_ENTRY] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }
        for p in [
            HAS_BODY,
            HAS_FRONTMATTER,
            HAS_KEY,
            HAS_VALUE,
            HAS_FRONTMATTER_PARSE_ERROR,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }
        out
    }
}

// ─────────────────────────────────────────────────────────────────────
// Pure parse
// ─────────────────────────────────────────────────────────────────────

/// Parsed document contents, ready to emit as substrate claims.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDocument {
    /// Post-frontmatter body text.
    pub body: String,
    /// Ordered `(key, values)` pairs.
    pub entries: Vec<(String, Vec<String>)>,
}

/// Parse a utf-8 document into frontmatter entries plus body.
///
/// Returns `Ok(None)` when no frontmatter block is present (no
/// leading `---\n`). Returns `Err(reason)` when a frontmatter block
/// is present but can't be parsed.
///
/// # Errors
///
/// `REASON_MALFORMED` if the frontmatter block is present but the
/// body can't be parsed as simple YAML-subset.
pub fn parse_document(content: &str) -> Result<Option<ParsedDocument>, &'static str> {
    let Some(rest) = content.strip_prefix("---\n") else {
        return Ok(None);
    };
    // Find the closing `---` delimiter. Convention: `\n---\n`. Also
    // accept a trailing `\n---` with no final newline.
    let (frontmatter, body) = if let Some(end) = rest.find("\n---\n") {
        (&rest[..end], &rest[end + 5..])
    } else if let Some(end) = rest.rfind("\n---") {
        // Ensure nothing non-whitespace after the trailing `---`.
        if !rest[end + 4..].trim().is_empty() {
            return Err(REASON_MALFORMED);
        }
        (&rest[..end], "")
    } else {
        return Err(REASON_MALFORMED);
    };

    let entries = parse_frontmatter(frontmatter)?;
    Ok(Some(ParsedDocument {
        body: body.to_owned(),
        entries,
    }))
}

fn parse_frontmatter(text: &str) -> Result<Vec<(String, Vec<String>)>, &'static str> {
    let mut entries: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_key: Option<String> = None;
    let mut current_values: Vec<String> = Vec::new();

    for raw in text.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        // Block-sequence item: indented, starts with `-`.
        if line.starts_with(' ') || line.starts_with('\t') {
            let inner = line.trim_start();
            let Some(val) = inner.strip_prefix("- ") else {
                return Err(REASON_MALFORMED);
            };
            if current_key.is_none() {
                return Err(REASON_MALFORMED);
            }
            current_values.push(strip_quotes(val.trim()).to_owned());
            continue;
        }
        // Top-level key line. Flush the previous key if any.
        if let Some(k) = current_key.take() {
            entries.push((k, std::mem::take(&mut current_values)));
        }
        let colon = line.find(':').ok_or(REASON_MALFORMED)?;
        let (key, after) = line.split_at(colon);
        let after = &after[1..]; // skip the colon
        let key = key.trim().to_owned();
        if key.is_empty() {
            return Err(REASON_MALFORMED);
        }
        let after = after.trim();
        if after.is_empty() {
            // Value is a block sequence on following lines.
            current_key = Some(key);
            current_values = Vec::new();
        } else {
            current_key = Some(key);
            current_values = vec![strip_quotes(after).to_owned()];
        }
    }
    if let Some(k) = current_key.take() {
        entries.push((k, std::mem::take(&mut current_values)));
    }
    Ok(entries)
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

// ─────────────────────────────────────────────────────────────────────
// Composition — parsed → claim set
// ─────────────────────────────────────────────────────────────────────

/// Compose the substrate claim set for one parsed document.
#[must_use]
pub fn compose_document_claims(file: &str, parsed: &ParsedDocument) -> Vec<Claim> {
    let mut out = vec![
        Claim::new(file, IS_A_TERM, DOCUMENT),
        Claim::new(file, HAS_BODY, &parsed.body),
    ];
    for (key, values) in &parsed.entries {
        let entry = format!("{file}:frontmatter:{key}");
        out.push(Claim::new(&entry, IS_A_TERM, DOCUMENT_FRONTMATTER_ENTRY));
        out.push(Claim::new(file, HAS_FRONTMATTER, &entry));
        out.push(Claim::new(&entry, HAS_KEY, key));
        for v in values {
            out.push(Claim::new(&entry, HAS_VALUE, v));
        }
    }
    out
}

/// Compose a parse-error witness for a file that failed to parse.
#[must_use]
pub fn compose_parse_error(file: &str, reason: &str) -> Vec<Claim> {
    vec![Claim::new(file, HAS_FRONTMATTER_PARSE_ERROR, reason)]
}

// ─────────────────────────────────────────────────────────────────────
// Projection port
// ─────────────────────────────────────────────────────────────────────

/// Document-parser projection. Caches `has-content` and
/// `has-content-kind` per file subject; re-parses on each update.
#[derive(Debug, Default)]
pub struct DocumentParserPort {
    content: HashMap<String, String>,
    content_kind: HashMap<String, String>,
    emitted: HashMap<String, String>,
}

impl DocumentParserPort {
    /// Fresh state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn classify_and_emit(&mut self, file: &str) -> Vec<Claim> {
        let Some(content) = self.content.get(file).cloned() else {
            return Vec::new();
        };
        // Treat binary content-kind as non-utf-8 (parse-error).
        if self.content_kind.get(file).map(String::as_str) == Some(FILE_CONTENT_KIND_BINARY) {
            return self.emit_if_new(file, REASON_NOT_UTF8, compose_parse_error(file, REASON_NOT_UTF8));
        }
        if content.starts_with("blob:sha256:") {
            return self.emit_if_new(file, REASON_BLOB_BODY, compose_parse_error(file, REASON_BLOB_BODY));
        }
        match parse_document(&content) {
            Ok(Some(parsed)) => {
                self.emit_if_new(file, "ok", compose_document_claims(file, &parsed))
            }
            Ok(None) => self.emit_if_new(
                file,
                REASON_NO_FRONTMATTER,
                compose_parse_error(file, REASON_NO_FRONTMATTER),
            ),
            Err(reason) => self.emit_if_new(file, reason, compose_parse_error(file, reason)),
        }
    }

    fn emit_if_new(&mut self, file: &str, tag: &str, claims: Vec<Claim>) -> Vec<Claim> {
        if self.emitted.get(file).map(String::as_str) == Some(tag) {
            return Vec::new();
        }
        self.emitted.insert(file.to_owned(), tag.to_owned());
        claims
    }
}

impl Projection for DocumentParserPort {
    fn identity(&self) -> &str {
        "mash-library-document-parser"
    }

    fn subscriptions(&self) -> Vec<String> {
        vec![HAS_CONTENT.to_owned(), HAS_CONTENT_KIND.to_owned()]
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
        if predicate == HAS_CONTENT {
            self.content.insert(subject.to_owned(), object.to_owned());
            self.classify_and_emit(subject)
        } else if predicate == HAS_CONTENT_KIND {
            self.content_kind
                .insert(subject.to_owned(), object.to_owned());
            self.classify_and_emit(subject)
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_declared() {
        let claims = Document.claims();
        for p in [HAS_BODY, HAS_FRONTMATTER, HAS_KEY, HAS_VALUE] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} missing"
            );
        }
    }

    #[test]
    fn no_frontmatter_returns_none() {
        let out = parse_document("just a body, no dash lines\n").unwrap();
        assert!(out.is_none());
    }

    #[test]
    fn simple_scalar_frontmatter_parses() {
        let content = "---\ntitle: Hello\nauthor: emsenn\n---\nBody text\n";
        let parsed = parse_document(content).unwrap().unwrap();
        assert_eq!(parsed.body, "Body text\n");
        assert_eq!(
            parsed.entries,
            vec![
                ("title".to_owned(), vec!["Hello".to_owned()]),
                ("author".to_owned(), vec!["emsenn".to_owned()]),
            ]
        );
    }

    #[test]
    fn quoted_scalar_strips_quotes() {
        let content = "---\ntitle: \"Hello, world\"\n---\nX\n";
        let parsed = parse_document(content).unwrap().unwrap();
        assert_eq!(parsed.entries[0].1[0], "Hello, world");
    }

    #[test]
    fn block_sequence_parses() {
        let content = "---\ntags:\n  - alpha\n  - beta\n---\nbody\n";
        let parsed = parse_document(content).unwrap().unwrap();
        assert_eq!(
            parsed.entries,
            vec![("tags".to_owned(), vec!["alpha".to_owned(), "beta".to_owned()])]
        );
    }

    #[test]
    fn unterminated_frontmatter_errs() {
        let content = "---\ntitle: no-end\nbody without closer\n";
        let err = parse_document(content).unwrap_err();
        assert_eq!(err, REASON_MALFORMED);
    }

    #[test]
    fn compose_claims_produces_reified_entries() {
        let parsed = ParsedDocument {
            body: "body".to_owned(),
            entries: vec![("title".to_owned(), vec!["T".to_owned()])],
        };
        let claims = compose_document_claims("file:f", &parsed);
        assert!(claims
            .iter()
            .any(|c| c.subject == "file:f" && c.predicate == IS_A_TERM && c.object == DOCUMENT));
        assert!(claims.iter().any(
            |c| c.subject == "file:f:frontmatter:title" && c.predicate == HAS_KEY && c.object == "title"
        ));
    }

    #[test]
    fn port_emits_on_utf8_document_with_frontmatter() {
        let mut port = DocumentParserPort::new();
        // Content arrives first; content-kind optional — the parser
        // fires on whichever update lets it make a classification.
        let out = port.ingest(
            "file:f",
            HAS_CONTENT,
            "---\ntitle: X\n---\nbody\n",
            Value::True,
        );
        assert!(out.iter().any(|c| c.predicate == HAS_FRONTMATTER));
        assert!(out.iter().any(|c| c.predicate == HAS_BODY && c.object == "body\n"));
    }

    #[test]
    fn port_emits_parse_error_for_binary_content() {
        let mut port = DocumentParserPort::new();
        let _ = port.ingest("file:f", HAS_CONTENT, "raw bytes", Value::True);
        let out = port.ingest("file:f", HAS_CONTENT_KIND, FILE_CONTENT_KIND_BINARY, Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_FRONTMATTER_PARSE_ERROR && c.object == REASON_NOT_UTF8));
    }

    #[test]
    fn port_emits_blob_body_error() {
        let mut port = DocumentParserPort::new();
        let out = port.ingest("file:f", HAS_CONTENT, "blob:sha256:abc123", Value::True);
        assert!(out
            .iter()
            .any(|c| c.predicate == HAS_FRONTMATTER_PARSE_ERROR && c.object == REASON_BLOB_BODY));
    }

    #[test]
    fn port_is_idempotent_per_classification() {
        let mut port = DocumentParserPort::new();
        let first = port.ingest("file:f", HAS_CONTENT, "no frontmatter body\n", Value::True);
        assert!(
            !first.is_empty(),
            "first classification (no-frontmatter) should emit its reason"
        );
        // Subsequent content-kind with same classification tag: no-op.
        let again = port.ingest("file:f", HAS_CONTENT_KIND, "file-content-kind:utf-8-text", Value::True);
        assert!(again.is_empty());
    }
}
