//! Grammar — substrate-native vocabulary for nouns, articles, and
//! rendered display phrases.
//!
//! # What this is for
//!
//! Ports that show a subject to a player read `has-rendered-phrase`
//! instead of hand-formatting strings. A (future) `grammar-phrase`
//! projection port composes the display string from primitives and
//! witnesses it back. Downstream consumers (room renderer, look
//! renderer, comms) subscribe to [`HAS_RENDERED_PHRASE`] and use the
//! value verbatim.
//!
//! # Why a rendered-phrase fiber
//!
//! Display-string construction used to live inline in each port that
//! needed one ("a red rock", "the brass lantern", "Alice"). That meant
//! every port re-implemented article selection, adjective ordering,
//! and proper-name handling. Centralizing as a fiber means one port
//! settles the phrase and every consumer sees the settled value —
//! Wiener/Barad: the phrase IS a settled claim on the subject, not a
//! function call's return value.
//!
//! # `HAS_NAME` reuse
//!
//! The [`crate::container::HAS_NAME`] predicate already declares
//! "subject has a name string" at the container vocabulary layer.
//! This module does not redeclare it — the name is the same concept
//! whether used for container display or grammar composition. When a
//! grammar phrase port finds a `has-name` witness, it uses that
//! verbatim and skips article/adjective composition.

use async_trait::async_trait;
use mash_engine::sdk::agent::Agent;
use mash_engine::sdk::client::Claim;

use crate::foundation::{IS_A_PREDICATE, IS_A_TERM};

/// Owner identity.
pub const IDENTITY: &str = "mash-library-grammar";

// ─────────────────────────────────────────────────────────────────────
// Terms — grammatical classes
// ─────────────────────────────────────────────────────────────────────

/// The noun kind — a thing that can be named.
pub const NOUN: &str = "noun";

/// The adjective kind — a descriptor that modifies a noun phrase.
pub const ADJECTIVE: &str = "adjective";

/// The article-form kind — values for [`HAS_ARTICLE_FORM`].
pub const ARTICLE_FORM: &str = "article-form";

/// Indefinite article (`a` / `an`).
pub const ARTICLE_FORM_INDEFINITE: &str = "article-form:indefinite";

/// Definite article (`the`).
pub const ARTICLE_FORM_DEFINITE: &str = "article-form:definite";

/// Proper-name form (no article, name used verbatim).
pub const ARTICLE_FORM_PROPER: &str = "article-form:proper";

/// Suppress article entirely.
pub const ARTICLE_FORM_NONE: &str = "article-form:none";

/// Phoneme classification: leading vowel sound (governs `a` vs `an`
/// selection).
pub const PHONEME_VOWEL: &str = "phoneme:vowel";

/// Phoneme classification: leading consonant sound.
pub const PHONEME_CONSONANT: &str = "phoneme:consonant";

// ─────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────

/// `(subject, has-noun, string)` — subject's noun string.
pub const HAS_NOUN: &str = "has-noun";

/// `(subject, has-adjective, string)` — one adjective. Multi-valued;
/// the phrase port orders by insertion.
pub const HAS_ADJECTIVE: &str = "has-adjective";

/// `(subject, has-article-form, article-form-term)` — which article
/// convention governs the noun phrase for this subject.
pub const HAS_ARTICLE_FORM: &str = "has-article-form";

/// `(subject, has-starting-phoneme, phoneme-term)` — override the
/// orthographic fallback for indefinite-article selection.
pub const HAS_STARTING_PHONEME: &str = "has-starting-phoneme";

/// `(subject, has-rendered-phrase, string)` — the composed display
/// string, witnessed by the grammar-phrase port.
pub const HAS_RENDERED_PHRASE: &str = "has-rendered-phrase";

// ─────────────────────────────────────────────────────────────────────
// Owner-agent
// ─────────────────────────────────────────────────────────────────────

/// Owner-agent declaring the grammar vocabulary.
#[derive(Debug, Clone, Copy, Default)]
pub struct Grammar;

#[async_trait]
impl Agent for Grammar {
    fn identity(&self) -> &'static str {
        IDENTITY
    }

    fn claims(&self) -> Vec<Claim> {
        let mut out = Vec::new();

        for t in [
            NOUN,
            ADJECTIVE,
            ARTICLE_FORM,
            ARTICLE_FORM_INDEFINITE,
            ARTICLE_FORM_DEFINITE,
            ARTICLE_FORM_PROPER,
            ARTICLE_FORM_NONE,
            PHONEME_VOWEL,
            PHONEME_CONSONANT,
        ] {
            out.push(Claim::new(t, IS_A_TERM, IDENTITY));
        }

        for p in [
            HAS_NOUN,
            HAS_ADJECTIVE,
            HAS_ARTICLE_FORM,
            HAS_STARTING_PHONEME,
            HAS_RENDERED_PHRASE,
        ] {
            out.push(Claim::new(p, IS_A_PREDICATE, IDENTITY));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn article_forms_declared() {
        let claims = Grammar.claims();
        for f in [
            ARTICLE_FORM_INDEFINITE,
            ARTICLE_FORM_DEFINITE,
            ARTICLE_FORM_PROPER,
            ARTICLE_FORM_NONE,
        ] {
            assert!(claims
                .iter()
                .any(|c| c.subject == f && c.predicate == IS_A_TERM));
        }
    }

    #[test]
    fn predicates_declared() {
        let claims = Grammar.claims();
        for p in [
            HAS_NOUN,
            HAS_ADJECTIVE,
            HAS_ARTICLE_FORM,
            HAS_STARTING_PHONEME,
            HAS_RENDERED_PHRASE,
        ] {
            assert!(
                claims
                    .iter()
                    .any(|c| c.subject == p && c.predicate == IS_A_PREDICATE),
                "{p} should be declared"
            );
        }
    }
}
